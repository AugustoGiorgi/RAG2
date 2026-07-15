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
    if (name === "schedule k-1 allocation") return 0.5; // right after the M-1 it derives from
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

// ---- Shared cell helpers -----------------------------------------------------------------
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
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

// Index EVERY numeric cell of a sheet by cent value AND by whole-dollar value ->
// [{ addr, v }]. A link is written only on a UNIQUE match, so a coincidental duplicate can
// never produce a wrong reference. The whole-dollar index exists because some runs round
// the Data Entry Guide amounts to whole dollars (tax-software entry style): 4564526 must
// still find the workpaper cell holding 4,564,526.40.
const buildValueIndex = (sheet, colOnly = null) => {
  const cents = new Map();
  const dollars = new Map();
  const push = (map, key, entry) => (map.get(key) || map.set(key, []).get(key)).push(entry);
  (sheet.rows || []).forEach((row, r) => {
    (Array.isArray(row) ? row : [row]).forEach((cell, c) => {
      if (colOnly !== null && c !== colOnly) return;
      const v = cellNum(cell);
      if (v === null || Math.abs(v) < 1) return;
      const entry = { addr: `${colLetter(c + 1)}${r + 1}`, v };
      push(cents, Math.round(v * 100), entry);
      push(dollars, Math.round(v), entry);
    });
  });
  return { cents, dollars };
};

// Unique-match resolution: exact cents first; if the sought amount is a WHOLE number (the
// model rounded), fall back to a unique whole-dollar match. Returns { addr, v } or null.
const resolveUnique = (index, v) => {
  const exact = index.cents.get(Math.round(v * 100));
  if (exact && exact.length === 1) return exact[0];
  if (Number.isInteger(v)) {
    const rounded = index.dollars.get(Math.round(v));
    if (rounded && rounded.length === 1) return rounded[0];
  }
  return null;
};

/**
 * injectSectionTotalFormulas — nested-section-aware SUM injection for EVERY non-verbatim
 * sheet. QBO-style statements are hierarchical ("Expenses" … "Payroll" … "Total Payroll" …
 * "Total Expenses"), so a contiguous-range SUM cannot represent an outer section total; a
 * chain of the DIRECT children can (loose account rows + inner "Total X" rows). For each
 * "Total <name>" row this finds the matching "<name>" header above it, walks the direct
 * children (skipping the interior of nested sections, adding their totals instead), and
 * injects =child+child+… ONLY when that sum reconciles to the cent with the printed total.
 * Innermost totals resolve first so outer chains reference the (now live) inner totals.
 */
function injectSectionTotalFormulas(workbook) {
  if (!workbook || !Array.isArray(workbook.sheets)) return workbook;
  const norm = (s) => String(s ?? "").trim().replace(/[:：]\s*$/, "").toLowerCase();

  for (const sheet of workbook.sheets) {
    if (sheet.verbatim || !Array.isArray(sheet.rows)) continue;
    const rows = sheet.rows;

    // Map every "Total <name>" row to its header row ("<name>" above it, nearest match).
    const totals = [];
    for (let r = 0; r < rows.length; r++) {
      const row = Array.isArray(rows[r]) ? rows[r] : [rows[r]];
      const m = /^total\s+(.+?)$/i.exec(String(row[0] ?? "").trim());
      if (!m) continue;
      const name = norm(m[1]);
      let header = -1;
      for (let h = r - 1; h >= 0; h--) {
        const hRow = Array.isArray(rows[h]) ? rows[h] : [rows[h]];
        if (norm(hRow[0]) === name) { header = h; break; }
      }
      if (header >= 0) totals.push({ r, header, name });
    }
    if (!totals.length) continue;
    const totalByRow = new Map(totals.map((t) => [t.r, t]));
    const headerToTotal = new Map(totals.map((t) => [t.header, t.r]));

    // Innermost first (smallest span), so outer sections can reference inner totals.
    totals.sort((a, b) => (a.r - a.header) - (b.r - b.header));

    for (const t of totals) {
      const totalRow = Array.isArray(rows[t.r]) ? rows[t.r] : [rows[t.r]];
      // Amount column = first numeric cell of the total row (skip already-linked formulas).
      let c = -1, printed = null;
      for (let i = 1; i < totalRow.length; i++) {
        const v = cellNum(totalRow[i]);
        if (v !== null) { c = i; printed = v; break; }
      }
      if (c < 0) continue;
      if (totalRow[c] && typeof totalRow[c] === "object" && totalRow[c].formula) continue;

      // Walk DIRECT children between header and total; a nested section contributes its
      // own Total row and its interior is skipped.
      const terms = [];
      let sum = 0;
      let ok = true;
      for (let r = t.header + 1; r < t.r; r++) {
        const nestedTotal = headerToTotal.get(r);
        if (nestedTotal !== undefined && nestedTotal < t.r) {
          const nested = Array.isArray(rows[nestedTotal]) ? rows[nestedTotal] : [rows[nestedTotal]];
          const v = cellNum(nested[c]);
          if (v !== null) { terms.push(`B?${nestedTotal}`); sum += v; }
          r = nestedTotal; // skip the nested section's interior (its total was just added)
          continue;
        }
        if (totalByRow.has(r)) { ok = false; break; } // stray total without header — bail out
        const row = Array.isArray(rows[r]) ? rows[r] : [rows[r]];
        const v = cellNum(row[c]);
        if (v !== null) { terms.push(`B?${r}`); sum += v; }
      }
      if (!ok || terms.length < 2 || terms.length > 60) continue;
      if (Math.abs(round2(sum) - printed) > 0.02) continue; // does not reconcile -> stays static
      const col = colLetter(c + 1);
      const formula = terms.map((token, i) => `${i ? "+" : ""}${col}${Number(token.slice(2)) + 1}`).join("");
      totalRow[c] = { formula, value: printed };
    }
  }
  return workbook;
}

/**
 * injectFinancialStatementFormulas — makes the P&L and Balance Sheet tabs' own arithmetic
 * LIVE, which is the middle link of the whole chain: when the preparer edits a detail line,
 * the statement total recalculates, which reflows the M-1 (linked to P&L net income), which
 * reflows the Data Entry Guide. PROOF-BASED like everything else: a formula is only written
 * when the arithmetic reconciles to the cent with the numbers already on the sheet, and the
 * xlsx generator wraps it in IFERROR with the original value — the displayed workbook is
 * byte-identical at generation time; only its behavior under human edits improves.
 */
function injectFinancialStatementFormulas(workbook) {
  if (!workbook || !Array.isArray(workbook.sheets)) return workbook;
  const findSheet = (re) => workbook.sheets.find((s) => re.test(String(s.name || "").trim()) && Array.isArray(s.rows));
  const pnl = findSheet(/^profit and loss$/i);
  const bs = findSheet(/^balance sheet$/i);

  // Find a row by anchored label regex; returns { r, c, v } using the row's amount column.
  const findRow = (sheet, re) => {
    for (let r = 0; r < sheet.rows.length; r++) {
      const row = Array.isArray(sheet.rows[r]) ? sheet.rows[r] : [sheet.rows[r]];
      if (!re.test(String(row[0] ?? "").trim())) continue;
      for (let c = 1; c < row.length; c++) {
        const v = cellNum(row[c]);
        if (v !== null) return { r, c, v, row };
      }
    }
    return null;
  };
  const addr = (hit) => `${colLetter(hit.c + 1)}${hit.r + 1}`;

  // ---- P&L: Gross Profit and Net Income as live arithmetic over the section totals.
  if (pnl) {
    const income = findRow(pnl, /^total (income|revenue)$/i);
    const cogs = findRow(pnl, /^total (cost of goods sold|cogs)$/i);
    const expenses = findRow(pnl, /^total expenses?$/i);
    const otherIncome = findRow(pnl, /^total other income$/i);
    const otherExpenses = findRow(pnl, /^total other expenses?$/i);
    const grossProfit = findRow(pnl, /^gross profit$/i);
    const netIncome = findRow(pnl, /^net income( \(loss\))?$/i);

    if (grossProfit && income && cogs && Math.abs(round2(income.v - cogs.v) - grossProfit.v) <= 0.02) {
      grossProfit.row[grossProfit.c] = { formula: `${addr(income)}-${addr(cogs)}`, value: grossProfit.v };
    }
    if (netIncome && income) {
      // Net Income = Income − COGS − Expenses + Other Income − Other Expenses (present terms only)
      const terms = [{ hit: income, sign: 1 }];
      if (cogs) terms.push({ hit: cogs, sign: -1 });
      if (expenses) terms.push({ hit: expenses, sign: -1 });
      if (otherIncome) terms.push({ hit: otherIncome, sign: 1 });
      if (otherExpenses) terms.push({ hit: otherExpenses, sign: -1 });
      const computed = round2(terms.reduce((sum, t) => sum + t.sign * t.hit.v, 0));
      if (terms.length >= 2 && Math.abs(computed - netIncome.v) <= 0.02) {
        const formula = terms.map((t, i) => `${t.sign < 0 ? "-" : (i === 0 ? "" : "+")}${addr(t.hit)}`).join("");
        netIncome.row[netIncome.c] = { formula, value: netIncome.v };
      }
    }
  }

  // ---- Balance Sheet: Total Liabilities & Equity as live arithmetic, and the equity
  // section's Net Income line linked across to the P&L so a P&L edit reflows the BS too.
  if (bs) {
    const totalLiab = findRow(bs, /^total liabilities$/i);
    const totalEquity = findRow(bs, /^total equity$/i);
    const totalLE = findRow(bs, /^total liabilities (and|&) equity$/i);
    if (totalLE && totalLiab && totalEquity && Math.abs(round2(totalLiab.v + totalEquity.v) - totalLE.v) <= 0.02) {
      totalLE.row[totalLE.c] = { formula: `${addr(totalLiab)}+${addr(totalEquity)}`, value: totalLE.v };
    }
    if (pnl) {
      const bsNetIncome = findRow(bs, /^net income( \(loss\))?$/i);
      const pnlNetIncome = findRow(pnl, /^net income( \(loss\))?$/i);
      if (bsNetIncome && pnlNetIncome && Math.abs(bsNetIncome.v - pnlNetIncome.v) <= 0.01) {
        bsNetIncome.row[bsNetIncome.c] = { formula: `${sheetRef(pnl)}!${addr(pnlNetIncome)}`, value: bsNetIncome.v };
      }
    }
  }
  return workbook;
}

function linkEntryGuideToWorkpaper(workbook) {
  if (!workbook || !Array.isArray(workbook.sheets)) return workbook;
  const findSheet = (re) => workbook.sheets.find((s) => re.test(String(s.name || "").trim()) && Array.isArray(s.rows));
  const guide = findSheet(/^data entry guide$/i);
  // m1 is OPTIONAL: a personal 1040 / 990 / 1041 workbook has no reconciliation tab, but
  // the Data Entry Guide links and the LIVE tie-out formulas must still be produced.
  const m1 = findSheet(/^book to tax \((m-1|sch c-e)\)$/i) || null;
  const pnl = findSheet(/^profit and loss$/i);
  const aje = findSheet(/^aje worksheet$/i);

  // ---- Chain step 1: M-1 "Net Income per Books" -> the matching P&L cell. Editing the
  // P&L then reflows the whole reconciliation (its subtotals are already live formulas).
  if (pnl && m1) {
    const pnlIndex = buildValueIndex(pnl);
    const niRow = m1.rows.find((row) => /^net income \(loss\) per books$/i.test(String((row || [])[0] ?? "").trim()));
    if (niRow) {
      const v = cellNum(niRow[1]);
      if (v !== null && Math.abs(v) >= 1) {
        const hit = resolveUnique(pnlIndex, v);
        if (hit) niRow[1] = { formula: `${sheetRef(pnl)}!${hit.addr}`, value: hit.v };
      }
    }
  }

  // ---- Chain step 2: the M-1's AJE rows -> the matching AJE Worksheet cells.
  if (aje && m1) {
    const ajeIndex = buildValueIndex(aje);
    let inAjeSection = false;
    for (const row of m1.rows) {
      const label = String((row || [])[0] ?? "").trim();
      if (/^adjusting journal entries/i.test(label)) { inAjeSection = true; continue; }
      if (/^adjusted net income/i.test(label)) break;
      if (!inAjeSection) continue;
      const v = cellNum(row[1]);
      if (v === null || Math.abs(v) < 1) continue;
      const hit = resolveUnique(ajeIndex, v);
      if (hit) row[1] = { formula: `${sheetRef(aje)}!${hit.addr}`, value: hit.v };
    }
  }

  // ---- Chain step 3: Data Entry Guide amounts -> the workpaper tabs. Priority order:
  // M-1 (the tax-adjusted source of truth), then P&L, Balance Sheet, AJE Worksheet, Fixed
  // Assets for raw financial lines. Each target requires a unique match WITHIN that sheet.
  // Even when a link is semantically imperfect, it can only point at a cell holding the
  // exact same value (and is IFERROR-wrapped) — the displayed number is always correct.
  if (guide) {
    const bs = findSheet(/^balance sheet$/i);
    const fixedAssets = findSheet(/^fixed assets$/i);
    const primary = [m1, pnl, bs, aje, fixedAssets].filter(Boolean);
    // Remaining AI tabs (e.g. a personal 1040's "W-2 Detail" / "Interest and Dividends")
    // also become link targets, after the canonical ones. Verbatim source copies and
    // narrative tabs are excluded. Same unique-match safety applies.
    const secondary = workbook.sheets.filter((s) => Array.isArray(s.rows) && !s.verbatim
      && s !== guide && !primary.includes(s) && !/^ai notes$/i.test(String(s.name || "").trim()));
    const targets = [
      // The M-1 target only indexes its amount column (col B), which is where its numbers live.
      ...(m1 ? [{ sheet: m1, index: buildValueIndex(m1, 1) }] : []),
      ...[pnl, bs, aje, fixedAssets].filter(Boolean).map((sheet) => ({ sheet, index: buildValueIndex(sheet) })),
      ...secondary.map((sheet) => ({ sheet, index: buildValueIndex(sheet) })),
    ];
    const linkToTargets = (v) => {
      for (const target of targets) {
        const hit = resolveUnique(target.index, v);
        if (hit) return { formula: `${sheetRef(target.sheet)}!${hit.addr}`, value: hit.v };
      }
      return null;
    };
    // The entry-guide amount column is index 3 (header "# | Screen | Form Line | Amount | ...").
    const AMOUNT_COL = 3;
    for (const row of guide.rows) {
      if (!Array.isArray(row) || row.length <= AMOUNT_COL) continue;
      // Only the actual data-entry field rows (column 0 is a field number) — skip tie-out
      // rows and section headers, whose column 3 is a "difference" not a value to link.
      if (!/^\d+$/.test(String(row[0] ?? "").trim())) continue;
      const v = cellNum(row[AMOUNT_COL]);
      if (v === null || Math.abs(v) < 1) continue;
      const link = linkToTargets(v);
      if (link) row[AMOUNT_COL] = link;
    }

    // ---- Chain step 4: LIVE tie-out checks. The tie-out section rows are
    // "Check | Guide Amount | Financial Amount | Difference | Status | ...". The financial
    // amount is linked to the workpaper cell it came from (unique match), and the difference
    // becomes =B{r}-C{r}. Result: when the preparer edits the P&L/BS, the tie-out section
    // recomputes on its own and shows exactly which entries went out of alignment — the
    // guide can no longer silently go stale.
    const headerIdx = guide.rows.findIndex((row) => Array.isArray(row)
      && /^check$/i.test(String(row[0] ?? "").trim())
      && /guide amount/i.test(String(row[1] ?? "")));
    if (headerIdx >= 0) {
      for (let r = headerIdx + 1; r < guide.rows.length; r++) {
        const row = guide.rows[r];
        if (!Array.isArray(row)) break;
        const label = String(row[0] ?? "").trim();
        if (!label || /^(tie-out|completeness|data entry)/i.test(label)) break; // section ended
        const guideAmt = cellNum(row[1]);
        const finAmt = cellNum(row[2]);
        if (guideAmt === null || finAmt === null) continue;
        if (Math.abs(finAmt) >= 1) {
          const link = linkToTargets(finAmt);
          if (link) row[2] = link;
        }
        row[3] = { formula: `B${r + 1}-C${r + 1}`, value: round2(guideAmt - finAmt) };
      }
    }
  }
  return workbook;
}

module.exports = { canonicalizeWorkbookSheets, injectSectionTotalFormulas, injectFinancialStatementFormulas, linkEntryGuideToWorkpaper, CANONICAL_SHEET_RULES };
