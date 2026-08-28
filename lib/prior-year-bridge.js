"use strict";

/**
 * prior-year-bridge.js — cross-year and cross-form checks the model keeps missing.
 *
 * Why this exists: three reviews of the same 1040 package, scored line by line against the
 * source documents, missed the two largest errors in the return. Both are invisible to any
 * review that only reads the current year, because the current-year forms are internally
 * perfect — the 8582 adds up, the 7203 adds up. What is wrong is a number that should have
 * been carried IN from last year, and a classification that silently flipped between years.
 *
 * A model can find these. It found one of them in one run out of three. That is the problem:
 * a $16,000 deduction cannot depend on a coin flip. These checks are arithmetic and string
 * comparison over two documents the firm already uploads, so they fire every time or not
 * at all, and they are cheap — no API call.
 *
 * On fragility: filed returns are read here as extracted text, whose column layout is not
 * reliable. Every extractor below is therefore written to fail CLOSED — an unparseable
 * form yields no finding rather than a guessed one — and every finding it does raise is
 * phrased for a human to confirm against the form, never as a settled conclusion.
 */

// Two shapes, and both turn up in the same package: a filed return prints comma groups
// ("351,200."), while the text pulled out of a W-2 prints none ("351200.00"). Matching only
// the grouped form does not fail loudly — it matches the first three digits and reads
// $351,200 of wages as $351. The grouped alternative is tried first so it wins the longer
// match; a trailing period is form typography, not a decimal point.
const AMOUNT = /-?\$?\(?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?/g;

function parseMoney(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  const cleaned = s.replace(/[()$,\s-]/g, "").replace(/\.$/, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Last money-looking token on a line — where tax forms print the answer. */
function lastAmountOnLine(line) {
  const hits = String(line || "").match(AMOUNT);
  if (!hits) return null;
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const n = parseMoney(hits[i]);
    // A bare year or a form number is not an amount.
    if (n !== null && Math.abs(n) >= 1 && !/^(19|20)\d{2}$/.test(hits[i].replace(/[^\d]/g, ""))) return n;
  }
  return null;
}

/** The first line matching `pattern`, plus the amount printed on it. */
function findLineAmount(text, pattern) {
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) {
      const here = lastAmountOnLine(lines[i]);
      if (here !== null) return { amount: here, line: lines[i], index: i };
      // Software wraps a long label; the figure lands on the next printed line.
      const next = lastAmountOnLine(lines[i + 1] || "");
      if (next !== null) return { amount: next, line: `${lines[i]} ${lines[i + 1]}`, index: i };
      return { amount: null, line: lines[i], index: i };
    }
  }
  return null;
}

/** Is this figure printed anywhere in `text`? Matches 44422 / 44,422 / 44,422.00 alike. */
function amountAppears(amount, text) {
  const hay = String(text || "");
  if (!hay || amount === null) return false;
  const whole = Math.trunc(Math.abs(amount));
  if (!whole) return false;
  const commas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return [String(whole), commas].some((c) => new RegExp(`(?<![\\d.,])${c}(?![\\d])`).test(hay));
}

/* ---------------------------------------------------------------------------
 * 1. Suspended passive losses that never arrived.
 *
 * Form 8582 Part VII allocates the losses a year could not allow. Those roll to the next
 * year's line 1c/2c. In the return that prompted this, the prior year suspended $44,422
 * and the current year's line 1c was blank — while the current year had enough passive
 * income to release it in full. Nothing in the current-year form is wrong; the number
 * simply never made the trip, and no amount of reading the 2025 return reveals it.
 * ------------------------------------------------------------------------- */

function extractUnallowedLossTotal(priorReturnText) {
  const lines = String(priorReturnText || "").split(/\r?\n/);
  const start = lines.findIndex((l) => /Allocation of Unallowed Losses/i.test(l));
  if (start < 0) return null;
  for (let i = start + 1; i < Math.min(start + 40, lines.length); i += 1) {
    if (/^\s*Part\s+[IVX]+/i.test(lines[i])) break; // ran into the next part
    if (/^\s*Total/i.test(lines[i])) {
      const amount = lastAmountOnLine(lines[i]);
      if (amount !== null && amount > 0) return amount;
    }
  }
  return null;
}

function checkSuspendedLossCarryforward(currentText, priorText) {
  const suspended = extractUnallowedLossTotal(priorText);
  if (suspended === null) return null;
  // Deliberately generous: if the figure shows up ANYWHERE in the current return we stay
  // quiet. Being wrong about a carryforward that was in fact picked up costs a reviewer
  // real time, and the amount landing on the wrong line is a smaller problem than it
  // vanishing entirely.
  if (amountAppears(suspended, currentText)) return null;
  return {
    severity: "HIGH",
    category: "Prior-year carryforward",
    title: "Suspended passive loss from the prior year does not appear on this return",
    detail: `The prior-year Form 8582 allocated ${suspended.toLocaleString("en-US", { style: "currency", currency: "USD" })} of rental losses as unallowed, which carries to this year's Form 8582 line 1c or 2c. That figure does not appear anywhere in this return. If this year has passive income, the suspended loss may be fully deductible now and is being left on the table.`,
    action: "Enter the prior-year unallowed loss on Form 8582 line 1c (rental) or 2c (other passive), then re-run Parts I-III and confirm the Schedule E line 22 deduction.",
    authority: "IRC §469(b); Form 8582 instructions, Parts I and VII",
  };
}

/* ---------------------------------------------------------------------------
 * 2. S corporation stock basis: continuity, and distributions that outran basis.
 *
 * Form 7203 prints its own rule next to line 6: a distribution larger than basis is a
 * capital gain. The form computes the limit correctly and then says nothing more — whether
 * the gain reached Schedule D is a different form's problem, and nobody's job.
 * ------------------------------------------------------------------------- */

function extractStockBasis(text) {
  const before = findLineAmount(text, /^\s*5\s+Stock basis before distributions/i);
  const distributions = findLineAmount(text, /^\s*6\s+Distributions \(excluding dividend/i);
  if (!before && !distributions) return null;
  return {
    basisBeforeDistributions: before ? before.amount : null,
    distributions: distributions ? distributions.amount : null,
  };
}

function checkExcessDistributions(priorText, priorYearLabel) {
  const basis = extractStockBasis(priorText);
  if (!basis || basis.basisBeforeDistributions === null || basis.distributions === null) return null;
  const excess = Math.round((basis.distributions - basis.basisBeforeDistributions) * 100) / 100;
  if (excess <= 0) return null;
  // If the gain was reported, the figure is printed on that return somewhere.
  if (amountAppears(excess, priorText)) return null;
  const money = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return {
    severity: "HIGH",
    category: "Prior-year return",
    title: `Distributions exceeded stock basis on the ${priorYearLabel} return with no capital gain reported`,
    detail: `On the ${priorYearLabel} Form 7203, distributions of ${money(basis.distributions)} exceeded stock basis before distributions of ${money(basis.basisBeforeDistributions)} by ${money(excess)}. The instruction printed on line 6 requires that excess to be reported as a capital gain on Form 8949 and Schedule D. ${money(excess)} does not appear on that return.`,
    action: `Confirm whether the ${priorYearLabel} return reported the excess distribution as a capital gain. If it did not, an amended return may be required, and this year's beginning stock basis should be re-examined.`,
    authority: "IRC §1368(b)(2); Form 7203 instructions, line 6",
  };
}

/* ---------------------------------------------------------------------------
 * 3. A passive/non-passive classification that changed between years.
 *
 * Whether an activity is passive drives three things at once: which losses release, what
 * lands in net investment income, and the NIIT. When the answer flips between years for
 * the same entity, one of the two returns is wrong — and neither one looks wrong on its
 * own. Form 8960 line 4b is where the answer is stated out loud.
 * ------------------------------------------------------------------------- */

const NIIT_ADJUSTMENT = /Adjustment for net income or loss derived in the ordinary course/i;

function extractNiitBusinessAdjustment(text) {
  const hit = findLineAmount(text, NIIT_ADJUSTMENT);
  return hit ? hit.amount : null;
}

function checkNiitTreatmentChange(currentText, priorText, priorYearLabel) {
  const prior = extractNiitBusinessAdjustment(priorText);
  const current = extractNiitBusinessAdjustment(currentText);
  if (prior === null || current === null) return null;
  const priorSize = Math.abs(prior);
  const currentSize = Math.abs(current);
  // Only a collapse is interesting: last year a large block of business income was excluded
  // from net investment income as an active trade or business, this year almost none is.
  if (priorSize < 25000 || currentSize >= priorSize * 0.25) return null;
  const money = (n) => Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return {
    severity: "HIGH",
    category: "Year-over-year consistency",
    title: "Business income treated as active last year is inside net investment income this year",
    detail: `Form 8960 line 4b removed ${money(prior)} on the ${priorYearLabel} return as income from a non-section 1411 trade or business, but only ${money(current)} on this return. Unless the taxpayer's involvement genuinely changed, the same activity is being treated as non-passive in one year and passive in the other, and one of the two returns is wrong.`,
    action: "Establish material participation for the pass-through activity, document the conclusion, and apply it consistently across Schedule E, Form 8582 and Form 8960. The answer also decides whether the rental losses release or suspend.",
    authority: "IRC §1411(c)(2); Reg. §1.469-5T (material participation); Form 8960 instructions, line 4b",
  };
}

/* ---------------------------------------------------------------------------
 * 4. Wages drawn from an entity whose income is reported as passive.
 *
 * The cheapest material-participation tell there is: a shareholder-employee earning a real
 * salary from the entity is working there. The EIN on the W-2 and the EIN on Schedule E
 * are the same string, so code can match them.
 * ------------------------------------------------------------------------- */

const EIN = /\b(\d{2}-\d{7})\b/g;

/**
 * Box 1 wages off a W-2's extracted text.
 *
 * The label line reads "1 Wages, tips, other compensation   2 Federal income tax withheld"
 * and the figures print on the line below it, so reading the amount off the label yields
 * "2" — the box number of the next field. Returns null rather than a wrong number: this
 * figure only decorates a finding, and a review that says a shareholder earning "$2.00"
 * must be materially participating discredits itself.
 */
function w2BoxOneWages(text) {
  const lines = String(text || "").split(/\r?\n/);
  const at = lines.findIndex((l) => /Wages, tips, other compensation/i.test(l));
  if (at < 0) return null;
  for (let i = at + 1; i < Math.min(at + 5, lines.length); i += 1) {
    const hits = (lines[i].match(AMOUNT) || []).map(parseMoney).filter((n) => n !== null && n >= 100);
    if (hits.length) return hits[0]; // Box 1 prints leftmost, Box 2 to its right
  }
  return null;
}

function einsFromW2Documents(files) {
  const found = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const text = returnText(file);
    if (!/Wages, tips, other compensation/i.test(text)) continue;
    const amount = w2BoxOneWages(text);
    for (const match of text.matchAll(EIN)) {
      const prior = found.get(match[1]);
      if (!prior || (amount !== null && amount > (prior.wages || 0))) {
        found.set(match[1], { ein: match[1], wages: amount, source: String(file?.name || "W-2") });
      }
    }
  }
  return found;
}

/** The Form 8582 block listing non-rental passive activities, if the return has one. */
function passiveActivitySection(text) {
  const s = String(text || "");
  const start = s.search(/Complete This Part Before Part I, Lines 2a/i);
  if (start < 0) return "";
  const rest = s.slice(start);
  const end = rest.search(/Part\s+VI\b/i);
  return end > 0 ? rest.slice(0, end) : rest.slice(0, 4000);
}

/**
 * Multi-word ALL-CAPS names printed in a block of form text.
 *
 * Read out of the Form 8582 activity list rather than off the Schedule E line, because the
 * 8582 prints the entity name alone while Schedule E surrounds it with column letters and
 * checkbox marks — "A INTEGRITYSURE LLC   S   99-0477416   X" reads as one capitalised run
 * and matches nothing.
 */
function entityNamesIn(block) {
  const names = new Set();
  for (const run of String(block || "").match(/[A-Z][A-Z&.'-]*(?:[ \t]+[A-Z][A-Z&.'-]*)*/g) || []) {
    const name = run.trim().replace(/\s+/g, " ");
    // Two or more words, and not a run of one-letter column headers.
    if (name.length >= 8 && /\s/.test(name) && !/^(?:[A-Z] )+[A-Z]$/.test(name)) names.add(name);
  }
  return [...names];
}

function checkWagesFromPassiveEntity(currentText, files) {
  const passive = passiveActivitySection(currentText);
  if (!passive.trim()) return null;
  const passiveAmounts = (passive.match(AMOUNT) || []).map(parseMoney).filter((n) => n !== null && Math.abs(n) >= 1000);
  if (!passiveAmounts.length) return null;

  const w2Eins = einsFromW2Documents(files);
  if (!w2Eins.size) return null;
  const lines = String(currentText || "").split(/\r?\n/);
  const passiveNames = entityNamesIn(passive);
  if (!passiveNames.length) return null;

  for (const [ein, info] of w2Eins) {
    // A W-2 EIN that also appears on the return means the taxpayer both works for the
    // entity and reports its income. Tie the two together by NAME rather than by a nearby
    // amount: extracted return text scrambles columns, so the figure for a Schedule E line
    // can sit a dozen lines away from its own EIN, while the name stays beside it.
    const at = lines.findIndex((l) => l.includes(ein));
    if (at < 0) continue;
    const window = lines.slice(Math.max(0, at - 3), at + 4).join(" ").toUpperCase();
    const name = passiveNames.find((n) => window.includes(n.toUpperCase()));
    if (!name) continue;
    const shared = Math.max(...passiveAmounts.map(Math.abs));
    const money = (n) => Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
    return {
      severity: "HIGH",
      category: "Passive activity classification",
      title: "The taxpayer draws wages from an entity whose income is reported as passive",
      detail: `${name} (EIN ${ein}) appears on a Form W-2 in this package${info.wages && info.wages >= 1000 ? ` paying ${money(info.wages)} of wages` : ""}, and the same entity is listed on Form 8582 among non-rental passive activities, carrying up to ${money(shared)} of income. A shareholder-employee drawing a salary of that size will normally satisfy material participation, which would make the income non-passive.`,
      action: "Test material participation under Reg. §1.469-5T and document the answer. If the activity is non-passive, the income leaves net investment income and the passive losses it currently absorbs will suspend instead — both effects are material and move in opposite directions.",
      authority: "Reg. §1.469-5T(a); IRC §469(h)(1); IRC §1411(c)(2)",
    };
  }
  return null;
}

/* ------------------------------------------------------------------------- */

/** Picks the uploaded files that are the current and prior filed returns. */
function returnText(file) {
  // fullText is the uncompacted document; text is what fitted in the prompt budget.
  return String((file && (file.fullText || file.text)) || "");
}

const FILED_RETURN = /U\.S\. Individual Income Tax Return|Income Tax Return for an S Corporation|Return of Partnership Income|U\.S\. Corporation Income Tax Return/i;

/** The tax year a filed return is FOR — the year its own forms are printed with. */
function returnYear(file) {
  const text = returnText(file);
  const counts = new Map();
  for (const match of text.matchAll(/\b(20[12]\d)\b/g)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  // The filed year saturates the document (every schedule header carries it); the following
  // year appears only on the estimated-tax worksheets, so frequency separates them cleanly.
  let best = null;
  for (const [year, n] of counts) {
    if (!best || n > best.n) best = { year: Number(year), n };
  }
  return best && best.n >= 5 ? best.year : null;
}

/**
 * Picks the current and prior filed returns out of the package.
 *
 * Roles first, then content. The role fields are set in the browser only when the uploader
 * tags a file as the current- or prior-year return, and in practice they arrive unset — the
 * first production run of these checks found both returns present, both untagged, and
 * reported nothing at all. Identifying a filed return by what is printed on it does not
 * depend on anyone remembering to use a dropdown.
 */
function splitReturns(files, meta = {}) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && returnText(f).trim().length > 500);
  const roleOf = (f) => String(f.reviewRole || f.role || "").toLowerCase();
  let current = list.find((f) => roleOf(f).includes("current_return")) || null;
  let prior = list.find((f) => roleOf(f).includes("prior_return")) || null;
  if (current && prior) return { current, prior, byContent: false };

  const returns = list
    .filter((f) => FILED_RETURN.test(returnText(f)))
    .map((f) => ({ file: f, year: returnYear(f) }))
    .filter((r) => r.year !== null)
    .sort((a, b) => b.year - a.year);
  // One untagged return is still the current-year return: the checks that read only this
  // year can run on it, and the cross-year ones stay silent on their own.
  if (!returns.length && !(current || prior)) return { current, prior, byContent: false };

  const stated = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
  const wanted = Number.isFinite(stated) && stated > 2000 ? stated : (returns[0] && returns[0].year);
  current = current || (returns.find((r) => r.year === wanted) || returns[0] || {}).file || null;
  prior = prior || (returns.find((r) => r.year === wanted - 1) || returns.find((r) => r.file !== current) || {}).file || null;
  return { current, prior, byContent: true };
}

/**
 * Runs every cross-year / cross-form check and returns the findings.
 * Silent by design when the inputs are not there: no prior return, no findings.
 */
function runPriorYearChecks(files, meta = {}) {
  const { current, prior, byContent } = splitReturns(files, meta);
  const identified = { current: (current && current.name) || "", prior: (prior && prior.name) || "", byContent: Boolean(byContent) };
  if (!current) {
    const none = [];
    none.identified = identified;
    return none;
  }
  const currentText = returnText(current);
  const priorText = prior ? returnText(prior) : "";
  const taxYear = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
  const priorLabel = Number.isFinite(taxYear) && taxYear > 2000 ? String(taxYear - 1) : "prior-year";

  const findings = [
    checkWagesFromPassiveEntity(currentText, files),
  ];
  if (priorText) {
    findings.push(
      checkSuspendedLossCarryforward(currentText, priorText),
      checkExcessDistributions(priorText, priorLabel),
      checkNiitTreatmentChange(currentText, priorText, priorLabel)
    );
  }
  const found = findings.filter(Boolean);
  // Surfaced so a run that reports nothing can be told apart from a run that had nothing
  // to find — the difference between the two took a production round-trip to diagnose.
  found.identified = identified;
  return found;
}

module.exports = {
  runPriorYearChecks, splitReturns, returnYear,
  checkSuspendedLossCarryforward,
  checkExcessDistributions,
  checkNiitTreatmentChange,
  checkWagesFromPassiveEntity,
  extractUnallowedLossTotal,
  extractStockBasis,
  extractNiitBusinessAdjustment,
  einsFromW2Documents, w2BoxOneWages, entityNamesIn,
  parseMoney,
  amountAppears,
};
