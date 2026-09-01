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

function claimedAmounts(text) {
  const out = [];
  for (const token of String(text || "").match(AMOUNT_IN_TEXT) || []) {
    const value = Number(token.replace(/[$,\s]/g, ""));
    // Small round numbers in prose ("line 2b", "50%") are not the subject of the claim, and a
    // figure under a hundred dollars is not worth a false correction either way.
    if (Number.isFinite(value) && Math.abs(value) >= 100) out.push(Math.abs(value));
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
      const cells = raw.split(",").map((c) => c.trim());
      if (cells.length < 2) continue;
      const label = cells.find((c) => c && ADJUSTMENT_LABEL.test(c));
      if (!label) continue;
      if (cells.some((c) => NUMERIC_CELL.test(c))) continue;
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
  verifyContinuityClaims,
  checkUnusedReconcilingLines,
  reconcilingLinesWithoutAmounts,
  claimedAmounts,
  locateAmount,
};
