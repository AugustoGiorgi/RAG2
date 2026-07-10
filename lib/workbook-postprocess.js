"use strict";

/**
 * workbook-postprocess.js — deterministic post-processing of the AI-generated workbook.
 *
 *   1. canonicalizeWorkbookSheets: the AI names the same sheet differently between runs
 *      ("AJEs" / "AJE Summary" / "Adjusting Journal Entries"), which makes two runs of the
 *      same input look different and breaks name-based cross-sheet references. Close-variant
 *      names are renamed to a canonical name and the workbook is sorted into a fixed order.
 *      Verbatim source tabs keep the client's own file names and trail at the end.
 *
 *   2. linkEntryGuideToWorkpaper: the cross-tab formula chain. SAFE by construction — a
 *      link is only written on a UNIQUE value match (a coincidental duplicate can never
 *      produce a wrong reference), links skip 0/tiny amounts, and every emitted formula is
 *      IFERROR-wrapped by the xlsx generator with the original value as fallback.
 *        P&L net income  →  M-1 "Net Income per Books" (editing the P&L reflows the M-1,
 *                           whose subtotals are live formulas)
 *        AJE Worksheet   →  the M-1's AJE rows
 *        M-1             →  Data Entry Guide amount cells
 */

const CANONICAL_SHEET_RULES = [
  { name: "Profit and Loss", test: /^(profit\s*(and|&|\/)?\s*loss( statement)?|p\s*&?\s*l( statement)?|income statement)$/i },
  { name: "Balance Sheet", test: /^balance\s*sheet$/i },
  { name: "AJE Worksheet", test: /^(ajes?|aje (worksheet|summary|schedule|list)|adjusting journal entries|adjusting entries|journal entries)$/i },
  { name: "Fixed Assets", test: /^(fixed assets?( additions?| schedule| detail)?|fixed asset additions?|asset additions?|depreciation( schedule)?)$/i },
];

function canonicalizeWorkbookSheets(workbook) {
  if (!workbook || !Array.isArray(workbook.sheets)) return workbook;
  // 1) Rename close variants to canonical names (AI sheets only, never verbatim source
  //    copies, and never when the canonical name is already taken by another sheet).
  for (const rule of CANONICAL_SHEET_RULES) {
    for (const sheet of workbook.sheets) {
      const name = String(sheet?.name || "").trim();
      if (!name || sheet.verbatim) continue;
      if (name.toLowerCase() === rule.name.toLowerCase()) continue;
      if (!rule.test.test(name)) continue;
      const taken = workbook.sheets.some((s) => s !== sheet && String(s.name || "").trim().toLowerCase() === rule.name.toLowerCase());
      if (!taken) sheet.name = rule.name;
    }
  }
  // 2) Fixed order (stable within each bucket, so AI extras keep their relative order).
  const bucket = (sheet) => {
    const name = String(sheet?.name || "").trim().toLowerCase();
    if (sheet?.verbatim) return 9;                          // client's source reports last
    if (/^book to tax \((m-1|sch c-e)\)$/.test(name)) return 0;
    if (name === "profit and loss") return 1;
    if (name === "balance sheet") return 2;
    if (name === "aje worksheet") return 3;
    if (name === "fixed assets") return 4;
    if (name === "ai notes") return 7;
    if (name === "data entry guide") return 8;
    return 5;                                               // other AI tabs in the middle
  };
  workbook.sheets = workbook.sheets
    .map((sheet, index) => ({ sheet, index }))
    .sort((a, b) => (bucket(a.sheet) - bucket(b.sheet)) || (a.index - b.index))
    .map((entry) => entry.sheet);
  return workbook;
}

function linkEntryGuideToWorkpaper(workbook) {
  if (!workbook || !Array.isArray(workbook.sheets)) return workbook;
  const findSheet = (re) => workbook.sheets.find((s) => re.test(String(s.name || "").trim()) && Array.isArray(s.rows));
  const guide = findSheet(/^data entry guide$/i);
  const m1 = findSheet(/^book to tax \((m-1|sch c-e)\)$/i);
  const pnl = findSheet(/^profit and loss$/i);
  const aje = findSheet(/^aje worksheet$/i);
  if (!m1) return workbook;

  const cellNum = (v) => {
    if (v && typeof v === "object" && Number.isFinite(Number(v.value))) return Number(v.value);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const s = String(v == null ? "" : v).trim();
    if (!/^\(?-?\$?\s?[\d,]*\.?\d+\)?$/.test(s)) return null;
    const neg = /^\(.*\)$/.test(s);
    const n = Number(s.replace(/[()$,\s]/g, ""));
    return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : null;
  };
  const colLetter = (c) => { let name = "", n = c; while (n > 0) { name = String.fromCharCode(65 + (n - 1) % 26) + name; n = Math.floor((n - 1) / 26); } return name; };
  const sheetRef = (s) => `'${String(s.name).replace(/'/g, "''")}'`;

  // Index EVERY numeric cell of a sheet by cent value -> [A1 addresses]. A link is written
  // only on a UNIQUE match, so a coincidental duplicate can never produce a wrong reference.
  const buildValueIndex = (sheet) => {
    const index = new Map();
    (sheet.rows || []).forEach((row, r) => {
      (Array.isArray(row) ? row : [row]).forEach((cell, c) => {
        const v = cellNum(cell);
        if (v === null || Math.abs(v) < 1) return;
        const key = Math.round(v * 100);
        const addr = `${colLetter(c + 1)}${r + 1}`;
        (index.get(key) || index.set(key, []).get(key)).push(addr);
      });
    });
    return index;
  };

  // ---- Chain step 1: M-1 "Net Income per Books" -> the matching P&L cell. Editing the
  // P&L then reflows the whole reconciliation (its subtotals are already live formulas).
  if (pnl) {
    const pnlIndex = buildValueIndex(pnl);
    const niRow = m1.rows.find((row) => /^net income \(loss\) per books$/i.test(String((row || [])[0] ?? "").trim()));
    if (niRow) {
      const v = cellNum(niRow[1]);
      if (v !== null && Math.abs(v) >= 1) {
        const matches = pnlIndex.get(Math.round(v * 100));
        if (matches && matches.length === 1) niRow[1] = { formula: `${sheetRef(pnl)}!${matches[0]}`, value: v };
      }
    }
  }

  // ---- Chain step 2: the M-1's AJE rows -> the matching AJE Worksheet cells.
  if (aje) {
    const ajeIndex = buildValueIndex(aje);
    let inAjeSection = false;
    for (const row of m1.rows) {
      const label = String((row || [])[0] ?? "").trim();
      if (/^adjusting journal entries/i.test(label)) { inAjeSection = true; continue; }
      if (/^adjusted net income/i.test(label)) break;
      if (!inAjeSection) continue;
      const v = cellNum(row[1]);
      if (v === null || Math.abs(v) < 1) continue;
      const matches = ajeIndex.get(Math.round(v * 100));
      if (matches && matches.length === 1) row[1] = { formula: `${sheetRef(aje)}!${matches[0]}`, value: v };
    }
  }

  // ---- Chain step 3: Data Entry Guide amounts -> the workpaper tabs. Priority order:
  // M-1 (the tax-adjusted source of truth), then P&L, Balance Sheet, AJE Worksheet, Fixed
  // Assets for raw financial lines. Each target requires a unique match WITHIN that sheet.
  // Even when a link is semantically imperfect, it can only point at a cell holding the
  // exact same value (and is IFERROR-wrapped) — the displayed number is always correct.
  if (guide) {
    // The M-1 target only indexes its amount column (col B), which is where its numbers live.
    const m1AmountIndex = new Map();
    m1.rows.forEach((row, r) => {
      const v = cellNum((row || [])[1]);
      if (v === null || Math.abs(v) < 1) return;
      const key = Math.round(v * 100);
      (m1AmountIndex.get(key) || m1AmountIndex.set(key, []).get(key)).push(`B${r + 1}`);
    });
    const bs = findSheet(/^balance sheet$/i);
    const fixedAssets = findSheet(/^fixed assets$/i);
    const targets = [
      { sheet: m1, index: m1AmountIndex },
      ...[pnl, bs, aje, fixedAssets].filter(Boolean).map((sheet) => ({ sheet, index: buildValueIndex(sheet) })),
    ];
    // The entry-guide amount column is index 3 (header "# | Screen | Form Line | Amount | ...").
    const AMOUNT_COL = 3;
    for (const row of guide.rows) {
      if (!Array.isArray(row) || row.length <= AMOUNT_COL) continue;
      // Only the actual data-entry field rows (column 0 is a field number) — skip tie-out
      // rows and section headers, whose column 3 is a "difference" not a value to link.
      if (!/^\d+$/.test(String(row[0] ?? "").trim())) continue;
      const v = cellNum(row[AMOUNT_COL]);
      if (v === null || Math.abs(v) < 1) continue;
      const key = Math.round(v * 100);
      for (const target of targets) {
        const matches = target.index.get(key);
        if (matches && matches.length === 1) {
          row[AMOUNT_COL] = { formula: `${sheetRef(target.sheet)}!${matches[0]}`, value: v };
          break;
        }
      }
    }
  }
  return workbook;
}

module.exports = { canonicalizeWorkbookSheets, linkEntryGuideToWorkpaper, CANONICAL_SHEET_RULES };
