"use strict";

/**
 * return-consistency-checks.js — positions the return states in one place and contradicts in
 * another.
 *
 * The other check modules ask whether the numbers agree. These four ask something different,
 * and they exist because of a return where every number agreed perfectly and four separate
 * positions were still wrong. Each one is a pair of facts printed pages apart, where neither
 * half looks like anything on its own:
 *
 *   - Form 6765 declines the reduced-credit election, and no deduction reduction follows.
 *   - Form 6765 claims the company's entire payroll as qualified research.
 *   - Page 1 elects the cash method, and the balance sheet carries money held for others.
 *   - Schedule B says no payments needed a 1099, and the return deducts half a million of
 *     commissions to non-employees.
 *
 * None of these is arithmetic, so no tie-out reaches them; all four are two string matches
 * and a comparison, so none of them needs a model. That is the whole reason this file exists.
 *
 * Every check is fail-closed: an anchor it cannot read produces no finding, never a guessed
 * one. Three of them depend on a Yes/No answer, which reaches this text as "[ANSWER: Yes]"
 * from pdfPageLines in app.js — the tick's column, which flattening the page would lose.
 */

const { amountsOn, splitReturns, returnTextOf, linesOf } = require("./entity-return-checks");

const money = (n) => Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
const round2 = (n) => Math.round(n * 100) / 100;

/** The answer written onto a question line by pdfPageLines, or null when it was not read. */
function answerOn(line) {
  const hit = /\[ANSWER:\s*(Yes|No)\]/i.exec(String(line || ""));
  return hit ? hit[1].toLowerCase() : null;
}

/** First line matching `pattern`, or null. */
function lineMatching(text, pattern) {
  return linesOf(text).find((line) => pattern.test(line)) || null;
}

/**
 * The words at the head of a statement row, with the dot leader and every trailing figure
 * removed. Statement rows carry two columns ("PUBLISHER LIABILITY .... 0. 76,095.") and some
 * carry a stray currency sign, so the trailing strip has to take digits, punctuation and
 * spaces together rather than one group.
 */
function labelOf(row) {
  return String(row || "")
    .replace(/\.{2,}|\s\.(\s\.)+/g, " ")
    .replace(/[\s\d,$.()-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** First amount on the first line matching `pattern`, or null. */
function amountFrom(text, pattern, { pick = "last" } = {}) {
  for (const line of linesOf(text)) {
    if (!pattern.test(line)) continue;
    const values = amountsOn(line);
    if (!values.length) continue;
    return pick === "first" ? values[0] : values[values.length - 1];
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * 1. The research credit taken at the full rate with no deduction reduction.
 *
 * Section 280C(c) offers a choice and the return has to make one: reduce the research
 * deduction by the whole credit, or elect the reduced credit on Form 6765 line A and keep the
 * deduction. A return that answers "No" on line A and then leaves the deduction untouched has
 * taken the credit twice. On the return that prompted this the credit was $4,477 and the only
 * book-to-tax adjustment on Schedule M-1 was $178 of meals.
 *
 * The election is usually the cheaper of the two — it costs 21% of the credit and no income —
 * so this is worth catching before the return goes out rather than on amendment.
 * ------------------------------------------------------------------------- */

const REDUCED_CREDIT_QUESTION = /electing the reduced credit under section\s*280C/i;
// Form 6765's own total first, then the statement that carries it onto the return. The
// statement pattern has to insist on the dash: "FORM 6765 - INCREASING RESEARCH ACT. CREDIT"
// is the row with the figure, while "Form 6765 Credit for Increasing Research Activities" is
// the form's title, and a looser pattern matched the title and read 6765 as the credit.
const RESEARCH_CREDIT_AMOUNT = [
  /^\s*30\s+Add lines 28 and 29/i,
  /^\s*28\s+Subtract line 27 from line 13 or line 26/i,
  /FORM\s*6765\s*[-–]\s*INCREASING RESEARCH/i,
];

function researchCreditAmount(text) {
  for (const pattern of RESEARCH_CREDIT_AMOUNT) {
    const value = amountFrom(text, pattern);
    if (value) return value;
  }
  return null;
}

/** Where the M-1 stops: the next schedule, the next form, or the next page. */
const END_OF_M1 = /Schedule\s*M-2|^\s*Form\s+\d{3,4}\b|^---\s*Page\s/i;

/**
 * The Schedule M-1 block, where a 280C reduction would have to show up if one was made.
 *
 * Bounded rather than a fixed window: taking a flat thirty lines ran past the end of the
 * schedule and into Form 6765, where it found the credit printed on line 30 and concluded the
 * adjustment had been made. The check then stayed silent on the return it was written for.
 */
function scheduleM1Block(text) {
  const lines = linesOf(text);
  const start = lines.findIndex((line) => /Schedule\s*M-1\s+Reconciliation of Income/i.test(line));
  if (start === -1) return "";
  const block = [];
  for (const line of lines.slice(start + 1, start + 30)) {
    if (END_OF_M1.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

function checkSection280CElection(text) {
  const question = lineMatching(text, REDUCED_CREDIT_QUESTION);
  if (!question) return null;
  if (answerOn(question) !== "no") return null;
  const credit = researchCreditAmount(text);
  if (!credit) return null;

  // If the deduction really was reduced, the credit shows up as an addback. Anywhere on the
  // M-1 is enough — a preparer who did this will have itemized it there.
  const m1 = scheduleM1Block(text);
  if (m1 && amountsOn(m1.replace(/\n/g, " ")).some((v) => Math.abs(v - credit) < 1)) return null;
  if (/280C/i.test(m1)) return null;

  const reduced = round2(credit * 0.79);
  return {
    severity: "HIGH",
    category: "Research credit",
    title: "Research credit taken in full with no section 280C reduction",
    detail: `Form 6765 line A answers "No" to electing the reduced credit, so the ${money(credit)} research credit was computed at the full rate. Section 280C(c)(1) then requires the research expense deduction to be reduced by the same ${money(credit)}, and no adjustment of that amount appears on Schedule M-1. Taxable income is understated by ${money(credit)}.`,
    action: `Pick one and make the return say it. Electing the reduced credit on line A drops the credit to about ${money(reduced)} and leaves the deduction alone; declining the election keeps ${money(credit)} of credit but requires adding ${money(credit)} back to income. The election is usually the cheaper of the two.`,
    authority: "IRC §280C(c)(1) and §280C(c)(2); Form 6765 line A; IRC §41",
  };
}

/* ---------------------------------------------------------------------------
 * 2. Every dollar of payroll claimed as qualified research.
 *
 * Qualified research wages are the part of an employee's pay that went to qualified services
 * — research itself, or supervising or supporting it. A figure that lands on exactly the
 * company's total payroll, to the dollar, is not an allocation; it is the payroll account
 * copied across. The return that prompted this claimed $44,769 of QREs against $44,769 of
 * total wages, with no supplies, no contract research and no business component named.
 * ------------------------------------------------------------------------- */

// Line 48 is the one that adds the components up, but it prints no figure of its own — the
// row is all cross-references ("Add lines 42, 43, 44, and 47, then enter line 48 on either
// line 5 or line 20"), and reading it back gives you the line numbers. Line 5 carries the
// regular credit's total and line 20 the alternative simplified credit's; a filer uses one.
const QRE_TOTAL = [
  /^\s*5\s+Total qualified research expenses \(QREs\)/i,
  /^\s*20\s+Total qualified research expenses \(QREs\)/i,
];
/** Under this, the unused section's own line number is what got read, not a figure. */
const QRE_FLOOR = 1000;
/** Total compensation, wherever the return prints it: 1065 line 9, 1120-S line 8, 1120 line 13. */
const TOTAL_WAGES = /^\s*(?:8|9|13)\s+(?:Salaries and wages|Compensation of officers)/i;

function checkResearchCreditEqualsAllWages(text) {
  let qre = null;
  for (const pattern of QRE_TOTAL) {
    const value = amountFrom(text, pattern);
    if (value && Math.abs(value) >= QRE_FLOOR) { qre = value; break; }
  }
  if (!qre) return null;
  const wages = amountFrom(text, TOTAL_WAGES);
  if (!wages || Math.abs(qre - wages) >= 1) return null;

  return {
    severity: "HIGH",
    category: "Research credit",
    title: "The research credit claims the entire payroll as qualified research",
    detail: `Form 6765 reports ${money(qre)} of qualified research expenses, which is the company's total salaries and wages of ${money(wages)} to the dollar. That is the payroll account carried across rather than an allocation: qualified wages are only the portion of pay for qualified services.`,
    action: "Get the study or the time allocation behind the figure. Whoever's wages are in there has to be doing, supervising or directly supporting qualified research, and the return has to identify the business component. Without that support the credit does not survive examination and the deduction reduction under §280C compounds the exposure.",
    authority: "IRC §41(b)(2)(B) (wages for qualified services); IRC §41(d) (qualified research); Form 6765 Section F",
  };
}

/* ---------------------------------------------------------------------------
 * 3. A cash-basis return carrying a liability that looks like other people's money.
 *
 * On the cash method a receipt is income when it arrives, whoever it is destined for. So a
 * liability on a cash-basis balance sheet is only unremarkable when it is borrowing — a card,
 * a note, a loan — or tax withheld for remittance. Anything else means either cash came in
 * and was parked outside income, or an expense was accrued that the method does not allow.
 *
 * The return that prompted this was cash-basis with $76,095 of "Publisher liability" against
 * $74,481 of cash in the bank: the money was collected and sitting there. This does not
 * assert that it is income, because the ledger detail is what decides that; it makes sure
 * nobody signs the return without having looked.
 * ------------------------------------------------------------------------- */

const CASH_METHOD = /Check accounting method:\s*\(1\)\s*X\s*Cash/i;
/** Borrowings and withheld taxes: the liabilities a cash-basis balance sheet is entitled to. */
const ORDINARY_CASH_BASIS_LIABILITY = /credit\s*card|loan|note[s]?\s*payable|mortgage|line of credit|due (?:to|from)|payroll tax|sales tax|withheld|withholding|advance from/i;
/**
 * The heading of the attached statement, and only that. Schedule L's own line 17 reads "Other
 * current liabilities (attach stmt) ... 80,816." and the lines under it are the rest of the
 * balance sheet, so matching it swept partners' capital and the balance-sheet total into the
 * finding. The statement heading stands alone on its line.
 */
const LIABILITY_STATEMENT = /^\s*OTHER\s+(?:CURRENT\s+)?LIABILITIES\s*$/i;
/** Small balances are not worth sending a reviewer back to the client over. */
const LIABILITY_FLOOR = 5000;

function unexplainedLiabilities(text) {
  const lines = linesOf(text);
  const found = [];
  lines.forEach((line, index) => {
    if (!LIABILITY_STATEMENT.test(line)) return;
    // The statement lists one liability per line under its heading, beginning and ending
    // columns side by side; stop at the total.
    for (const row of lines.slice(index + 1, index + 14)) {
      if (/^\s*TOTAL\b/i.test(row)) break;
      if (/^\s*BEGINNING\b/i.test(row)) continue;
      if (!/[A-Za-z]{3}/.test(row)) continue;
      if (ORDINARY_CASH_BASIS_LIABILITY.test(row)) continue;
      const values = amountsOn(row);
      if (!values.length) continue;
      const ending = values[values.length - 1];
      if (Math.abs(ending) < LIABILITY_FLOOR) continue;
      const label = labelOf(row);
      if (label) found.push({ label, amount: ending });
    }
  });
  return [...new Map(found.map((f) => [f.label.toLowerCase(), f])).values()].slice(0, 4);
}

function checkCashBasisUnexplainedLiability(text) {
  if (!CASH_METHOD.test(text)) return null;
  const liabilities = unexplainedLiabilities(text);
  if (!liabilities.length) return null;
  const total = round2(liabilities.reduce((sum, l) => sum + Math.abs(l.amount), 0));
  const named = liabilities.map((l) => `"${l.label}" ${money(l.amount)}`).join("; ");
  return {
    severity: "HIGH",
    category: "Accounting method",
    title: "Cash-basis return carries a liability that is not a borrowing",
    detail: `Page 1 elects the cash method, and the balance sheet reports ${named}. On the cash method a receipt is income when it is received, so a liability that is not a loan, a card or tax withheld for remittance means one of two things: cash came in and was recorded outside income, or an expense was accrued that the cash method does not allow. ${money(total)} turns on which.`,
    action: "Read the ledger behind the account. If it holds money already collected and owed onward, it is income in the year received unless the partnership is a genuine agent holding funds in trust — and an agency claim needs the agreement, not the account name. If it is an accrued expense, no deduction is allowed until it is paid.",
    authority: "IRC §451(a) and Reg. §1.451-1(a) (income on receipt); IRC §461(a) and Reg. §1.461-1(a)(1) (cash-method deductions when paid)",
  };
}

/* ---------------------------------------------------------------------------
 * 4. "No payments required a 1099" over a return full of payments to non-employees.
 *
 * Schedule B asks it directly, and the answer is a tick in a column that a flattened page
 * turns into a bare X. On the return that prompted this the answer was No while the return
 * deducted $492,041 of reader commissions and $17,559 of outside services.
 *
 * The exception is real and worth naming in the finding: payments settled through a card
 * network or a third-party settlement organisation are reported by the processor on Form
 * 1099-K, and the payer is relieved. That makes this a question with a good answer available,
 * not an accusation — but at $340 a form it is a question worth asking before filing.
 * ------------------------------------------------------------------------- */

const FORM_1099_QUESTION = /(?:payments|payment).{0,60}would require you to file Form\(s\)\s*1099/i;
const NON_EMPLOYEE_PAYMENT = /commission|contract labor|outside services|subcontract|independent contractor|consulting|freelance|contractor/i;
/** Below the filing threshold nothing is required. */
const FILING_THRESHOLD = 600;

function nonEmployeePayments(text) {
  const found = [];
  for (const line of linesOf(text)) {
    if (!NON_EMPLOYEE_PAYMENT.test(line)) continue;
    // Only the expense schedules, never the question itself or a Schedule B caption.
    if (/1099|Schedule B|see instructions/i.test(line)) continue;
    const values = amountsOn(line);
    if (!values.length) continue;
    const amount = values[values.length - 1];
    if (Math.abs(amount) < FILING_THRESHOLD) continue;
    const label = labelOf(line);
    if (label) found.push({ label, amount });
  }
  return [...new Map(found.map((f) => [f.label.toLowerCase(), f])).values()].slice(0, 4);
}

function checkPaymentsRequiring1099(text) {
  const question = lineMatching(text, FORM_1099_QUESTION);
  if (!question) return null;
  if (answerOn(question) !== "no") return null;
  const payments = nonEmployeePayments(text);
  if (!payments.length) return null;
  const total = round2(payments.reduce((sum, p) => sum + Math.abs(p.amount), 0));
  const named = payments.map((p) => `${p.label} ${money(p.amount)}`).join("; ");
  return {
    severity: "HIGH",
    category: "Information returns",
    title: "Schedule B answers no to the 1099 question over payments to non-employees",
    detail: `Schedule B answers "No" to whether any 2025 payments would require a Form 1099, and the return deducts ${named} — ${money(total)} of payments that read as going to non-employees.`,
    action: "Settle it before filing. If those amounts were paid out through a card network or a third-party settlement organisation, the processor files the 1099-K and the answer is right — note it in the file. Anything paid directly by check or ACH to an individual or a partnership needs a 1099-NEC, and the answer to Schedule B has to change with it.",
    authority: "IRC §6041 and §6041A; Reg. §1.6041-1(a)(1)(iv) (payments settled by a third-party network); IRC §6721 and §6722 (penalties)",
  };
}

/* ---------------------------------------------------------------------------
 * 5. The same payments on a return that never asks the question.
 *
 * Schedule B asks a partnership and an S corporation whether any payment needed a 1099, and
 * the check above reads the answer. Form 1120 does not ask, so a C corporation can deduct
 * whatever it likes to non-employees and nothing on the return raises it. Across two clients
 * that silence covered $509,600 and $883,079 of commissions, consultancy and contract labour,
 * and both times the review walked past it.
 *
 * Deliberately MEDIUM and deliberately floored: a company with one $700 contractor does not
 * need a finding, and this is a question with a good answer available — a processor that
 * settles the payments files the 1099-K and the payer is relieved.
 * ------------------------------------------------------------------------- */

/** Under this, the filing obligation is not worth a reviewer's attention. */
const NON_EMPLOYEE_FLOOR = 25000;

function checkPaymentsWithNoFilingQuestion(text) {
  // A return that asks the question has its answer checked above; this is for the ones that
  // never ask, where nothing on the form prompts anybody.
  if (FORM_1099_QUESTION.test(text)) return null;
  const payments = nonEmployeePayments(text);
  if (!payments.length) return null;
  const total = round2(payments.reduce((sum, payment) => sum + Math.abs(payment.amount), 0));
  if (total < NON_EMPLOYEE_FLOOR) return null;
  const named = payments.map((payment) => `${payment.label} ${money(payment.amount)}`).join("; ");
  return {
    severity: "MEDIUM",
    category: "Information returns",
    title: "Payments to non-employees on a return that asks nothing about 1099s",
    detail: `The return deducts ${named} — ${money(total)} that reads as going to non-employees. Form 1120 carries no question about information returns, so nothing on the face of it prompts anyone to confirm they were filed.`,
    action: "Confirm the 1099-NECs went out, or that the payments were settled through a card network or third-party settlement organisation, in which case the processor files the 1099-K and the payer is relieved. Note whichever it is in the file: at $340 a form the exposure grows with the number of payees, not the size of the payments.",
    authority: "IRC §6041 and §6041A; Reg. §1.6041-1(a)(1)(iv); IRC §6721 and §6722",
  };
}

/* ---------------------------------------------------------------------------
 * 6. Money collected in advance, sitting outside income on an accrual return.
 *
 * The mirror of the cash-method check above, and it needs a different argument. On the
 * accrual method an advance payment is income in the year received unless the taxpayer
 * elects the one-year deferral, and that election has conditions — it only defers to the
 * next tax year, and only as far as the amount is deferred for book purposes too. A balance
 * that simply sits in a liability year after year is not a deferral, it is unreported income.
 * ------------------------------------------------------------------------- */

// The two forms label the same box differently — the 1065 prints "(2) Accrual" and the 1120
// prints "b Accrual", both preceded by the Cash option on the same line — so the pattern has
// to reach past whatever sits between the caption and the ticked box.
const ACCRUAL_METHOD = /Check accounting method[^\n]{0,40}?\b(?:\(2\)|b)\s*X\s*Accrual/i;
const DEFERRED_REVENUE = /customer\s+(?:prepay|deposit|advance)|deferred\s+revenue|unearned\s+(?:revenue|income)|advance\s+payments?|client\s+(?:deposit|prepay)|prepaid\s+by\s+customer/i;
/** Small balances are not worth a reviewer's time either way. */
const DEFERRAL_FLOOR = 10000;

function deferredRevenueRows(text) {
  const lines = linesOf(text);
  const found = [];
  lines.forEach((line, index) => {
    if (!LIABILITY_STATEMENT.test(line)) return;
    for (const row of lines.slice(index + 1, index + 14)) {
      if (/^\s*TOTAL\b/i.test(row)) break;
      if (!DEFERRED_REVENUE.test(row)) continue;
      const values = amountsOn(row);
      if (!values.length) continue;
      const ending = Math.abs(values[values.length - 1]);
      if (ending < DEFERRAL_FLOOR) continue;
      const label = labelOf(row);
      if (label) found.push({ label, amount: ending });
    }
  });
  return [...new Map(found.map((f) => [f.label.toLowerCase(), f])).values()].slice(0, 3);
}

function checkDeferredRevenueOnAccrual(text) {
  if (!ACCRUAL_METHOD.test(text)) return null;
  const rows = deferredRevenueRows(text);
  if (!rows.length) return null;
  const total = round2(rows.reduce((sum, row) => sum + row.amount, 0));
  const named = rows.map((row) => `"${row.label}" ${money(row.amount)}`).join("; ");
  return {
    severity: "MEDIUM",
    category: "Revenue recognition",
    title: "Money collected in advance is sitting outside income",
    detail: `The return elects the accrual method and the balance sheet reports ${named}. On the accrual method an advance payment is income in the year it is received unless the one-year deferral under section 451(c) was elected, and ${money(total)} turns on whether it was.`,
    action: "Check whether the deferral election is in place and whether it still holds: it defers to the following tax year only, and only to the extent the amount is deferred in the books as well. A balance that carries forward untouched from year to year is not a deferral — it is revenue that was never picked up.",
    authority: "IRC §451(c) and Reg. §1.451-8 (advance payments); IRC §451(a)",
  };
}

/* ------------------------------------------------------------------------- */

function runReturnConsistencyChecks(files, meta = {}) {
  const { current } = splitReturns(files, meta);
  if (!current) return [];
  const text = returnTextOf(current);
  if (text.trim().length < 500) return [];
  return [
    checkSection280CElection(text),
    checkResearchCreditEqualsAllWages(text),
    checkCashBasisUnexplainedLiability(text),
    checkPaymentsRequiring1099(text),
    checkPaymentsWithNoFilingQuestion(text),
    checkDeferredRevenueOnAccrual(text),
  ].filter(Boolean);
}

module.exports = {
  runReturnConsistencyChecks,
  checkSection280CElection,
  checkResearchCreditEqualsAllWages,
  checkCashBasisUnexplainedLiability,
  checkPaymentsRequiring1099,
  checkPaymentsWithNoFilingQuestion,
  checkDeferredRevenueOnAccrual,
  deferredRevenueRows,
  answerOn,
  unexplainedLiabilities,
  nonEmployeePayments,
};
