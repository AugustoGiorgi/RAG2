"use strict";

/**
 * m1-reconciliation.js — fixed-structure Book-to-Tax (Schedule M-1) sheet.
 *
 * Why this exists: when the AI was free to lay out the reconciliation however it liked,
 * two runs of the same input diverged badly (different adjustment lines, flipped signs,
 * subtotals left blank or wrongly summed). The fix is to fix the SHAPE:
 *   - The set of M-1 adjustment lines and their order is defined here in code, so every
 *     run produces the identical structure. The AI only supplies the signed amount for
 *     each named line (0/absent when it does not apply).
 *   - The subtotals (Adjusted Net Income, Ordinary Business Income) are written as live
 *     Excel formulas over the exact cells this code placed, so when the preparer edits any
 *     line the totals recalculate. The formulas are code-controlled and IFERROR-wrapped by
 *     the workbook generator, so they cannot break.
 *   - Separately stated items are listed in their own section and are NOT summed into
 *     ordinary income (the bug that produced a wrong taxable income before).
 *
 * Input: reconciliation = {
 *   netIncomePerBooks: number,
 *   ajes: [{ label, amount, note }],           // signed amounts
 *   m1: { <fixedKey>: signedAmount, ... },     // fixed keys below
 *   separatelyStated: [{ label, amount, note }]
 * }
 * Output: { name, rows } — rows use { formula, value } objects for the live subtotals.
 */

// Fixed M-1 adjustment lines, in fixed order. The AI fills m1[key] with a SIGNED amount
// (+ increases taxable income, − decreases). Labels state the standard direction so the
// AI and the reviewing CPA stay consistent; the CPA can edit any amount and the live
// formulas recompute.
const M1_LINES = [
  { key: "meals50", label: "Add back: Meals — 50% nondeductible portion" },
  { key: "entertainment", label: "Add back: Entertainment (100% nondeductible)" },
  { key: "penalties", label: "Add back: Penalties & fines" },
  { key: "politicalLobbying", label: "Add back: Political contributions & lobbying" },
  { key: "officerLifeInsurance", label: "Add back: Officer / key-person life insurance premiums" },
  { key: "federalIncomeTax", label: "Add back: Federal income tax expense (C-corp only)" },
  { key: "charitable", label: "Adjust: Charitable contributions (separately stated for pass-through)" },
  { key: "taxExemptInterest", label: "Less: Tax-exempt interest income" },
  { key: "depreciationBookVsTax", label: "Depreciation: book vs tax difference (signed)" },
  { key: "sec179Bonus", label: "Section 179 / bonus depreciation adjustment (signed)" },
  { key: "gainLossBookVsTax", label: "Gain/loss on asset dispositions: book vs tax (signed)" },
  { key: "section163j", label: "Add back: Section 163(j) disallowed interest" },
  { key: "otherPermanent", label: "Other permanent differences (signed)" },
  { key: "otherTiming", label: "Other timing differences (signed)" },
];

function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const neg = /^\(.*\)$/.test(String(v || "").trim());
  const x = Number(String(v == null ? "" : v).replace(/[(),$\s]/g, ""));
  if (!Number.isFinite(x)) return 0;
  return neg ? -Math.abs(x) : x;
}
function round2(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
}

// Only build when the AI actually gave us a reconciliation with a book income anchor.
function hasReconciliation(reconciliation) {
  return Boolean(reconciliation && typeof reconciliation === "object"
    && (reconciliation.netIncomePerBooks !== undefined && reconciliation.netIncomePerBooks !== null && String(reconciliation.netIncomePerBooks) !== ""));
}

function buildM1Sheet(reconciliation = {}, entityType = "") {
  const rows = [];
  const netIncome = round2(num(reconciliation.netIncomePerBooks));
  const ajes = Array.isArray(reconciliation.ajes) ? reconciliation.ajes : [];
  const m1 = reconciliation.m1 && typeof reconciliation.m1 === "object" ? reconciliation.m1 : {};
  const sepStated = Array.isArray(reconciliation.separatelyStated) ? reconciliation.separatelyStated : [];

  rows.push([`BOOK-TO-TAX RECONCILIATION (Schedule M-1)${entityType ? ` — ${entityType}` : ""}`]);
  rows.push(["Description", "Amount", "Notes / Source"]); // header row (index 1)

  const niIdx = rows.length;
  rows.push(["Net Income (Loss) per Books", netIncome, "From P&L (edit here to reflow everything below)"]);

  rows.push(["Adjusting Journal Entries (from AJE Worksheet):", "", ""]);
  const ajeStartIdx = rows.length;
  let ajeSum = 0;
  for (const a of ajes) {
    const amt = round2(num(a.amount));
    ajeSum += amt;
    rows.push([String(a.label || "AJE"), amt, String(a.note || "")]);
  }
  const ajeEndIdx = rows.length - 1;
  const adjIdx = rows.length;
  const adjustedVal = round2(netIncome + ajeSum);
  const ajeRange = ajeEndIdx >= ajeStartIdx ? `+SUM(B${ajeStartIdx + 1}:B${ajeEndIdx + 1})` : "";
  rows.push(["Adjusted Net Income per Books", { formula: `B${niIdx + 1}${ajeRange}`, value: adjustedVal }, "Net income + AJEs (live)"]);

  rows.push(["Book-to-Tax Adjustments (Schedule M-1):", "", ""]);
  const m1StartIdx = rows.length;
  let m1Sum = 0;
  for (const line of M1_LINES) {
    const amt = round2(num(m1[line.key]));
    m1Sum += amt;
    rows.push([line.label, amt, ""]);
  }
  const m1EndIdx = rows.length - 1;
  const ordIdx = rows.length;
  const ordVal = round2(adjustedVal + m1Sum);
  rows.push(["Ordinary Business Income (Tax)", { formula: `B${adjIdx + 1}+SUM(B${m1StartIdx + 1}:B${m1EndIdx + 1})`, value: ordVal }, "Adjusted NI + M-1 adjustments (live)"]);
  void ordIdx;

  if (sepStated.length) {
    rows.push(["Separately Stated Items (flow to K-1 / NOT in ordinary income):", "", ""]);
    for (const s of sepStated) rows.push([String(s.label || ""), round2(num(s.amount)), String(s.note || "")]);
  }

  return { name: "Book to Tax (M-1)", rows };
}

module.exports = { buildM1Sheet, hasReconciliation, M1_LINES };
