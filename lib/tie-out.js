"use strict";

/**
 * tie-out.js — deterministic numeric verdicts for the Review tab.
 *
 * Why this exists: the model was deciding TIE vs OUT_OF_BALANCE by judgement, so two runs
 * of the SAME package disagreed on the SAME numbers — one run called a $21,517 difference
 * a "TIE" (false comfort, the worst possible failure for a reviewer), another called $4.96
 * an out-of-balance. Arithmetic is not a judgement call, so the verdict now belongs to code:
 * the model supplies the two amounts it read from the documents, and this module computes
 * the difference and assigns the status against a fixed threshold.
 *
 * Threshold: |difference| < $1.00 ties. That matches the firm rule already used elsewhere
 * for rounding non-issues (isConfirmedRoundingNonIssue) — IRS whole-dollar rounding moves a
 * figure by less than a dollar; anything larger is a real difference a reviewer must see.
 */

const TIE_THRESHOLD = 1.0;

// Accepts 81825, "81,825", "$1,733.04", "(218)" (negative), "" / null (unknown).
function parseAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[()$,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

const round2 = (n) => Math.round(n * 100) / 100;

function appendNote(existing, added) {
  const base = String(existing || "").trim();
  if (!base) return added;
  return base.includes(added) ? base : `${base} ${added}`;
}

/**
 * Recomputes difference and status for every tie-out row.
 * Returns { rows, changed } — changed counts verdicts the code had to correct.
 */
function enforceTieOutVerdicts(rows) {
  let changed = 0;
  const out = (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || typeof row !== "object") return row;
    const ret = parseAmount(row.returnAmount);
    const wp = parseAmount(row.workpaperAmount);
    const previous = String(row.status || "").toUpperCase();

    // One side missing: nothing was actually verified. Never let that read as a TIE.
    if (ret === null || wp === null) {
      if (previous === "TIE") changed += 1;
      return {
        ...row,
        status: "OUT_OF_BALANCE",
        note: appendNote(row.note, "Not verified: one side of the comparison was not provided."),
      };
    }

    const difference = round2(ret - wp);
    const ties = Math.abs(difference) < TIE_THRESHOLD;
    const status = ties ? "TIE" : "OUT_OF_BALANCE";
    if (previous && previous !== status) changed += 1;

    let note = row.note;
    if (previous === "TIE" && status === "OUT_OF_BALANCE") {
      note = appendNote(note, `Recomputed by the app: difference of ${difference.toFixed(2)} exceeds the ${TIE_THRESHOLD.toFixed(2)} rounding tolerance.`);
    } else if (ties && Math.abs(difference) > 0) {
      note = appendNote(note, "Within IRS whole-dollar rounding.");
    }
    return { ...row, difference, status, note };
  });
  return { rows: out, changed };
}

/**
 * Same treatment for the Schedule L balance check: `balanced` is arithmetic, not opinion.
 */
function enforceBalanceSheetVerdict(check) {
  if (!check || typeof check !== "object") return { check, changed: 0 };
  const assets = parseAmount(check.totalAssets);
  const liabEquity = parseAmount(check.totalLiabEquity);
  if (assets === null || liabEquity === null) return { check, changed: 0 };
  const difference = round2(assets - liabEquity);
  const balanced = Math.abs(difference) < TIE_THRESHOLD;
  const changed = Boolean(check.balanced) !== balanced ? 1 : 0;
  return {
    check: {
      ...check,
      difference,
      balanced,
      note: changed && !balanced
        ? appendNote(check.note, `Recomputed by the app: assets and liabilities+equity differ by ${difference.toFixed(2)}.`)
        : check.note,
    },
    changed,
  };
}

/**
 * Applies every verdict engine to a review object, in order:
 * arithmetic → roll-up coherence → unsupported-tie annotation. Mutation-free.
 */
function enforceNumericVerdicts(review, returnType) {
  if (!review || typeof review !== "object") return { review, corrections: 0 };
  const tie = enforceTieOutVerdicts(review.tieOutResults);
  const rollup = enforceRollupCoherence(tie.rows, returnType);
  const unsupported = flagUnsupportedTies(rollup.rows, returnType);
  const bs = enforceBalanceSheetVerdict(review.balanceSheetCheck);
  return {
    review: { ...review, tieOutResults: unsupported.rows, ...(bs.check ? { balanceSheetCheck: bs.check } : {}) },
    corrections: tie.changed + bs.changed + rollup.flagged,
    unsupported: unsupported.flagged,
  };
}

/* ---------------------------------------------------------------------------
 * Fixed tie-out checklist.
 *
 * Leaving "tie out every material number" to the model meant two runs of the same
 * package compared different line sets (only 12 of 22 lines overlapped) and one run
 * silently skipped the Schedule D short/long-term split — the exact place this client's
 * real error lived. The set of lines is therefore fixed in code per return type: the
 * model fills the amounts, code guarantees the list.
 * ------------------------------------------------------------------------- */

const REQUIRED_TIE_OUTS = {
  "1040": [
    { key: "form1040l1a", label: "Form 1040 Line 1a — Wages", source: "sum of all W-2 Box 1", external: true },
    { key: "form1040l2b", label: "Form 1040 Line 2b — Taxable interest", source: "sum of all 1099-INT Box 1 / Schedule B", external: true },
    { key: "form1040l3b", label: "Form 1040 Line 3b — Ordinary dividends", source: "sum of all 1099-DIV Box 1a / Schedule B", external: true },
    { key: "form1040l3a", label: "Form 1040 Line 3a — Qualified dividends", source: "sum of all 1099-DIV Box 1b", external: true },
    { key: "scheduledl7", label: "Schedule D Line 7 — Net short-term capital gain (loss)", source: "1099-B short-term (boxes A/B/C) totals", external: true },
    { key: "scheduledl15", label: "Schedule D Line 15 — Net long-term capital gain (loss)", source: "1099-B long-term (boxes D/E/F) totals", external: true },
    { key: "form1040l7", label: "Form 1040 Line 7 — Capital gain (loss)", source: "Schedule D Line 16" },
    { key: "scheduleel30", label: "Schedule E Line 30 — Partnership and S corporation income", source: "sum of all K-1s received", external: true },
    { key: "form1040l11", label: "Form 1040 Line 11 — Adjusted gross income", source: "sum of income lines less adjustments" },
    { key: "form1040l15", label: "Form 1040 Line 15 — Taxable income", source: "AGI less deductions" },
    { key: "form1040l24", label: "Form 1040 Line 24 — Total tax", source: "tax computation plus other taxes" },
    { key: "form1040l25d", label: "Form 1040 Line 25d — Total withholding", source: "sum of W-2 Box 2 and 1099 withholding", external: true },
    { key: "form1040l26", label: "Form 1040 Line 26 — Estimated tax payments", source: "payment confirmations / prior-year overpayment applied", external: true },
    { key: "form1040l33", label: "Form 1040 Line 33 — Total payments", source: "sum of payment lines" },
  ],
  BUSINESS: [
    { key: "grossreceipts", label: "Gross receipts or sales", source: "current-year P&L revenue" },
    { key: "cogs", label: "Cost of goods sold", source: "current-year P&L / Form 1125-A" },
    { key: "totaldeductions", label: "Total deductions", source: "current-year P&L expenses plus book-to-tax adjustments" },
    { key: "ordinaryincome", label: "Ordinary business income (loss)", source: "book-to-tax reconciliation result" },
    { key: "schedulella", label: "Schedule L — Total assets", source: "current-year balance sheet" },
    { key: "schedulelle", label: "Schedule L — Total liabilities and equity", source: "current-year balance sheet" },
    { key: "schedulem1", label: "Schedule M-1 — Book income to taxable income", source: "book-to-tax reconciliation" },
    { key: "schedulem2", label: "Schedule M-2 / retained earnings roll-forward", source: "prior-year ending equity plus current-year income less distributions" },
    { key: "k1total", label: "Total of all Schedule K-1s issued", source: "K-1 amounts must sum to the return totals" },
  ],
};

/**
 * Detects the return type from the documents themselves.
 *
 * The Review tab's Return type selector is routinely left blank, and an empty type meant
 * no mandatory checklist reached the prompt and no missing lines were flagged — the whole
 * determinism fix silently did nothing. The filed return states its own identity in its
 * title, which is far more reliable than a form number (a 1040 package is full of K-1s
 * that mention "Form 1120-S").
 */
// Earliest match wins: a filed return names itself (in the firm's cover letter and again
// in the form header) long before the K-1s and statements bundled at the end, which is what
// made a naive "first pattern found" read a 1040 package as a 1065. The "U.S." prefix is
// optional because software-printed returns often drop it ("Federal Individual Income Tax
// return will be electronically filed...").
const RETURN_SIGNATURES = [
  { type: "990", re: /return\s+of\s+organization\s+exempt/i },
  { type: "1120-S", re: /income\s+tax\s+return\s+for\s+an\s+s\s+corporation/i },
  { type: "1065", re: /return\s+of\s+partnership\s+income/i },
  { type: "1041", re: /income\s+tax\s+return\s+for\s+estates\s+and\s+trusts/i },
  { type: "1040", re: /individual\s+income\s+tax\s+return/i },
  { type: "1120", re: /corporation\s+income\s+tax\s+return/i },
];

function detectReturnTypeFromText(text) {
  const body = String(text || "");
  if (!body) return "";
  let best = null;
  for (const { type, re } of RETURN_SIGNATURES) {
    const m = body.match(re);
    if (m && m.index !== undefined && (!best || m.index < best.index)) best = { type, index: m.index };
  }
  if (best) return best.type;
  // Fallback: the earliest explicit form number.
  let bestNum = null;
  for (const [pattern, type] of [[/\bform\s*1120-?s\b/i, "1120-S"], [/\bform\s*1065\b/i, "1065"], [/\bform\s*1120\b/i, "1120"], [/\bform\s*1041\b/i, "1041"], [/\bform\s*990\b/i, "990"], [/\bform\s*1040\b/i, "1040"]]) {
    const m = body.match(pattern);
    if (m && m.index !== undefined && (!bestNum || m.index < bestNum.index)) bestNum = { type, index: m.index };
  }
  return bestNum ? bestNum.type : "";
}

/** Prefers the document explicitly labelled as the return under review. */
function detectReturnTypeFromFiles(files) {
  const list = Array.isArray(files) ? files : [];
  const textOf = (f) => String(f?.extractedText || f?.text || "");
  const current = list.filter((f) => /current_return/i.test(String(f?.reviewRole || f?.role || "")));
  for (const file of current) {
    const found = detectReturnTypeFromText(textOf(file));
    if (found) return found;
  }
  // No document was labelled as the return under review: fall back to the largest
  // non-prior document. A filed return dwarfs a single K-1 or W-2, so size is a better
  // guess than upload order (which would let an attached K-1 decide the return type).
  const candidates = list
    .filter((f) => !/prior/i.test(String(f?.reviewRole || f?.role || "")))
    .sort((a, b) => textOf(b).length - textOf(a).length);
  for (const file of candidates) {
    const found = detectReturnTypeFromText(textOf(file));
    if (found) return found;
  }
  return "";
}

function requiredTieOutsFor(returnType) {
  const t = String(returnType || "").replace(/\s+/g, "").toUpperCase();
  if (/^1040/.test(t)) return REQUIRED_TIE_OUTS["1040"];
  if (/^(1065|1120|1120-?S)$/.test(t)) return REQUIRED_TIE_OUTS.BUSINESS;
  return [];
}

// "Form 1040 Line 2b — Taxable interest" and "Form 1040 Line 2b (Interest)" are the same
// check; reduce both to form+line so runs can be compared and duplicates avoided.
function canonicalLineKey(lineItem) {
  const s = String(lineItem || "");
  const m = s.match(/(form\s*\d+[a-z-]*|schedule\s*[a-z]+)\D{0,14}?(?:line\s*)?(\d+[a-z]?)/i);
  if (m) return `${m[1]}l${m[2]}`.toLowerCase().replace(/\s+/g, "");
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
}

/**
 * Guarantees every required line appears. A line the review never returned is added as
 * unverified — never as a silent omission and never as a TIE.
 */
function ensureRequiredTieOutRows(rows, returnType) {
  const required = requiredTieOutsFor(returnType);
  if (!required.length) return { rows: Array.isArray(rows) ? rows : [], added: 0 };
  const present = new Set((Array.isArray(rows) ? rows : []).map((r) => canonicalLineKey(r && r.lineItem)));
  const missing = required.filter((req) => !present.has(canonicalLineKey(req.label)));
  const additions = missing.map((req) => ({
    lineItem: req.label,
    returnAmount: "",
    workpaperAmount: "",
    difference: "",
    status: "OUT_OF_BALANCE",
    note: `Required tie-out was not performed by the review — verify manually against ${req.source}.`,
  }));
  return { rows: [...(Array.isArray(rows) ? rows : []), ...additions], added: additions.length };
}

/* ---------------------------------------------------------------------------
 * Roll-up coherence.
 *
 * A total cannot tie while the lines that feed it do not. One run reported estimated
 * payments off by $37,000 and total payments as TIE in the same table — arithmetically
 * impossible, and exactly the kind of contradiction a reviewer spots instantly. Code
 * checks the relationship instead of trusting each row in isolation.
 * ------------------------------------------------------------------------- */
const ROLLUPS = {
  "1040": [
    { total: "form1040l33", components: ["form1040l25d", "form1040l26"], label: "the withholding and estimated payment lines" },
    { total: "form1040l7", components: ["scheduledl7", "scheduledl15"], label: "the Schedule D short-term and long-term lines" },
  ],
};

function rollupsFor(returnType) {
  const t = String(returnType || "").replace(/\s+/g, "").toUpperCase();
  return /^1040/.test(t) ? ROLLUPS["1040"] : [];
}

function enforceRollupCoherence(rows, returnType) {
  const rollups = rollupsFor(returnType);
  if (!rollups.length) return { rows: Array.isArray(rows) ? rows : [], flagged: 0 };
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({ ...r }));
  const byKey = new Map(list.map((r) => [canonicalLineKey(r.lineItem), r]));
  let flagged = 0;
  for (const rollup of rollups) {
    const total = byKey.get(rollup.total);
    if (!total || String(total.status).toUpperCase() !== "TIE") continue;
    const outComponents = rollup.components
      .map((k) => byKey.get(k))
      .filter((c) => c && String(c.status).toUpperCase() === "OUT_OF_BALANCE" && parseAmount(c.difference) !== null && Math.abs(parseAmount(c.difference)) >= TIE_THRESHOLD);
    if (!outComponents.length) continue;
    total.status = "OUT_OF_BALANCE";
    total.note = appendNote(total.note, `Cannot tie: ${rollup.label} feeding this total do not reconcile, so this total was not independently confirmed.`);
    flagged += 1;
  }
  return { rows: list, flagged };
}

/**
 * Lines verified against an OUTSIDE document (a W-2, a 1099, a K-1, a payment receipt)
 * should never come back with the support amount identical to the return amount and no
 * document named — that is the signature of copying the return figure instead of adding up
 * the support. The verdict is left alone (a genuine tie is possible); the row is annotated
 * so the reviewer knows the check was not evidenced.
 */
const DOCUMENT_MENTION = /\b(w-?2|1099|k-?1|schedule\s*[bde]|brokerage|statement|confirmation|voucher|receipt|payment record|transcript|form\s*8949|1098)\b/i;

function flagUnsupportedTies(rows, returnType) {
  const required = requiredTieOutsFor(returnType);
  if (!required.length) return { rows: Array.isArray(rows) ? rows : [], flagged: 0 };
  const externalKeys = new Set(required.filter((r) => r.external).map((r) => canonicalLineKey(r.label)));
  let flagged = 0;
  const list = (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || typeof row !== "object") return row;
    if (!externalKeys.has(canonicalLineKey(row.lineItem))) return row;
    if (String(row.status).toUpperCase() !== "TIE") return row;
    const diff = parseAmount(row.difference);
    if (diff === null || diff !== 0) return row; // an exact 0 is the copy signature
    if (DOCUMENT_MENTION.test(String(row.note || ""))) return row;
    flagged += 1;
    return { ...row, note: appendNote(row.note, "Support not evidenced: the amount matches the return exactly and no source document was named — confirm the support was actually totalled.") };
  });
  return { rows: list, flagged };
}

/** Prompt block listing the mandatory checklist for this return type. */
function tieOutChecklistPromptLines(returnType) {
  const required = requiredTieOutsFor(returnType);
  if (!required.length) return [];
  return [
    "MANDATORY TIE-OUT CHECKLIST: tieOutResults must contain one row for EACH line below, every run, in this order. This list is fixed so two reviews of the same package compare the same lines.",
    ...required.map((r) => `  • ${r.label}  — compare against: ${r.source}`),
    "For each row: returnAmount is what the return actually shows; workpaperAmount is the figure you INDEPENDENTLY computed from the source named above — never copy the return figure into workpaperAmount without actually locating and adding up the support. State in `note` which document(s) you used and how the support amount was derived.",
    "If a line genuinely does not apply this year (no such income), still return the row with both amounts 0 and note 'not applicable — no such item this year'. If the support was not uploaded, return the row with workpaperAmount empty and say which document is missing. Do NOT omit a row.",
    "You may add extra tie-out rows beyond this list whenever another material number deserves one.",
  ];
}

module.exports = {
  enforceNumericVerdicts, enforceTieOutVerdicts, enforceBalanceSheetVerdict, parseAmount, TIE_THRESHOLD,
  REQUIRED_TIE_OUTS, requiredTieOutsFor, canonicalLineKey, ensureRequiredTieOutRows, tieOutChecklistPromptLines,
  detectReturnTypeFromText, detectReturnTypeFromFiles, enforceRollupCoherence, flagUnsupportedTies,
};
