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

// A third verdict, deliberately distinct from both TIE and OUT_OF_BALANCE: the comparison
// was never actually performed, so claiming either would be a lie. Reported as its own
// state so a reviewer sees "nobody checked this" instead of false comfort.
const NOT_VERIFIED = "NOT VERIFIED";

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

    // One side missing: nothing was actually verified. Never let that read as a TIE, and
    // do not claim it is out of balance either — we simply do not know.
    if (ret === null || wp === null) {
      if (previous === "TIE") changed += 1;
      return {
        ...row,
        status: NOT_VERIFIED,
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
function enforceNumericVerdicts(review, returnType, files) {
  if (!review || typeof review !== "object") return { review, corrections: 0 };
  const tie = enforceTieOutVerdicts(review.tieOutResults);
  const rollup = enforceRollupCoherence(tie.rows, returnType);
  const unsupported = flagUnsupportedTies(rollup.rows, returnType);
  // Any row whose note shows its own arithmetic gets that arithmetic re-run, whatever the
  // verdict — a false OUT_OF_BALANCE misleads a reviewer as surely as a false TIE.
  const derived = auditDerivations(unsupported.rows);
  // Runs last: a row that survived every arithmetic check can still rest on a citation
  // that does not match anything in the package.
  const evidence = verifyTieOutEvidence(derived.rows, returnType, files);
  const bs = enforceBalanceSheetVerdict(review.balanceSheetCheck);
  return {
    review: { ...review, tieOutResults: evidence.rows, ...(bs.check ? { balanceSheetCheck: bs.check } : {}) },
    corrections: tie.changed + bs.changed + rollup.flagged,
    unsupported: unsupported.flagged + evidence.flagged + derived.flagged,
    unevidenced: evidence.flagged,
    badArithmetic: derived.flagged,
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

// Different labels for the same check. A run that reported wages as "Form 1040 Line 1z"
// produced TWO rows in the table: its own, plus the checklist's "Line 1a" row added as
// "not performed" — the same tie-out, listed twice, contradicting itself. 1a is W-2 wages
// and 1z is the total of 1a-1h; absent the rare 1b-1h items they are the same figure and
// the same check.
const LINE_KEY_ALIASES = {
  form1040l1: "form1040l1a",
  form1040l1z: "form1040l1a",
};

// "Form 1040 Line 2b — Taxable interest" and "Form 1040 Line 2b (Interest)" are the same
// check; reduce both to form+line so runs can be compared and duplicates avoided.
function rawLineKey(lineItem) {
  const s = String(lineItem || "");
  const m = s.match(/(form\s*\d+[a-z-]*|schedule\s*[a-z]+)\D{0,14}?(?:line\s*)?(\d+[a-z]?)/i);
  return m
    ? `${m[1]}l${m[2]}`.toLowerCase().replace(/\s+/g, "")
    : s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
}

// The checklist's own labels, so a row can be recognised as one of them.
const REQUIRED_LINE_KEYS = new Set(
  Object.values(REQUIRED_TIE_OUTS).flat().map((entry) => rawLineKey(entry.label))
);

function canonicalLineKey(lineItem) {
  const key = rawLineKey(lineItem);
  if (LINE_KEY_ALIASES[key]) return LINE_KEY_ALIASES[key];
  if (REQUIRED_LINE_KEYS.has(key)) return key;
  // The model routinely writes a finer sub-line than the checklist asks for: it reported
  // capital gain as "Line 7a" and AGI as "Line 11a" where the checklist says 7 and 11, and
  // the table came back with both its row AND a "not performed" row for the same check.
  // Collapse a sub-letter ONLY when the parent is a checklist line and the sub-line is not,
  // so genuinely distinct pairs like 3a/3b and 25d stay separate.
  if (/l\d+[a-z]$/.test(key)) {
    const parent = key.slice(0, -1);
    if (REQUIRED_LINE_KEYS.has(parent)) return parent;
  }
  return key;
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
    status: NOT_VERIFIED,
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
const DOCUMENT_MENTION = /\b(w-?2c?|1099|k-?1|schedule\s*[bde]\b|brokerage|statements?|confirmations?|vouchers?|receipts?|payment records?|transcripts?|form\s*8949|1098)/i;

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
    // Downgraded, not just annotated: one run copied the return figure into 11 of 14 lines
    // and reported them all as TIE, hiding three differences that were real and provable
    // in the source documents. An unevidenced tie must not read as a completed check.
    return {
      ...row,
      status: NOT_VERIFIED,
      note: appendNote(row.note, "Not verified: the support amount is identical to the return and no source document was named, so the support was probably not totalled. Check this line against the source document."),
    };
  });
  return { rows: list, flagged };
}

/* ---------------------------------------------------------------------------
 * Evidence verification (naming a document is not the same as reading it).
 *
 * The unsupported-tie guard above only fires when NO document is named, so a run that
 * wrote "JP Morgan 1099 statement shows $1,726 taxable interest — matches return" sailed
 * through as a TIE. The package held one interest document (a Chase 1099-INT for $0.01)
 * and no Capital One 1099-INT at all; the return's $1,726 came from Schedule B payers that
 * were never provided. The citation was real-sounding, the number was invented, and the
 * row read as a completed check.
 *
 * So the citation itself is now checked against the uploaded files: the named document has
 * to exist in the package, and the support figure has to be locatable — either found in
 * that document's text, or shown as an addition that actually adds up.
 * ------------------------------------------------------------------------- */

const FILENAME_STOPWORDS = new Set([
  "pdf", "jpg", "jpeg", "png", "docx", "xlsx", "csv", "zip", "copy", "final", "scan", "scanned",
  "tax", "taxes", "document", "documents", "doc", "docs", "file", "files", "form", "forms",
  "client", "return", "returns", "the", "and", "for", "new", "old",
]);

/** Every word in a filename, extension aside. Years and form numbers stay: "1040 2025"
 *  and "1040 2024" are different documents and must not collapse into each other. */
function identityTokens(name) {
  return String(name || "")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** "NT W2 2025.pdf" -> ["nt","w2"] : the words that would identify this file in prose.
 *  Years and bare numbers are dropped here because a reviewer writing "the W-2" never
 *  repeats them, and every document in a package shares the same year. */
function fileTokens(name) {
  return identityTokens(name)
    .filter((t) => t.length >= 2 && !FILENAME_STOPWORDS.has(t) && !/^(19|20)\d{2}$/.test(t) && !/^\d+$/.test(t));
}

/**
 * Does `text` cite `file`? Filenames are rarely quoted verbatim ("Chase Self Directed
 * 2025-taxdocuments-9191-.pdf" gets cited as "the Chase statement"), so a match means the
 * text carries the file's identifying words — all of them for a short name, most of them
 * for a longer one.
 */
function textCitesFile(text, name) {
  const tokens = fileTokens(name);
  if (!tokens.length) return false;
  const hay = String(text || "").toLowerCase();
  const hits = tokens.filter((t) => new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`, "i").test(hay)).length;
  // One- and two-token names must match fully; longer names tolerate a stray word.
  return tokens.length <= 2 ? hits === tokens.length : hits >= Math.ceil(tokens.length * 0.6);
}

/** Every way a figure is printed on a source document: 1726 / 1,726 / 1726.00 / 1,726.00. */
function amountAppearsInText(amount, text) {
  const hay = String(text || "");
  if (!hay || amount === null || amount === undefined) return false;
  const abs = Math.abs(Number(amount));
  if (!Number.isFinite(abs)) return false;
  const whole = Math.trunc(abs);
  const withCommas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = abs.toFixed(2);
  const decimals = cents.slice(cents.indexOf("."));
  const candidates = new Set([String(whole), withCommas(whole), cents, withCommas(whole) + decimals]);
  for (const c of candidates) {
    // Not preceded or followed by another digit, so 434 does not match 1434 or 4340,
    // but does match the "434.01" a 1099 actually prints.
    if (new RegExp(`(?<![\\d.,])${c.replace(/\./g, "\\.")}(?![\\d])`).test(hay)) return true;
  }
  return false;
}

/**
 * Pulls an addition chain out of a note ("351,200 + 2,517.85 + 12,048.08 = 365,766.93")
 * and returns { parts, stated } so the arithmetic can be re-run. Null when no derivation.
 */
function parseDerivation(note) {
  const text = String(note || "");
  const chain = text.match(/(\$?\(?-?[\d,]+(?:\.\d+)?\)?)(\s*\+\s*\$?\(?-?[\d,]+(?:\.\d+)?\)?){1,}/);
  if (!chain) return null;
  const parts = chain[0].split("+").map((p) => parseAmount(p)).filter((n) => n !== null);
  if (parts.length < 2) return null;
  const after = text.slice(chain.index + chain[0].length).match(/^\s*=\s*(\$?\(?-?[\d,]+(?:\.\d+)?\)?)/);
  return { parts, stated: after ? parseAmount(after[1]) : null };
}

/**
 * Re-adds every arithmetic chain a note shows, on EVERY row regardless of verdict.
 *
 * Split out from the evidence check, which only looks at exact-zero ties, because a run
 * reported wages OUT_OF_BALANCE by $2,860 over a note reading "sum of W-2 Box 1 is
 * $377,814.01 ($351,200 + $2,517.85 + $12,048.08)" — those three terms add to $365,765.93,
 * and the claimed total silently counted one W-2 twice. A wrong OUT_OF_BALANCE does real
 * damage too: it tells the preparer to "correct" a line that was already right.
 *
 * Tolerances differ on purpose. Two figures the model wrote in the same sentence must agree
 * to the cent. The support column is routinely rounded to whole dollars, so comparing a
 * derivation against it allows the same $1 the tie threshold allows.
 */
function auditDerivations(rows) {
  let flagged = 0;
  const out = (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || typeof row !== "object") return row;
    if (String(row.status).toUpperCase() === NOT_VERIFIED) return row;
    const derivation = parseDerivation(row.note);
    if (!derivation) return row;
    const sum = round2(derivation.parts.reduce((a, b) => a + b, 0));
    const wp = parseAmount(row.workpaperAmount);
    const stated = derivation.stated;

    const downgrade = (why) => {
      flagged += 1;
      return { ...row, status: NOT_VERIFIED, note: appendNote(row.note, `Not verified: ${why}`) };
    };

    // The note contradicts itself: its own components do not reach its own total.
    if (stated !== null && Math.abs(sum - stated) >= 0.01) {
      return downgrade(`the amounts listed in this note add to ${sum.toFixed(2)}, not ${stated.toFixed(2)}. Re-add the support and confirm no document was counted twice or left out.`);
    }
    if (wp === null) return row;
    // The note and the support column disagree by more than whole-dollar rounding.
    const derived = stated === null ? sum : stated;
    if (Math.abs(derived - wp) >= TIE_THRESHOLD) {
      return downgrade(`the note derives ${derived.toFixed(2)} but the support column shows ${wp.toFixed(2)}. Reconcile the two before relying on this line.`);
    }
    return row;
  });
  return { rows: out, flagged };
}

/**
 * A support document is anything that is not the return itself. The failure this guards
 * against is copying the return figure into the support column, so finding the number in
 * the return proves nothing — only an outside document counts as evidence.
 */
function isSupportDocument(file) {
  const role = String((file && (file.reviewRole || file.role)) || "").toLowerCase();
  return !role.includes("current_return") && !role.includes("prior_return");
}

/**
 * Downgrades TIE rows whose support figure cannot be located anywhere in the package.
 * Only touches externally-verified lines the model reported as an exact-zero tie.
 *
 * Deliberately does NOT test whether the cited document *name* matches a real file: a
 * reviewer writing "the JP Morgan 1099" for a file named "Chase Self Directed..." is
 * describing the right document (Chase is JP Morgan) and that row ties for real. What
 * matters is whether the figure exists in the evidence, not how it was named.
 */
function verifyTieOutEvidence(rows, returnType, files) {
  const list = Array.isArray(rows) ? rows : [];
  const support = (Array.isArray(files) ? files : []).filter((f) => f && f.name && isSupportDocument(f));
  const required = requiredTieOutsFor(returnType);
  // With no support documents at all there is nothing to verify against; the missing-support
  // case is already reported by the checklist itself.
  if (!required.length || !support.length) return { rows: list, flagged: 0 };
  const searchable = support.filter((f) => String(f.text || "").trim().length > 40);
  const externalKeys = new Set(required.filter((r) => r.external).map((r) => canonicalLineKey(r.label)));
  let flagged = 0;

  const out = list.map((row) => {
    if (!row || typeof row !== "object") return row;
    if (!externalKeys.has(canonicalLineKey(row.lineItem))) return row;
    if (String(row.status).toUpperCase() !== "TIE") return row;
    const diff = parseAmount(row.difference);
    if (diff === null || diff !== 0) return row;
    const wp = parseAmount(row.workpaperAmount);
    if (wp === null) return row;
    const note = String(row.note || "");
    // The "no document named at all" case belongs to flagUnsupportedTies.
    if (!DOCUMENT_MENTION.test(note)) return row;

    const downgrade = (why) => {
      flagged += 1;
      return { ...row, status: NOT_VERIFIED, note: appendNote(row.note, `Not verified: ${why}`) };
    };

    // A derivation that survived auditDerivations is evidence enough: the components were
    // listed and they add up. Only an unexplained figure has to be found on a document.
    if (parseDerivation(note)) return row;

    // No derivation shown, so the figure itself must be readable on a support document.
    if (searchable.some((f) => amountAppearsInText(wp, f.text))) return row;
    if (!searchable.length) {
      return downgrade("every supporting document in this package is an image with no readable text, so this figure could not be confirmed. Check it by eye.");
    }
    return downgrade(`${wp.toFixed(2)} was not found in any supporting document, and the note does not show how it was derived. Locate the figure in the source or correct the support amount.`);
  });

  return { rows: out, flagged };
}

/* ---------------------------------------------------------------------------
 * Document coverage.
 *
 * A review is only as complete as the set of documents it actually opened. One run
 * reconciled wages against three W-2s when the package held five — it missed the spouse's
 * W-2 and counted a dependent child's, and the two errors nearly cancelled into a
 * plausible-looking difference. Nothing in the output revealed that two files had never
 * been read. Coverage is a counting problem, so code counts it.
 * ------------------------------------------------------------------------- */

/** Every place the review could refer to a document, flattened to one searchable string. */
function reviewEvidenceText(review) {
  const bits = [];
  const walk = (value, depth) => {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === "string") { bits.push(value); return; }
    if (typeof value === "number") return;
    if (Array.isArray(value)) { value.forEach((v) => walk(v, depth + 1)); return; }
    if (typeof value === "object") { Object.values(value).forEach((v) => walk(v, depth + 1)); }
  };
  walk(review, 0);
  return bits.join("\n");
}

/**
 * True when two filenames identify the same document. Token-SET equality, not overlap:
 * "VLT W2 2025.pdf" and "VLT W2 CCA 2025.pdf" are two different W-2s for the same person,
 * and a containment test marks the first as covered by the second — which is exactly the
 * file the review had skipped.
 */
function sameDocumentName(a, b) {
  const ta = identityTokens(a); const tb = identityTokens(b);
  if (!ta.length || ta.length !== tb.length) return false;
  const setB = new Set(tb);
  return ta.every((t) => setB.has(t));
}

/**
 * Reports, per uploaded file, whether the review says it read it.
 *
 * `read` is the load-bearing signal and is deliberately strict: the model is handed the
 * exact filenames, so documentsRead should echo them. `cited` (the file's identifying words
 * turning up in the findings) is reported for context but does not decide the status —
 * prose refers to "the Cornerstone W-2", never to the filename, so demanding it would
 * manufacture warnings about documents that were in fact used.
 */
function auditDocumentCoverage(review, files) {
  const docs = (Array.isArray(files) ? files : []).filter((f) => f && f.name);
  if (!docs.length) return { coverage: [], unreviewed: [] };
  const readList = Array.isArray(review && review.documentsRead) ? review.documentsRead : [];
  const readNames = readList.map((d) => String((d && (d.filename || d.name)) || "")).filter(Boolean);
  const evidence = reviewEvidenceText(review);

  const coverage = docs.map((file) => {
    const read = readNames.some((n) => sameDocumentName(n, file.name));
    // The only signal here the model cannot influence. `read` rests on documentsRead,
    // which the model fills in from the filenames it was handed — so it can list a file it
    // never opened, and in practice it does. Whether the file HAS readable text is a fact
    // about the package.
    const readable = String(file.text || "").trim().length > 40;
    return {
      name: file.name,
      role: (file.reviewRole || file.role || ""),
      read,
      readable,
      cited: textCitesFile(evidence, file.name),
      status: read ? "REVIEWED" : "NOT_REVIEWED",
    };
  });
  return {
    coverage,
    unreviewed: coverage.filter((c) => c.status !== "REVIEWED"),
    unreadable: coverage.filter((c) => !c.readable),
  };
}

/** Prompt block listing the mandatory checklist for this return type. */
function tieOutChecklistPromptLines(returnType) {
  const required = requiredTieOutsFor(returnType);
  if (!required.length) return [];
  return [
    "MANDATORY TIE-OUT CHECKLIST: tieOutResults must contain one row for EACH line below, every run, in this order. This list is fixed so two reviews of the same package compare the same lines.",
    ...required.map((r) => `  • ${r.label}  — compare against: ${r.source}`),
    "For each row: returnAmount is what the return actually shows; workpaperAmount is the figure you INDEPENDENTLY computed from the source named above — never copy the return figure into workpaperAmount without actually locating and adding up the support. State in `note` which document(s) you used and how the support amount was derived.",
    "When the support comes from more than one document, write the derivation in `note` as a plain arithmetic chain — for example \"12,000.00 + 3,500.00 + 480.25 = 15,980.25\" — listing EVERY document you added, and list one term per document even when its amount is 0. Code re-adds that chain and re-checks it against the support column, and a chain that does not add up, or that omits a document present in the package, is reported to the reviewer as unverified.",
    "If a line genuinely does not apply this year (no such income), still return the row with both amounts 0 and note 'not applicable — no such item this year'. If the support was not uploaded, return the row with workpaperAmount empty and say which document is missing. Do NOT omit a row.",
    "You may add extra tie-out rows beyond this list whenever another material number deserves one.",
  ];
}

module.exports = {
  enforceNumericVerdicts, enforceTieOutVerdicts, enforceBalanceSheetVerdict, parseAmount, TIE_THRESHOLD, NOT_VERIFIED,
  REQUIRED_TIE_OUTS, requiredTieOutsFor, canonicalLineKey, ensureRequiredTieOutRows, tieOutChecklistPromptLines,
  detectReturnTypeFromText, detectReturnTypeFromFiles, enforceRollupCoherence, flagUnsupportedTies,
  verifyTieOutEvidence, auditDocumentCoverage, auditDerivations, textCitesFile, amountAppearsInText, parseDerivation,
};
