"use strict";

/**
 * corporate-return-checks.js — cross-checks validated on a real Form 1120.
 *
 * The 1120 was the least covered return type in the library: it shares nothing with the K-1
 * and M-2 shapes the partnership checks read, so a blind run over a two-year corporate
 * package surfaced under a third of what a manual review found. Everything here was written
 * against that package, read through the same pdf.js path production uses.
 *
 * Four of the six need the prior year or the workpaper, which is the point — a corporate
 * return that is wrong is usually wrong in a way that only shows when you put this year next
 * to last year, or the return next to the books. Nothing on the face of the return looks off.
 *
 * As everywhere else in lib/, each check fails CLOSED: an anchor it cannot read produces no
 * finding rather than an invented one.
 */

const { amountsOn, splitReturns, returnTextOf, linesOf } = require("./entity-return-checks");

const money = (n) => Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
const round2 = (n) => Math.round(n * 100) / 100;
const differs = (a, b, tolerance = 1) => Math.abs(a - b) >= tolerance;
const pct = (n) => `${(Math.round(n * 100) / 100).toFixed(2)}%`;

/** Figures on the first line matching `pattern`, or null when the form did not extract. */
function valuesOn(text, pattern) {
  for (const line of linesOf(text)) {
    if (!pattern.test(line)) continue;
    const values = amountsOn(line);
    if (values.length) return values;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * 1. Shareholder capital routed through retained earnings.
 *
 * Schedule M-2 analyses unappropriated retained earnings. Money the owners put in is not
 * earnings, and it belongs in paid-in capital on Schedule L. A real 1120 ran $4,187,190 of
 * shareholder contributions through M-2 line 3 and left additional paid-in capital at exactly
 * the figure it opened the year with. The balance sheet still balanced — the error moves the
 * same amount between two equity lines — so retained earnings read $4.19M better than they
 * were and paid-in capital $4.19M worse.
 *
 * The prior-year return of the same company had recorded the same item correctly, in paid-in
 * capital, with M-2 line 3 empty. A one-year regression, which is the kind nobody catches
 * from inside the current year.
 * ------------------------------------------------------------------------- */

const M2_OTHER_INCREASES_STATEMENT = /SCHEDULE\s*M-2,\s*LINE\s*3/i;
const CONTRIBUTION_ROW = /\bcontribut/i;
const PAID_IN_CAPITAL = /^\s*23\s+Additional paid-in capital/i;

function checkContributionsThroughRetainedEarnings(text) {
  // The statement behind M-2 line 3, and whether what it itemises is capital.
  const lines = linesOf(text);
  const start = lines.findIndex((line) => M2_OTHER_INCREASES_STATEMENT.test(line));
  if (start === -1) return null;
  const block = lines.slice(start + 1, start + 8);
  const contribution = block.find((line) => CONTRIBUTION_ROW.test(line) && !/^\s*TOTAL\b/i.test(line));
  if (!contribution) return null;
  const amount = valuesOn(block.join("\n"), /TOTAL/i) || amountsOn(contribution);
  const contributed = amount && amount.length ? Math.abs(amount[amount.length - 1]) : null;
  if (!contributed) return null;

  const paidIn = valuesOn(text, PAID_IN_CAPITAL);
  if (!paidIn || paidIn.length < 2) return null;
  const [beginning, ending] = [paidIn[0], paidIn[paidIn.length - 1]];
  // If paid-in capital moved, the contribution was recorded where it belongs and this is a
  // different item — say, a debt forgiveness — that M-2 may legitimately carry.
  if (differs(beginning, ending, 1)) return null;

  return {
    severity: "HIGH",
    category: "Capital accounts",
    title: "Shareholder contributions were run through retained earnings",
    detail: `Schedule M-2 line 3 reports ${money(contributed)} of contributions as an increase to unappropriated retained earnings, and Schedule L additional paid-in capital opens and closes the year at the same ${money(beginning)}. Money the shareholders put in is not earnings: it belongs in paid-in capital. The balance sheet still balances because the error moves one figure between two equity lines, so retained earnings read ${money(contributed)} better than they are and paid-in capital that much worse.`,
    action: "Move the contributions to Schedule L additional paid-in capital and take them off Schedule M-2 line 3. Check how the prior-year return handled the same item — if it was recorded correctly then, this is a one-year regression and the comparative balance sheet will not tie until it is fixed.",
    authority: "Form 1120 Schedule M-2 (analysis of unappropriated retained earnings); Schedule L lines 22–23; IRC §118 and §1032",
  };
}

/* ---------------------------------------------------------------------------
 * 2. Schedule M-1 line 1 is not what the books say.
 *
 * Line 1 is net income per books, and it is the one figure on the reconciliation that is not
 * a judgement call — it either equals the workpaper or it does not. On a real 1120 it was
 * $74,637 below the books, which happened to be exactly the year's book-to-tax amortization
 * difference: the difference had been folded into "book" income instead of being disclosed as
 * a reconciling item, so the M-1 balanced to the right taxable income while reconciling
 * nothing and hiding the only real difference on the return.
 * ------------------------------------------------------------------------- */

const M1_LINE_1 = /^\s*1\s+Net income \(loss\) per books/i;
/** The workpaper's own bottom line. */
const BOOK_NET_INCOME = /^\s*(?:"?net income"?)\s*[,;]/i;
const PROFIT_AND_LOSS = /profit and loss|net operating income|income statement/i;

function bookNetIncome(files) {
  for (const file of Array.isArray(files) ? files : []) {
    const text = String((file && (file.fullText || file.text)) || "");
    if (!PROFIT_AND_LOSS.test(text)) continue;
    for (const line of linesOf(text)) {
      if (!BOOK_NET_INCOME.test(line)) continue;
      const values = amountsOn(line);
      // Two columns means this year then last year; the first is the one being filed.
      if (values.length) return values[0];
    }
  }
  return null;
}

function checkScheduleM1TiesToBooks(text, files) {
  const onReturn = valuesOn(text, M1_LINE_1);
  if (!onReturn) return null;
  const stated = onReturn[0];
  const books = bookNetIncome(files);
  if (books === null) return null;
  // Filed returns are whole-dollar and workpapers carry cents; a couple of dollars of
  // rounding is not a finding worth anyone's time.
  const gap = round2(stated - books);
  if (Math.abs(gap) < 3) return null;

  return {
    severity: "HIGH",
    category: "Book-to-tax reconciliation",
    title: "Schedule M-1 line 1 does not equal net income per books",
    detail: `Schedule M-1 line 1 reports ${money(stated)} of net income per books; the workpaper's profit and loss ends the year at ${money(books)}, a difference of ${money(gap)}. Line 1 is the one figure on the reconciliation that is not a judgement call, and everything below it is measured from there.`,
    action: "Put the workpaper's net income on line 1 and show whatever was folded into it as its own reconciling item further down. An M-1 that starts from an adjusted figure can still arrive at the right taxable income while disclosing none of the differences it exists to disclose.",
    authority: "Form 1120 Schedule M-1 line 1; Form 1065 Schedule M-1 line 1; Form 1120-S Schedule M-1 line 1",
  };
}

/* ---------------------------------------------------------------------------
 * 3. Amortization on the return that the books never recorded.
 *
 * Schedule L carries accumulated amortization at both ends of the year, so the year's charge
 * is a subtraction, and the workpaper says what the books took. On a real 1120 the return
 * moved accumulated amortization by $168,431 against $93,794 in the books — and the two had
 * agreed exactly at the start of the year, so the whole gap opened in the year under review,
 * with no Form 4562 in the package and nothing on Schedule M-1 about it.
 * ------------------------------------------------------------------------- */

const ACCUMULATED_AMORTIZATION = /Less accumulated amortization/i;
const BOOK_AMORTIZATION = /^\s*"?amortization(?:\s+expense)?s?"?\s*[,;]/i;

function bookAmortization(files) {
  for (const file of Array.isArray(files) ? files : []) {
    const text = String((file && (file.fullText || file.text)) || "");
    if (!/^---\s*Sheet:/m.test(text) && !/\.(xlsx|xlsm|xls|csv)$/i.test(String(file?.name || ""))) continue;
    for (const line of linesOf(text)) {
      if (!BOOK_AMORTIZATION.test(line)) continue;
      const values = amountsOn(line);
      if (values.length) return Math.abs(values[0]);
    }
  }
  return null;
}

function checkAmortizationAgainstBooks(text, files) {
  const columns = valuesOn(text, ACCUMULATED_AMORTIZATION);
  // Schedule L prints ( beginning ) net ( ending ) net for this line.
  if (!columns || columns.length < 3) return null;
  const beginning = Math.abs(columns[0]);
  const ending = Math.abs(columns[2]);
  const onReturn = round2(ending - beginning);
  if (onReturn <= 0) return null;

  const inBooks = bookAmortization(files);
  if (inBooks === null) return null;
  const gap = round2(onReturn - inBooks);
  if (Math.abs(gap) < 1) return null;

  return {
    severity: "HIGH",
    category: "Amortization",
    title: "The return amortizes more than the books did, with nothing to show for it",
    detail: `Schedule L moves accumulated amortization from ${money(beginning)} to ${money(ending)}, a charge of ${money(onReturn)} for the year. The workpaper records ${money(inBooks)}. The ${money(Math.abs(gap))} difference is ${gap > 0 ? "deducted on the return and never expensed in the books" : "expensed in the books and never deducted"}.`,
    action: "Find the schedule behind the return's figure. A legitimate book-to-tax difference belongs on Schedule M-1 and on Form 4562; if neither carries it, the deduction is unsupported. Check the implied life against the cost of the intangible — acquired section 197 intangibles amortize over fifteen years whatever the books elected.",
    authority: "IRC §197 (fifteen-year amortization of acquired intangibles); Form 4562 Part VI; Schedule M-1",
  };
}

/* ---------------------------------------------------------------------------
 * 4. Shareholder loans filed as though they were trade payables.
 *
 * Schedule L gives loans from shareholders their own line because related-party debt is
 * looked at differently from everything else on the balance sheet: it carries the section
 * 267 matching rule, the section 7872 imputed-interest rules and the risk of being recast as
 * equity. A real 1120 put $598,058 owed to its only two shareholders into "other current
 * liabilities" and left line 19 empty — and the books called the same balances long-term.
 * ------------------------------------------------------------------------- */

const OTHER_LIABILITIES_STATEMENT = /SCHEDULE\s*L,\s*LINE\s*(?:18|21)/i;
const LOAN_ROW = /\bloan\b|\bnote\s+payable\b|\bdue to\b/i;
const LOANS_FROM_SHAREHOLDERS = /^\s*19\s+Loans from shareholders/i;
/** Schedule G names every individual owning 20% or more of the voting stock. */
const SCHEDULE_G_OWNER = /^([A-Z][A-Z'.-]+(?:\s+[A-Z][A-Z'.-]+)+)\s+\d{3}-\d{2}-\d{4}\b/;

function scheduleGOwners(text) {
  const names = [];
  for (const line of linesOf(text)) {
    const hit = SCHEDULE_G_OWNER.exec(line.trim());
    if (hit) names.push(hit[1].trim());
  }
  return [...new Set(names)];
}

/** A statement row naming a loan, paired with any owner whose name appears in it. */
function shareholderLoanRows(text, owners) {
  const lines = linesOf(text);
  const rows = [];
  lines.forEach((line, index) => {
    if (!OTHER_LIABILITIES_STATEMENT.test(line)) return;
    for (const row of lines.slice(index + 1, index + 16)) {
      if (/^\s*TOTAL\b/i.test(row)) break;
      if (!LOAN_ROW.test(row)) continue;
      const owner = owners.find((name) => name.split(/\s+/).some((part) => part.length > 2 && new RegExp(`\\b${part}\\b`, "i").test(row)));
      if (!owner) continue;
      const values = amountsOn(row);
      if (!values.length) continue;
      rows.push({ owner, amount: Math.abs(values[values.length - 1]), label: row.replace(/\.{2,}|\s\.(\s\.)+/g, " ").replace(/[\s\d,$.()-]+$/, "").replace(/\s+/g, " ").trim() });
    }
  });
  return rows;
}

function checkShareholderLoansMisclassified(text) {
  const owners = scheduleGOwners(text);
  if (!owners.length) return null;
  const rows = shareholderLoanRows(text, owners);
  if (!rows.length) return null;
  // If line 19 already carries something, the preparer knows the line exists and this is at
  // most a split; leave it alone rather than second-guess the allocation.
  if (valuesOn(text, LOANS_FROM_SHAREHOLDERS)) return null;

  const total = round2(rows.reduce((sum, row) => sum + row.amount, 0));
  const named = rows.map((row) => `"${row.label}" ${money(row.amount)}`).join("; ");
  return {
    severity: "MEDIUM",
    category: "Related-party debt",
    title: "Loans from shareholders are filed as other liabilities",
    detail: `The Schedule L statement reports ${named} — ${money(total)} owed to ${rows.length > 1 ? "people" : "someone"} named on Schedule G as owning the corporation's stock — and Schedule L line 19, "Loans from shareholders", is empty.`,
    action: "Move the balances to line 19. The line exists because related-party debt is examined differently: interest accrued to a more-than-50% shareholder is not deductible until paid under section 267(a)(2), a below-market loan draws section 7872, and debt that funds a company with negative equity invites recharacterisation as capital.",
    authority: "Form 1120 Schedule L line 19; IRC §267(a)(2); IRC §7872; IRC §385",
  };
}

/* ---------------------------------------------------------------------------
 * 5. A loan the corporation made to its own shareholder.
 *
 * The mirror image of the above, and it produces income rather than denying a deduction: a
 * corporation that lends to a shareholder at no interest is treated under section 7872 as
 * receiving interest it never collected and paying a distribution it never declared. A real
 * 1120 carried a $200,000 receivable from a 42% shareholder, unchanged across two years.
 * ------------------------------------------------------------------------- */

const OTHER_ASSETS_STATEMENT = /SCHEDULE\s*L,\s*LINE\s*(?:6|14)/i;
const RECEIVABLE_ROW = /\bloan\s+receivable\b|\bnote\s+receivable\b|\bdue from\b|\badvance(?:s)?\s+to\b/i;

function checkLoanToShareholder(text) {
  const owners = scheduleGOwners(text);
  if (!owners.length) return null;
  const lines = linesOf(text);
  const found = [];
  lines.forEach((line, index) => {
    if (!OTHER_ASSETS_STATEMENT.test(line)) return;
    for (const row of lines.slice(index + 1, index + 14)) {
      if (/^\s*TOTAL\b/i.test(row)) break;
      if (!RECEIVABLE_ROW.test(row)) continue;
      const owner = owners.find((name) => name.split(/\s+/).some((part) => part.length > 2 && new RegExp(`\\b${part}\\b`, "i").test(row)));
      if (!owner) continue;
      const values = amountsOn(row);
      if (!values.length) continue;
      found.push({ owner, amount: Math.abs(values[values.length - 1]), label: row.replace(/\.{2,}|\s\.(\s\.)+/g, " ").replace(/[\s\d,$.()-]+$/, "").replace(/\s+/g, " ").trim() });
    }
  });
  if (!found.length) return null;
  const unique = [...new Map(found.map((f) => [f.label.toLowerCase(), f])).values()].slice(0, 3);
  const total = round2(unique.reduce((sum, row) => sum + row.amount, 0));
  return {
    severity: "MEDIUM",
    category: "Related-party debt",
    title: "The corporation is carrying a loan to its own shareholder",
    detail: `Schedule L reports ${unique.map((row) => `"${row.label}" ${money(row.amount)}`).join("; ")}, and ${unique.length > 1 ? "those names appear" : "that name appears"} on Schedule G as an owner of the corporation's stock. ${money(total)} is out to an owner.`,
    action: "Establish the terms. A shareholder loan carrying no interest, or interest below the applicable federal rate, is recharacterised under section 7872: the corporation reports interest income it never received and the shareholder takes a distribution. A loan with no note, no rate and no repayment history is exposed to being treated as a distribution outright.",
    authority: "IRC §7872 (below-market loans); IRC §301 (distributions); Reg. §1.7872-15",
  };
}

/* ---------------------------------------------------------------------------
 * 7. Interest accrued to a shareholder and never paid.
 *
 * Section 267(a)(2) matches the deduction to the payee's income: an accrual-method
 * corporation cannot deduct interest owed to a related cash-method person until it is
 * actually paid. A real 1120 deducted $75,016 of interest, owed the money to the two people
 * who between them own all of its stock, and carried $10,868 of accrued interest that had not
 * moved a dollar in two years — the same balance at both ends of the year, which is what an
 * accrual nobody pays looks like.
 * ------------------------------------------------------------------------- */

const ACCRUED_INTEREST_ROW = /accrued\s+interest/i;
/** Form 1120 line 18, Form 1065 line 15, Form 1120-S line 13. */
const INTEREST_DEDUCTED = /^\s*(?:13|15|18)\s+Interest\b/i;

function accruedInterestBalances(text) {
  const lines = linesOf(text);
  for (const [index, line] of lines.entries()) {
    if (!OTHER_LIABILITIES_STATEMENT.test(line)) continue;
    for (const row of lines.slice(index + 1, index + 16)) {
      if (/^\s*TOTAL\b/i.test(row)) break;
      if (!ACCRUED_INTEREST_ROW.test(row)) continue;
      const values = amountsOn(row);
      if (values.length < 2) continue;
      return { beginning: Math.abs(values[0]), ending: Math.abs(values[values.length - 1]) };
    }
  }
  return null;
}

function checkAccruedInterestToShareholder(text) {
  const owners = scheduleGOwners(text);
  if (!owners.length) return null;
  // The interest has to be owed to an owner, which the loan rows establish.
  const loans = shareholderLoanRows(text, owners);
  if (!loans.length) return null;

  const accrued = accruedInterestBalances(text);
  if (!accrued || accrued.ending < 1000) return null;
  // A balance that moved was being paid down; only a stationary one raises the question.
  if (differs(accrued.beginning, accrued.ending, 1)) return null;

  const deducted = valuesOn(text, INTEREST_DEDUCTED);
  if (!deducted) return null;
  const interest = Math.abs(deducted[deducted.length - 1]);
  if (interest < 1000) return null;

  return {
    severity: "MEDIUM",
    category: "Related-party debt",
    title: "Interest accrued to a shareholder that has not moved in a year",
    detail: `The return deducts ${money(interest)} of interest and owes ${money(round2(loans.reduce((sum, row) => sum + row.amount, 0)))} to ${loans.length > 1 ? "people" : "someone"} named on Schedule G as an owner. Accrued interest opens the year at ${money(accrued.beginning)} and closes it at the same ${money(accrued.ending)}: not a dollar of it was paid.`,
    action: "Establish who the interest is owed to and on what method they report. Under section 267(a)(2) an accrual-method corporation cannot deduct interest payable to a related cash-method person until the payment is actually made, so any part of the deduction matching a balance that never moves is premature and belongs on Schedule M-1 until it is paid.",
    authority: "IRC §267(a)(2) and §267(b); Reg. §1.267(a)-1",
  };
}

/* ---------------------------------------------------------------------------
 * 6. An apportionment factor that moved and took nothing with it.
 *
 * State apportionment is the quietest place on a return for a large number to change. A real
 * 1120 moved New Jersey from 100% to 18.39% and New York City from 3.14% to 1.58% in one
 * year, on a business whose receipts and offices had not changed. Reading the New Jersey
 * schedule afterwards, the entire in-state numerator was interest income and not a dollar of
 * the year's service revenue was sourced to the state the company is headquartered in.
 *
 * This does not decide who is right — market-based sourcing genuinely does move — it makes
 * sure a swing of this size is a decision somebody made rather than one the software made.
 * ------------------------------------------------------------------------- */

/**
 * Named one jurisdiction at a time, deliberately.
 *
 * A general pattern over "allocation factor" and its synonyms was tried first and it read the
 * form's own line numbers, page footers and instruction text as factors — nineteen "factors"
 * on a return that has three. The lines that carry a real one are few and their wording is
 * fixed by the form, so naming them costs one entry per state and produces no noise. Anything
 * not listed here is simply not checked, which is the honest outcome for a state whose
 * layout nobody has looked at.
 */
const FACTOR_LINES = [
  { jurisdiction: "New Jersey", pattern: /Allocation Factor \(Percentage in New Jersey\)/i },
  { jurisdiction: "New York State", pattern: /New York State business apportionment factor/i },
  { jurisdiction: "New York City", pattern: /business allocation percentage either from Part 1/i },
];
/**
 * A factor is printed either as a six-decimal fraction (".183915", "1.000000") or as a
 * percentage carrying decimals ("1.5764 %"). Requiring the decimals is what separates a
 * factor from the line number sitting in the same column.
 */
const FACTOR_VALUE = /(\d{0,3}\.\d{2,6})\s*(%)?\s*$/;
const APPORTIONMENT_LOOKAHEAD = 6;
/** Below this, two factors are close enough that the swing is not worth a question. */
const MIN_FACTOR_POINTS = 1;
const MIN_RELATIVE_SWING = 0.25;

/** Every apportionment factor the return prints, keyed by jurisdiction. */
function apportionmentFactors(text) {
  const lines = linesOf(text);
  const found = new Map();
  lines.forEach((line, index) => {
    const match = FACTOR_LINES.find((entry) => entry.pattern.test(line));
    if (!match || found.has(match.jurisdiction)) return;
    // The value sits on the label's line or, where the caption wraps, a few lines below it.
    for (const candidate of lines.slice(index, index + APPORTIONMENT_LOOKAHEAD)) {
      const hit = FACTOR_VALUE.exec(candidate.trim());
      if (!hit) continue;
      const raw = Number(hit[1]);
      if (!Number.isFinite(raw)) continue;
      // A decimal at or under 1 with no percent sign is a fraction of the whole.
      const percent = hit[2] || raw > 1 ? raw : raw * 100;
      if (percent < 0 || percent > 100) continue;
      found.set(match.jurisdiction, { jurisdiction: match.jurisdiction, percent });
      break;
    }
  });
  return found;
}

function checkApportionmentSwing(currentText, priorText, priorLabel) {
  if (!priorText) return null;
  const now = apportionmentFactors(currentText);
  const before = apportionmentFactors(priorText);
  if (!now.size || !before.size) return null;

  const swings = [];
  for (const [jurisdiction, current] of now) {
    const prior = before.get(jurisdiction);
    if (!prior) continue;
    const largest = Math.max(current.percent, prior.percent);
    if (largest < MIN_FACTOR_POINTS) continue;
    const change = Math.abs(current.percent - prior.percent);
    if (change / largest < MIN_RELATIVE_SWING) continue;
    swings.push({ ...current, prior: prior.percent });
  }
  if (!swings.length) return null;

  const named = swings
    .slice(0, 4)
    .map((swing) => `${swing.jurisdiction} went from ${pct(swing.prior)} to ${pct(swing.percent)}`)
    .join(", and ");
  return {
    severity: "HIGH",
    category: "State apportionment",
    title: "An apportionment factor moved sharply from the prior year",
    detail: `${named}. Apportionment is the quietest place on a return for a large number to change, and a swing of this size on a business whose offices and customers have not moved is either a decision or a default nobody looked at.`,
    action: `Read the receipts schedule behind each factor and check what is in the numerator. Confirm the ${priorLabel} return and this one are sourcing the same kind of revenue the same way; if the method changed, document why. State auditors open on exactly this comparison, and a factor that fell also cut whatever state loss carryforward the year produced.`,
    authority: "State apportionment and allocation schedules; market-based sourcing rules of each state involved",
  };
}

/* ------------------------------------------------------------------------- */

/** Kept for reference; the gate is the header the return prints, not this. */
const CORPORATE_TYPES = /1120/;

function runCorporateReturnChecks(files, meta = {}) {
  const { current, prior } = splitReturns(files, meta);
  if (!current) return [];
  const text = returnTextOf(current);
  if (text.trim().length < 500) return [];
  // The header on page 1 is the gate, not the metadata. A returnType of "Other" — one wrong
  // pick in a dropdown — returned an empty array here and took every corporate check with it,
  // on a package whose first page reads "U.S. Corporation Income Tax Return". Nothing in the
  // output said a module had been skipped, which is the part that made it expensive.
  if (!/U\.S\.\s*(?:Income Tax Return for an S Corporation|Corporation Income Tax Return)/i.test(text)) return [];

  const taxYear = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
  const priorLabel = Number.isFinite(taxYear) && taxYear > 2000 ? String(taxYear - 1) : "prior-year";

  return [
    checkContributionsThroughRetainedEarnings(text),
    checkScheduleM1TiesToBooks(text, files),
    checkAmortizationAgainstBooks(text, files),
    checkShareholderLoansMisclassified(text),
    checkLoanToShareholder(text),
    checkAccruedInterestToShareholder(text),
    checkApportionmentSwing(text, prior ? returnTextOf(prior) : null, priorLabel),
  ].filter(Boolean);
}

module.exports = {
  runCorporateReturnChecks,
  checkContributionsThroughRetainedEarnings,
  checkScheduleM1TiesToBooks,
  checkAmortizationAgainstBooks,
  checkShareholderLoansMisclassified,
  checkLoanToShareholder,
  checkAccruedInterestToShareholder,
  checkApportionmentSwing,
  apportionmentFactors,
  scheduleGOwners,
  bookNetIncome,
};
