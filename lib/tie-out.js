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

/** Applies both verdict engines to a review object. Mutation-free. */
function enforceNumericVerdicts(review) {
  if (!review || typeof review !== "object") return { review, corrections: 0 };
  const tie = enforceTieOutVerdicts(review.tieOutResults);
  const bs = enforceBalanceSheetVerdict(review.balanceSheetCheck);
  return {
    review: { ...review, tieOutResults: tie.rows, ...(bs.check ? { balanceSheetCheck: bs.check } : {}) },
    corrections: tie.changed + bs.changed,
  };
}

module.exports = { enforceNumericVerdicts, enforceTieOutVerdicts, enforceBalanceSheetVerdict, parseAmount, TIE_THRESHOLD };
