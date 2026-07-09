"use strict";

/**
 * xlsx-workpaper.js — server-side styled Excel generator for Preparation workpapers.
 *
 * Two jobs the browser SheetJS Community build could not do:
 *   1. Real formatting: numeric cells (not text), currency format with red negatives,
 *      a navy header band, shaded subtotal/total rows, borders, frozen header,
 *      and highlighted "TBD / NOT FOUND / ⚠" cells so the preparer spots gaps.
 *   2. SAFE formulas: the AI never writes a formula. This code injects SUM formulas
 *      itself and ONLY when it can PROVE the formula is correct — it sums the
 *      contiguous numeric block directly above a Total row and injects the formula
 *      only if that sum reconciles (to the cent) with the number the AI already put
 *      in the total cell. Every injected formula is also wrapped in IFERROR with the
 *      code-computed value as the fallback and cached result. Result: a formula can
 *      never show #REF!/#VALUE!/#DIV0!/#ERROR, can never reference a cell outside the
 *      grid, and can never compute a value different from the verified total. When a
 *      total cannot be proven, the plain number is kept — no formula is written.
 *
 * Input: workbook = { sheets: [{ name, rows: [[cell,...],...], styles?, merges? }] }
 * Output: a Promise<Buffer> containing the .xlsx file.
 */

const ExcelJS = require("exceljs");

// --- Palette (professional CPA look) ---------------------------------------
const NAVY = "FF1F3864";        // header band
const WHITE = "FFFFFFFF";
const SUBTOTAL_FILL = "FFEEF2F7"; // light blue-gray for total/subtotal rows
const TITLE_COLOR = "FF1F3864";
const FLAG_FILL = "FFFFF4CE";     // amber for TBD / NOT FOUND / needs-review cells
const FLAG_TEXT = "FF8A6D00";
const BORDER_COLOR = "FFD9D9D9";
const CURRENCY_FMT = "#,##0.00;[Red](#,##0.00)";

const thinBorder = {
  top: { style: "thin", color: { argb: BORDER_COLOR } },
  bottom: { style: "thin", color: { argb: BORDER_COLOR } },
  left: { style: "thin", color: { argb: BORDER_COLOR } },
  right: { style: "thin", color: { argb: BORDER_COLOR } },
};

// A cell that is purely a number token: 70000.0, 6,521.62, $5,000, (1,061.00), -51, 700.0
function parseNum(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  if (!/^\(?-?\$?\s?[\d,]*\.?\d+\)?$/.test(s)) return null;
  // Leave bare 4-digit years alone (e.g. a "2025" cell should stay a label, not a sum input).
  if (/^\d{4}$/.test(s)) {
    const y = Number(s);
    if (y >= 1900 && y <= 2100) return null;
  }
  const negative = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

// Whether the raw string looked like money (so we apply currency formatting).
function looksLikeMoney(v) {
  const s = String(v == null ? "" : v).trim();
  return /[$,]/.test(s) || /\.\d/.test(s) || /^\(.*\)$/.test(s);
}

function isTotalLabel(cell) {
  return /\b(total|subtotal|net\s+(income|profit|loss)|grand\s+total|taxable\s+income|ordinary\s+income)\b/i.test(String(cell || ""));
}

function isFlagCell(v) {
  return /\b(TBD|NOT\s+FOUND|N\/A|MISSING|VERIFY|NEEDS?\s+REVIEW|UNRECONCILED)\b/i.test(String(v || "")) || /^[⚠❌]/.test(String(v || ""));
}

function colLetter(n) {
  let name = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    num = Math.floor((num - 1) / 26);
  }
  return name;
}

// Detect the header row: first row with >=2 non-empty cells and no numeric cells.
function findHeaderRowIndex(rows) {
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const row = rows[r] || [];
    const nonEmpty = row.filter((c) => String(c ?? "").trim()).length;
    const numeric = row.filter((c) => parseNum(c) !== null).length;
    if (nonEmpty >= 2 && numeric === 0) return r;
  }
  return -1;
}

// Inject a SUM formula into (totalR, c) only if the contiguous numeric block directly
// above reconciles with the total the AI already produced. Returns { formula, value } or null.
function safeSumFormula(rows, totalR, c) {
  const totalVal = parseNum(rows[totalR][c]);
  if (totalVal === null) return null; // no verification target -> never inject
  let start = -1;
  let end = -1;
  const nums = [];
  for (let r = totalR - 1; r >= 0; r--) {
    if (isTotalLabel((rows[r] || [])[0])) break;   // don't cross another total row
    const n = parseNum((rows[r] || [])[c]);
    if (n === null) {
      if (end !== -1) break; // block ended
      continue;              // skip leading blanks between total and block
    }
    if (end === -1) end = r;
    start = r;
    nums.push(n);
  }
  if (start === -1 || nums.length < 2) return null;         // need a real block to sum
  const sum = Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
  if (Math.abs(sum - totalVal) > 0.01) return null;         // does not reconcile -> keep static
  const col = colLetter(c + 1);
  const range = `${col}${start + 1}:${col}${end + 1}`;
  return { formula: `IFERROR(SUM(${range}),${totalVal})`, value: totalVal };
}

function styleSheet(ws, sheet) {
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  const headerR = findHeaderRowIndex(rows);
  const colCount = rows.reduce((m, row) => Math.max(m, (row || []).length), 1);

  rows.forEach((rawRow, r) => {
    const row = Array.isArray(rawRow) ? rawRow : [rawRow];
    const firstCell = String(row[0] ?? "");
    const isTitle = r < headerR && row.filter((c) => String(c ?? "").trim()).length <= 1;
    const isHeader = r === headerR;
    const isTotal = isTotalLabel(firstCell);

    for (let c = 0; c < colCount; c++) {
      const cell = ws.getCell(r + 1, c + 1);
      const raw = row[c];
      const num = parseNum(raw);

      // Value: real number when it is one; a proven SUM formula on total rows; else text.
      if (isTotal && num !== null) {
        const f = safeSumFormula(rows, r, c);
        if (f) {
          cell.value = { formula: f.formula, result: f.value };
        } else {
          cell.value = num;
        }
        cell.numFmt = CURRENCY_FMT;
      } else if (num !== null && !isHeader && !isTitle) {
        cell.value = num;
        if (looksLikeMoney(raw)) cell.numFmt = CURRENCY_FMT;
      } else {
        cell.value = raw == null ? "" : String(raw);
      }

      // Styling.
      if (isTitle) {
        cell.font = { bold: true, size: 13, color: { argb: TITLE_COLOR } };
      } else if (isHeader) {
        cell.font = { bold: true, color: { argb: WHITE } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = thinBorder;
      } else {
        if (isTotal) {
          cell.font = { bold: true };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBTOTAL_FILL } };
        }
        if (isFlagCell(raw)) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FLAG_FILL } };
          cell.font = { ...(cell.font || {}), color: { argb: FLAG_TEXT } };
        }
        if (headerR >= 0 && r > headerR) cell.border = thinBorder;
        if (typeof cell.value === "number") cell.alignment = { horizontal: "right" };
      }
    }
  });

  // Column widths from content (min 10, max 46).
  for (let c = 0; c < colCount; c++) {
    let width = 10;
    for (const row of rows) {
      const len = String((row || [])[c] ?? "").length;
      if (len + 2 > width) width = Math.min(len + 2, 46);
    }
    ws.getColumn(c + 1).width = width;
  }

  // Freeze under the header row (or the first row) so headers stay visible while scrolling.
  const freezeAt = headerR >= 0 ? headerR + 1 : 1;
  ws.views = [{ state: "frozen", ySplit: freezeAt }];

  // Honor any explicit style entries the upstream normalizer produced (they win).
  if (Array.isArray(sheet.styles)) {
    for (const st of sheet.styles) {
      const cell = ws.getCell(Number(st.r) + 1, Number(st.c) + 1);
      if (st.bold) cell.font = { ...(cell.font || {}), bold: true };
      if (st.fontColor) cell.font = { ...(cell.font || {}), color: { argb: `FF${String(st.fontColor).replace(/^#/, "").toUpperCase()}` } };
      if (st.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${String(st.fill).replace(/^#/, "").toUpperCase()}` } };
      if (st.numFmt) cell.numFmt = st.numFmt;
    }
  }
}

function safeSheetName(name, used) {
  let base = String(name || "Sheet").replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet";
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

async function buildStyledWorkpaperXlsx(workbook) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RAG Tax AI";
  wb.created = new Date();
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  const used = new Set();
  if (!sheets.length) {
    wb.addWorksheet("Workbook").getCell("A1").value = "No sheets were generated.";
  }
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(safeSheetName(sheet.name, used));
    styleSheet(ws, sheet);
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { buildStyledWorkpaperXlsx, parseNum, safeSumFormula };
