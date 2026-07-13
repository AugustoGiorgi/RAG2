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
  { key: "ownerHealthcare", label: "Owner healthcare premiums (1065: guaranteed payment / 1120-S: W-2 wages — signed)" },
  { key: "homeOffice", label: "Home office (reclass / accountable-plan treatment, signed)" },
  { key: "creditCardRewards", label: "Credit card rewards / rebates (nontaxable reduction of expense, signed)" },
  { key: "taxExemptInterest", label: "Less: Tax-exempt interest income" },
  { key: "depreciationBookVsTax", label: "Depreciation: book vs tax difference (signed)" },
  { key: "sec179Bonus", label: "Section 179 / bonus depreciation adjustment (signed)" },
  { key: "gainLossBookVsTax", label: "Gain/loss on asset dispositions: book vs tax (signed)" },
  { key: "assetSaleIncomeRemoval", label: "Less: Asset sale proceeds/gain booked as income — removed to Form 4797 (separately stated)" },
  { key: "portfolioIncomeRemoval", label: "Less: Portfolio income booked in P&L (interest / dividends incl. foreign) — separately stated" },
  { key: "foreignTaxesPaid", label: "Add back: Foreign taxes paid/withheld expensed on books (separately stated for FTC)" },
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
  let ajes = Array.isArray(reconciliation.ajes) ? reconciliation.ajes : [];
  const m1 = reconciliation.m1 && typeof reconciliation.m1 === "object" ? reconciliation.m1 : {};
  const sepStated = Array.isArray(reconciliation.separatelyStated) ? reconciliation.separatelyStated : [];

  // Anti-double-count guard: the subtotals add Net Income + all AJEs + all m1 keys, so an
  // economic item placed BOTH as an AJE and in its m1 fixed key would hit taxable income
  // twice (run 62 did exactly this with home office: +14,765.09 as an AJE reclass AND as the
  // m1 addback). Per the pinned rules the m1 key wins: drop any AJE whose amount matches a
  // nonzero m1 key to the cent (same or opposite sign) AND whose label clearly belongs to
  // that key's domain — both conditions, so a coincidental amount can never drop a real AJE.
  const DOUBLE_COUNT_DOMAINS = {
    assetSaleIncomeRemoval: /asset\s*sale|sale\s*of\s*asset|proceeds|4797|1231|disposition|gain\s*on\s*sale/i,
    homeOffice: /home\s*office/i,
    ownerHealthcare: /health|sehi|medical\s*premium/i,
    creditCardRewards: /reward|rebate|cash\s*back/i,
    portfolioIncomeRemoval: /interest|dividend|portfolio/i,
    meals50: /meal/i,
    entertainment: /entertain/i,
    charitable: /charit|donation|contribution/i,
    taxExemptInterest: /tax.?exempt/i,
  };
  const activeGuards = Object.entries(DOUBLE_COUNT_DOMAINS)
    .map(([key, re]) => ({ re, amt: round2(num(m1[key])) }))
    .filter((g) => g.amt !== 0);
  if (activeGuards.length) {
    ajes = ajes.filter((a) => {
      const amt = round2(num(a && a.amount));
      if (amt === 0) return true; // zero-impact reclass memos always stay
      const label = String((a && a.label) || "");
      return !activeGuards.some((g) => Math.abs(Math.abs(amt) - Math.abs(g.amt)) <= 0.01 && g.re.test(label));
    });
  }

  // A 1040 with business financials gets the same fixed reconciliation engine but framed as
  // a Schedule C/E business-income reconciliation (individuals file no Schedule M-1).
  const is1040 = /^1040$/i.test(String(entityType).replace(/\s+/g, ""));
  const title = is1040
    ? "BUSINESS INCOME RECONCILIATION (Schedule C / Schedule E) — 1040"
    : `BOOK-TO-TAX RECONCILIATION (Schedule M-1)${entityType ? ` — ${entityType}` : ""}`;
  rows.push([title]);
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
  const ordLabel = is1040 ? "Net Business Income (Schedule C/E, Tax)" : "Ordinary Business Income (Tax)";
  rows.push([ordLabel, { formula: `B${adjIdx + 1}+SUM(B${m1StartIdx + 1}:B${m1EndIdx + 1})`, value: ordVal }, "Adjusted NI + tax adjustments (live)"]);
  void ordIdx;

  if (sepStated.length) {
    const sepHeader = is1040
      ? "Items Reported Elsewhere on Form 1040 (NOT in Schedule C/E income):"
      : "Separately Stated Items (flow to K-1 / NOT in ordinary income):";
    rows.push([sepHeader, "", ""]);
    for (const s of sepStated) rows.push([String(s.label || ""), round2(num(s.amount)), String(s.note || "")]);
  }

  return { name: is1040 ? "Book to Tax (Sch C-E)" : "Book to Tax (M-1)", rows };
}

module.exports = { buildM1Sheet, hasReconciliation, M1_LINES };
