"use strict";

/**
 * review-guards.js — checks that run over the finished review, not over the return.
 *
 * Everything else in lib/ asks "what is wrong with this return". These two ask "is what the
 * review just said actually true", which is a different and cheaper question: both are
 * answered by looking for a number in text the model already had in front of it.
 *
 * They exist because of what false findings cost. A review that misses something leaves the
 * reviewer where they started; a review that asserts a figure is missing when it is printed
 * on the return sends them to the client to ask for something already in the file, and the
 * second kind of error is the one that ends trust in the tool.
 */

const { amountAppearsInText } = require("./tie-out");
const { csvCells, parseAmount } = require("./entity-return-checks");

const money = (n) => Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

/* ---------------------------------------------------------------------------
 * 1. "This is not reported on the return" — when it is.
 *
 * A real run reported that $1,068 of other income appeared nowhere on Form 1065 line 7 or
 * Form 8825 line 2b. The line "b Other income related to rental real estate activity. 2b
 * 1,068." was in the text the model was given. In the same review it compared a post-bonus
 * depreciable basis against the asset's full cost and called the difference an error.
 *
 * Only claims about the RETURN are checked here. "No Form 1098 was provided" is a claim about
 * the client's documents, which is a different question with a different answer — the scanned
 * attachments already have their own handling — and mixing the two would produce exactly the
 * kind of confident wrong correction this is meant to stop.
 * ------------------------------------------------------------------------- */

// The list grew after a second run said "$1,068 is missing from the return" and "line 8
// Interest is blank" — both figures printed on the return, and neither phrasing matched. A
// model has many ways to say a thing is not there, so the ways have to be enumerated; the
// alternative, matching on sentiment, would start downgrading real findings.
const ABSENCE_CLAIM = /\b(?:not reported|does not (?:appear|report|show|reflect|include|carry)|do not (?:appear|report|show|reflect|include|carry)|is not (?:reported|shown|included|reflected|present|carried)|are not (?:reported|shown|included|reflected|carried)|nowhere on|absent from|missing from|is missing|are missing|(?:is|are|was|were) blank|(?:is|are|was|were) omitted|omitted|left off|failed to report)\b/i;
/** The claim has to be about a line of the return, not about a document the client owes. */
const RETURN_REFERENCE = /\b(?:form\s*(?:1040|1065|1120-?s?|1041|8825|4562|8582|8960|7203|1125-?a)|schedule\s*[a-z](?:-\d)?\b|line\s*\d{1,2}[a-z]?)\b/i;
const AMOUNT_IN_TEXT = /\$\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?/g;

/**
 * A figure the finding itself says is printed on the return, which is therefore not the thing
 * it says is missing.
 *
 * "Form 3800 shows $27,793 of carryforward ... Form 3800 Part III is blank" is a true finding
 * about an empty part of a form, and the $27,793 is quoted as evidence that it IS there. The
 * guard read "is blank", found $27,793 on the return and downgraded a correct finding.
 *
 * The distinction that matters is whose document is doing the showing. "The workpaper shows
 * $2,140 ... Form 8825 line 2b does not report this amount" also says shows, about the books,
 * and there the figure on the return really is the contradiction — so a return form or line
 * has to be named alongside the verb before the figure is treated as conceded.
 */
const RETURN_REFERENCE_NEAR = /(?:form\s*\d{3,4}|schedule\s*[a-z](?:-\d)?|line\s*\d{1,2}[a-z]?|part\s+[ivx]+)\b/i;
const PRESENT_VERB = /\b(?:shows?|reports?|reflects?|carries|totaling|=|of|at)\b[^.$]{0,32}$/i;
/** "line 2b does not report $2,140" is the opposite claim, and it uses the same verb. */
const NEGATED = /\b(?:not|no|never|fails?|failed|without|omits?|omitted|missing|absent|blank)\b/i;

function assertedBy(before, reference) {
  if (!PRESENT_VERB.test(before)) return false;
  const at = before.search(reference);
  if (at === -1) return false;
  return !NEGATED.test(before.slice(at));
}

function claimedAmounts(text, reference = RETURN_REFERENCE_NEAR) {
  const haystack = String(text || "");
  const out = [];
  for (const match of haystack.matchAll(AMOUNT_IN_TEXT)) {
    const value = Number(match[0].replace(/[$,\s]/g, ""));
    // Small round numbers in prose ("line 2b", "50%") are not the subject of the claim, and a
    // figure under a hundred dollars is not worth a false correction either way.
    if (!Number.isFinite(value) || Math.abs(value) < 100) continue;
    if (assertedBy(haystack.slice(Math.max(0, match.index - 80), match.index), reference)) continue;
    // "depreciation ($1,285) cannot be verified without a mileage log" names a figure without
    // claiming the figure is missing — what is missing is the log. Reading it as an absence
    // claim, finding the figure on the return and downgrading the finding buried a correct
    // one about missing substantiation.
    // Corto hacia atras: la palabra de evidencia tiene que estar pegada a la cifra. Con 80
    // caracteres se colaba la oracion anterior — "Receipts were provided... the return omits
    // $9,400" apagaba el guard sobre una ausencia que si era real.
    const around = haystack.slice(Math.max(0, match.index - EVIDENCE_REACH_BACK), match.index + match[0].length + MISSING_CLAIM_REACH);
    if (EVIDENCE_NOT_FIGURE.test(around)) continue;
    out.push(Math.abs(value));
  }
  return out;
}

/** The line of the return carrying `amount`, for quoting back to the reviewer. */
function locateAmount(amount, returnText) {
  for (const line of String(returnText || "").split(/\r?\n/)) {
    if (line.trim().length < 8) continue;
    if (amountAppearsInText(amount, line)) return line.replace(/\.{3,}|\s\.(\s\.)+/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

/**
 * Downgrades findings that say a figure is absent from the return when the return prints it.
 * Never deletes: the reviewer sees the claim, the correction and where the figure actually is,
 * and decides. A finding that has been contradicted is still information about the review.
 */
function verifyAbsenceClaims(review, files) {
  const issues = Array.isArray(review?.issues) ? review.issues : [];
  if (!issues.length) return { issues, corrected: 0 };
  const returnFile = (Array.isArray(files) ? files : []).find((f) => String(f?.reviewRole || f?.role || "").toLowerCase().includes("current_return"));
  const returnText = String((returnFile && (returnFile.fullText || returnFile.text)) || "");
  if (returnText.trim().length < 500) return { issues, corrected: 0 };

  let corrected = 0;
  const checked = issues.map((issue) => {
    if (!issue || typeof issue !== "object") return issue;
    const claim = `${issue.issueDescription || ""} ${issue.evidence || ""}`;
    if (!ABSENCE_CLAIM.test(claim) || !RETURN_REFERENCE.test(claim)) return issue;
    const present = [...new Set(claimedAmounts(claim))].filter((amount) => amountAppearsInText(amount, returnText));
    if (!present.length) return issue;
    corrected += 1;
    const where = locateAmount(present[0], returnText);
    return {
      ...issue,
      priority: "LOW",
      // Survives the conciseness pass, which blanks riskAnalysis on every LOW finding.
      contradictedByGuard: true,
      issueDescription: `${issue.issueDescription || ""}`.trim(),
      // Careful with the wording: a finding often quotes several figures and says only one of
      // them is missing. Saying "this finding claims $85,617 and $1,068 are not reported" puts
      // a claim in its mouth it never made. State what is checkable — these figures it names
      // are on the return — and let the reviewer match that against the sentence.
      riskAnalysis: `CONTRADICTED BY THE RETURN: this finding reports something as absent, but ${present.length > 1 ? "these figures it names are" : "the figure it names is"} printed on the return — ${present.slice(0, 3).map(money).join(", ")}${where ? `, at "${where.slice(0, 160)}"` : ""}. Lowered to LOW automatically; read the cited line before acting on it. ${issue.riskAnalysis || ""}`.trim(),
    };
  });
  return { issues: checked, corrected };
}

/* ---------------------------------------------------------------------------
 * 4. "The required schedule is not attached" — when it is in the package.
 *
 * Twice in three runs of the same return, on two different schedules. One review said the
 * partnership was electing out of the centralized audit regime and Schedule B-2 was missing;
 * it was not electing out, so no B-2 was ever required. The next said Schedule B-1 was not
 * attached, citing the forms list as evidence — and the forms list is the first place the
 * return names it, three lines from the top, with the form itself printed later in the same
 * package.
 *
 * Both would send a preparer looking for something already in front of them, which is the
 * expensive kind of wrong. Absence claims about figures are handled above; this is the same
 * error about a form, where there is no dollar amount for that check to test.
 * ------------------------------------------------------------------------- */

// "not visible in package" was the third phrasing, on a review that said Form 6765 was not in
// the package while its own top finding quoted Form 6765 line A. A model has many ways to say
// a thing is not there and each one has to be enumerated; matching on sentiment instead would
// start downgrading real findings.
const MISSING_FORM_CLAIM = /\b(?:not attached|are not attached|no longer attached|missing|not present|not visible|not found|not located|could not be located|not included|not in (?:the\s+)?(?:return\s+)?(?:package|return|file)|not provided|not supplied|not furnished|does not include|omitted|not listed)\b/i;
/**
 * "Schedule B-1", "Form 8825", "Schedule K-2", "Statement 7" — the name as the finding
 * writes it.
 *
 * Statements are here because two findings on the same review said "STATEMENT 7 ... is not
 * provided" and "Statement 1 is referenced but not provided" about statements printed in the
 * package a few pages later. A preparer's software numbers them and prints each one under its
 * own heading, so they are as findable as a form and as costly to go looking for.
 */
const FORM_NAME = /\b(schedule|form|statement)\s+([a-z]{1,2}-\d{1,2}|\d{1,4}-?[a-z]?|[a-z]-\d)\b/gi;
/** How far past the form's name the phrase saying it is missing may sit. */
const MISSING_CLAIM_REACH = 60;
/**
 * A finding can name a figure and still not be claiming the figure is missing: "depreciation
 * ($1,285) cannot be verified without a mileage log" is about the log, not the deduction. The
 * absence guard used to read the figure, find it printed on the return, and downgrade a
 * correct finding about missing substantiation.
 */
const EVIDENCE_REACH_BACK = 30;
const EVIDENCE_NOT_FIGURE = /\b(?:mileage|logs?|substantiat\w*|evidence|documentation|records?|receipts?|invoices?|backup)\b|\b(?:cannot|could not|can't|couldn't|unable to)\s+be\s+verified\b/i;

/**
 * A form counts as present when a line opens with its name — the header the form prints, or
 * the preparer's list of forms in the package. The instruction text on the question itself
 * ("If \"Yes,\" attach Schedule B-1") names it too and must not count, which is why this
 * anchors at the start of a line rather than searching anywhere.
 */
function formAppearsInPackage(kind, number, text) {
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = kind.toLowerCase();
  // A statement is only ever itself; a schedule is abbreviated "SCH" in the forms list.
  const named = word === "form" ? `(?:form)\\s*${escaped}`
    : word === "statement" ? `(?:statement)\\s*${escaped}`
    : `(?:schedule|sch\\.?)\\s*${escaped}`;
  const header = new RegExp(`^\\s*${named}\\b`, "im");
  // Statements are never listed among the forms; only their own heading counts.
  if (word === "statement") return header.test(text);

  // The preparer's list writes most forms as a bare number — "FEDERAL: 1065, SCH B-1,
  // 1125-A, 6765, 8879-PE" — so the "Form" is optional here. That only stays safe while the
  // line really is a forms list, which means a jurisdiction label and a colon. Matching the
  // label alone accepted "New York State Authorization for (9/25)" and read the 9 in the
  // revision date as proof that Statement 9 was in the package.
  const inFormsList = new RegExp(`^\\s*(?:forms?\\s+needed[^\\n]*|[A-Z][A-Za-z ]{2,24}:)[^\\n]*\\b(?:(?:sch\\.?|schedule|form)\\s*)?${escaped}\\b`, "m");
  return header.test(text) || inFormsList.test(text);
}

/**
 * Downgrades findings that report a form as missing when the package contains it. Like the
 * figure check above it never deletes: the reviewer sees the claim and where the form is.
 */
function verifyAttachmentClaims(review, files) {
  const issues = Array.isArray(review?.issues) ? review.issues : [];
  if (!issues.length) return { issues, corrected: 0 };
  // The CURRENT return, not every file in the package. A finding reading "Form 4562 is not
  // attached to the return" is about this year, and last year’s return carries its own copy
  // of Form 4562 — joining every document turned a true finding about a missing form into a
  // contradiction. Supporting documents still count, because a statement or a schedule may
  // legitimately arrive as its own file; the prior-year return does not.
  const relevant = (Array.isArray(files) ? files : []).filter((file) => {
    const role = String(file?.reviewRole || file?.role || "").toLowerCase();
    return !role.includes("prior");
  });
  const text = (relevant.length ? relevant : files || [])
    .map((file) => String((file && (file.fullText || file.text)) || ""))
    .join("\n");
  if (text.trim().length < 500) return { issues, corrected: 0 };

  let corrected = 0;
  const checked = issues.map((issue) => {
    if (!issue || typeof issue !== "object") return issue;
    const claim = `${issue.issueDescription || ""} ${issue.evidence || ""}`;
    if (!MISSING_FORM_CLAIM.test(claim)) return issue;
    const present = [];
    for (const match of claim.matchAll(FORM_NAME)) {
      const [, kind, number] = match;
      // The phrase has to be about THIS form. A finding reading "Form 3800 shows $27,793 of
      // carryforward ... verify that no 2025 credits were omitted" names a form that is in
      // the package and, sixty words later, the word "omitted" about something else
      // entirely; matching anywhere in the sentence downgraded a correct finding.
      const after = claim.slice(match.index, match.index + match[0].length + MISSING_CLAIM_REACH);
      if (!MISSING_FORM_CLAIM.test(after)) continue;
      if (formAppearsInPackage(kind, number, text)) present.push(`${kind} ${number}`.replace(/\s+/g, " "));
    }
    if (!present.length) return issue;
    corrected += 1;
    const named = [...new Set(present.map((p) => p.toLowerCase()))];
    return {
      ...issue,
      priority: "LOW",
      // Survives the conciseness pass, which blanks riskAnalysis on every LOW finding.
      contradictedByGuard: true,
      riskAnalysis: `CONTRADICTED BY THE PACKAGE: this finding reports a form as missing, but ${named.length > 1 ? "these forms are" : "it is"} in the documents under review — ${named.join(", ")}. Lowered to LOW automatically; find the form before acting on it. ${issue.riskAnalysis || ""}`.trim(),
    };
  });
  return { issues: checked, corrected };
}

/* ---------------------------------------------------------------------------
 * 5. "The workpaper does not explain this" — when it does, on a line further down.
 *
 * A review reported interest expense of $75,016 on the return against $15,016 in the
 * workbook and called the $60,000 difference unexplained. The profit and loss carries two
 * interest lines — $60,000 under expenses and $15,016 under other expenses — and they add to
 * the figure on the return exactly. The finding was produced by reading one of them.
 *
 * Same shape as the return check above and a different haystack: the claim is about the books,
 * so the books are what gets searched. Only amounts the finding itself names are looked for,
 * so a genuine difference the workpaper really is silent about survives untouched.
 * ------------------------------------------------------------------------- */

const UNEXPLAINED_CLAIM = /\b(?:unexplained|not explained|no explanation|unaccounted|cannot be traced|does not (?:tie|reconcile|appear|match)|no corresponding|not (?:reflected|recorded|shown) in the (?:workpaper|books|ledger))\b/i;
/** The claim has to be about the books, not about a line of the return. */
const WORKPAPER_REFERENCE = /\b(?:workpaper|work paper|worksheet|workbook|books|ledger|general ledger|profit and loss|p&l|trial balance|balance sheet)\b/i;

function verifyWorkpaperClaims(review, files) {
  const issues = Array.isArray(review?.issues) ? review.issues : [];
  if (!issues.length) return { issues, corrected: 0 };
  const support = (Array.isArray(files) ? files : []).filter((file) => {
    const role = String(file?.reviewRole || file?.role || "").toLowerCase();
    return !role.includes("return");
  });
  // A workbook arrives as CSV, and amountAppearsInText refuses a figure preceded by a comma
  // so that 434 never matches inside 1,434. In a spreadsheet that comma is a cell boundary,
  // and "Interest paid,60000" then hides its own 60,000. Joining the cells with spaces keeps
  // the guard against 1,434 and lets the cell be found.
  const text = support
    .map((file) => String((file && (file.fullText || file.text)) || ""))
    .join("\n")
    .split(/\r?\n/)
    .map((line) => csvCells(line).join(" "))
    .join("\n");
  if (text.trim().length < 200) return { issues, corrected: 0 };

  let corrected = 0;
  const checked = issues.map((issue) => {
    if (!issue || typeof issue !== "object") return issue;
    const claim = `${issue.issueDescription || ""} ${issue.evidence || ""}`;
    if (!UNEXPLAINED_CLAIM.test(claim) && !ABSENCE_CLAIM.test(claim)) return issue;
    if (!WORKPAPER_REFERENCE.test(claim)) return issue;
    // A figure the finding itself says the books show is not evidence against it. “Workpaper
    // P&L shows Reimbursements $75,480.99 ... no corresponding line on prior year” is a true
    // finding about a new expense, and the guard read the $75,480.99 back out of the P&L and
    // called the finding contradicted. Same shape as the return-side rule above, other book.
    const present = [...new Set(claimedAmounts(claim, WORKPAPER_REFERENCE))].filter((amount) => amountAppearsInText(amount, text));
    if (!present.length) return issue;
    corrected += 1;
    // Quote every row that was found, not just the first. The whole point of this check is
    // that a total on the return adds up two rows of the ledger, and a reviewer who is shown
    // only one of them is left where the finding left them.
    const where = [...new Set(present.map((amount) => locateAmount(amount, text)).filter(Boolean))]
      .slice(0, 2)
      .map((line) => `"${line.slice(0, 120)}"`)
      .join(" and ");
    return {
      ...issue,
      priority: "LOW",
      // Survives the conciseness pass, which blanks riskAnalysis on every LOW finding.
      contradictedByGuard: true,
      riskAnalysis: `CONTRADICTED BY THE WORKPAPER: this finding treats a figure as unexplained by the books, but ${present.length > 1 ? "these figures it names appear" : "the figure it names appears"} in the supporting documents — ${present.slice(0, 3).map(money).join(", ")}${where ? `, at ${where}` : ""}. A total on the return often adds up two rows of the ledger. Lowered to LOW automatically; read the cited rows before acting on it. ${issue.riskAnalysis || ""}`.trim(),
    };
  });
  return { issues: checked, corrected };
}

/* ---------------------------------------------------------------------------
 * 3. A finding that contradicts a check which already ran and passed.
 *
 * The same run claimed Schedule L's opening balances did not tie to the prior year, naming
 * cash, buildings, accumulated depreciation and notes payable. All four tie exactly, and the
 * deterministic continuity check had already established that before the finding was written.
 * It made the same claim a second time about Schedule M-2.
 *
 * When code has compared the two columns and found them equal, a narrative saying otherwise
 * is not a second opinion worth the reviewer's time — it is the one place where the model and
 * the arithmetic can be put side by side, and the arithmetic wins.
 * ------------------------------------------------------------------------- */

const CONTINUITY_CLAIM = /\b(?:beginning|opening)\b[^.]{0,80}\b(?:do(?:es)? not tie|do(?:es)? not match|disagree|differ|inconsisten|mismatch|not carried forward|does not equal)\b/i;
const CONTINUITY_SUBJECT = /\bschedule\s*(?:l|m-?2)\b/i;

/**
 * Downgrades continuity findings when the deterministic continuity check ran and found none.
 * `continuityFindings` is what checkBalanceSheetContinuity returned: an empty array means the
 * columns were read and agreed, which is different from the check never having run.
 */
function verifyContinuityClaims(review, { continuityRan = false, continuityFindings = [] } = {}) {
  const issues = Array.isArray(review?.issues) ? review.issues : [];
  if (!issues.length || !continuityRan || continuityFindings.length) return { issues, corrected: 0 };
  let corrected = 0;
  const checked = issues.map((issue) => {
    if (!issue || typeof issue !== "object") return issue;
    const claim = `${issue.issueDescription || ""} ${issue.evidence || ""}`;
    if (!CONTINUITY_SUBJECT.test(claim) || !CONTINUITY_CLAIM.test(claim)) return issue;
    corrected += 1;
    return {
      ...issue,
      priority: "LOW",
      // Survives the conciseness pass, which blanks riskAnalysis on every LOW finding.
      contradictedByGuard: true,
      riskAnalysis: `CONTRADICTED BY A COMPLETED CHECK: the opening balances on this return were compared line by line against the prior-year closing balances and they agree. Lowered to LOW automatically; if a specific line really is off, name it and show both figures. ${issue.riskAnalysis || ""}`.trim(),
    };
  });
  return { issues: checked, corrected };
}

/* ---------------------------------------------------------------------------
 * 2. A reconciling line the preparer wrote down and left empty.
 *
 * The book-to-tax workpaper of a real 1065 carried a row labelled "Meals 50% Addback" with no
 * amount beside it, while the return deducted meals at 100%. Somebody knew the adjustment was
 * needed, typed the label, and never filled it in — which is the most findable kind of error
 * there is, and three reviews of that package walked past it while quoting the meals figure
 * in their own evidence.
 *
 * Deliberately narrow. Only rows whose label names an adjustment are considered, so an empty
 * spacer or a section heading in a spreadsheet is not mistaken for a missed reconciling item.
 * ------------------------------------------------------------------------- */

const ADJUSTMENT_LABEL = /\b(add\s*-?\s*back|addback|non-?deductible|nondeductible|disallowed|less:|add:|plus:|adjustment|50\s*%|meals|penalt(?:y|ies)|entertainment)\b/i;
/** A cell holding an actual figure — not "50%", and not a form's own line number. */
const NUMERIC_CELL = /^-?\(?\$?\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?$/;
/** Only worth reading a sheet that is actually a book-to-tax bridge. */
const RECONCILIATION_CONTEXT = /book\s*to\s*tax|reconciliation|m-?1\b|taxable income/i;

/**
 * Only spreadsheets. The filed return also says "Schedule M-1 Reconciliation" and prints
 * "nondeductible expenses" and "entertainment" as empty form captions, so reading it here
 * turned every blank box on the M-1 into a finding. A workpaper reaches the review as CSV,
 * one row per line, which is both the right place to look and a shape the return never has.
 */
function isSpreadsheet(file) {
  const name = String((file && file.name) || "");
  const text = String((file && (file.fullText || file.text)) || "");
  if (/\.(xlsx|xlsm|xls|csv)$/i.test(name)) return true;
  return /^---\s*Sheet:/m.test(text);
}

function reconcilingLinesWithoutAmounts(files) {
  const empty = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (!isSpreadsheet(file)) continue;
    const text = String((file && (file.fullText || file.text)) || "");
    if (!RECONCILIATION_CONTEXT.test(text)) continue;
    for (const raw of text.split(/\r?\n/)) {
      if (/^---\s*Sheet:/.test(raw.trim())) continue;
      // Quote-aware: a workbook writes 11,274.56 as the single cell "11,274.56", and splitting
      // on every comma turned it into '"11' and '274.56"', neither of which reads as a figure.
      // A real review reported four rows as blank that each carried an amount.
      const cells = csvCells(raw);
      if (cells.length < 2) continue;
      const label = cells.find((c) => c && ADJUSTMENT_LABEL.test(c));
      if (!label) continue;
      // parseAmount takes "$5,386.23" with its currency sign and padding, and still refuses
      // "50%" and "16.96%" — the percentages these rows are named after.
      if (cells.some((c) => NUMERIC_CELL.test(c) || parseAmount(c) !== null)) continue;
      empty.push({ label: label.replace(/\s+/g, " ").trim(), source: String(file.name || "workpaper") });
    }
  }
  return empty;
}

function checkUnusedReconcilingLines(files) {
  const empty = reconcilingLinesWithoutAmounts(files);
  if (!empty.length) return null;
  const unique = [...new Map(empty.map((e) => [e.label.toLowerCase(), e])).values()].slice(0, 6);
  return {
    severity: "MEDIUM",
    category: "Workpaper",
    title: "A book-to-tax adjustment was written down and left blank",
    detail: `${unique.map((e) => `"${e.label}" in ${e.source}`).join("; ")} — the row names an adjustment and carries no amount. Somebody identified the item and did not compute it, so whatever it was worth is still sitting in the deduction.`,
    action: "Compute the adjustment or delete the row. If it is genuinely zero this year, put a zero in it so the next reviewer can tell the difference between decided and forgotten.",
    authority: "IRC §274(n) (meals limitation) and the equivalent limitation for the item named; Schedule M-1",
  };
}

module.exports = {
  verifyAbsenceClaims,
  verifyAttachmentClaims,
  verifyWorkpaperClaims,
  formAppearsInPackage,
  verifyContinuityClaims,
  checkUnusedReconcilingLines,
  reconcilingLinesWithoutAmounts,
  claimedAmounts,
  locateAmount,
};
