"use strict";

/**
 * entity-return-checks.js — deterministic cross-checks for entity returns.
 *
 * The 1040 checks live in prior-year-bridge.js and are untouched by this file: they key off
 * Forms 8582, 7203, 8960 and W-2s, which is why they produced nothing at all on the first
 * partnership return that came through. That silence was correct behaviour and a real gap —
 * the entity return ran without any of the guarantees a 1040 gets.
 *
 * What goes in here is the same principle as there: anything a reviewer establishes by
 * subtracting two numbers or comparing two columns belongs in code, because the model's own
 * findings on an identical package have ranged from nineteen to zero. Everything below is
 * arithmetic or string comparison over documents the firm already uploads.
 *
 * SCOPE AND HONESTY ABOUT IT. The extractors were written against, and validated on, a real
 * two-year 1065 (Form 8825 rental partnership) read through the same pdf.js path production
 * uses — not against a cleaner text layout, which is a mistake that cost several days of
 * chasing ghosts. 1120-S shares the K-1 and M-2 shapes and is expected to work; 1120 and 1041
 * are covered only by the checks that read Schedule L, because no sample of either was
 * available to validate anything more specific and writing unvalidated extractors for them
 * would just move the guessing somewhere harder to see. Every extractor fails CLOSED: an
 * unreadable form produces no finding rather than an invented one.
 */

const AMOUNT_TOKEN = /-?\(?\$?\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?/g;

function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text.replace(/[($\s]/g, ""));
  const cleaned = text.replace(/[()$,\s-]/g, "").replace(/\.$/, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Every money figure printed on a line, left to right — which is column order on a form.
 *
 * A tax form line carries its own line number twice: once at the left margin and again in the
 * box beside the figures ("14 Depreciation . . . 14 3,058. 10,544."). Both look like numbers,
 * and counting them turned $13,602 of depreciation into $13,630 and read Schedule M-2's
 * opening balance as $1. A repeated box number is a bare integer, small, sitting immediately
 * before a formatted figure — money on these forms is printed with a comma or a trailing
 * period, so the two are distinguishable without guessing at magnitudes.
 */
const DOT_LEADER = /\.(?:\s*\.){2,}/g;

/**
 * Figures live to the right of the dot leader. Reading the whole line also picks up the line
 * numbers a label quotes in prose — "Subtract line 18 from line 2c" contributed an $18 to the
 * rental columns and shifted every property one place. `leader` says which side to read:
 * "last" for a normal form line, "first" for Schedule M-2, whose two columns share one
 * printed line so the left-hand figure sits before the right-hand label's own leader.
 */
function amountsOn(line, { leader = "all" } = {}) {
  let text = String(line || "");
  if (leader !== "all") {
    const runs = [...text.matchAll(DOT_LEADER)];
    if (runs.length) {
      const chosen = leader === "first" ? runs[0] : runs[runs.length - 1];
      text = text.slice(chosen.index + chosen[0].length);
    }
  }
  const stripped = text.replace(/^\s*\d{1,2}[a-z]?\s+/i, "");
  const tokens = stripped.match(AMOUNT_TOKEN) || [];
  const out = [];
  tokens.forEach((token, index) => {
    const value = parseAmount(token);
    if (value === null) return;
    // A year, only if it is printed bare. Money on these forms carries a comma, a trailing
    // period, a dollar sign or parentheses, so "$ -2,000." and "2,000." survive while a naked
    // "2025" does not. Without the decoration test an ending capital account of exactly
    // $2,000 vanished, and the K-1 it belonged to stopped being read at all.
    const decorated = /[$(),.-]/.test(token);
    if (!decorated && /^(19|20)\d{2}$/.test(token)) return;
    const bare = !/[.,]/.test(token);
    const nextIsFormatted = /[.,]/.test(tokens[index + 1] || "");
    if (bare && Math.abs(value) <= 30 && nextIsFormatted) return;
    out.push(value);
  });
  return out;
}

const linesOf = (text) => String(text || "").split(/\r?\n/);

/** First line matching `pattern`, with its figures. Null when the form did not extract. */
function lineWithAmounts(text, pattern, { minCount = 1, leader = "last" } = {}) {
  for (const line of linesOf(text)) {
    if (!pattern.test(line)) continue;
    const values = amountsOn(line, { leader });
    if (values.length >= minCount) return { line, values };
  }
  return null;
}

const money = (n) => Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
const round2 = (n) => Math.round(n * 100) / 100;
/** A dollar of slack: filed returns are whole-dollar and workpapers carry cents. */
const differs = (a, b, tolerance = 1) => Math.abs(a - b) >= tolerance;

/* ---------------------------------------------------------------------------
 * Schedule L: this year's opening column against last year's closing column.
 *
 * The single most mechanical error an entity return can carry, and invisible from inside the
 * current year — the balance sheet balances either way. It only shows when the two returns
 * are laid side by side, which is precisely what nobody does on a small engagement.
 * ------------------------------------------------------------------------- */

const SCHEDULE_L_LINES = [
  { key: "totalAssets", label: "Total assets", pattern: /^\s*14\s+Total assets\b/i },
  { key: "totalLiabAndCapital", label: "Total liabilities and capital", pattern: /^\s*(2[78]|22)\s+Total liabilities and (capital|shareholders|equity)/i },
];

/** Schedule L prints beginning-of-year then end-of-year; the last figure is the closing one. */
function scheduleLColumns(text, pattern) {
  const hit = lineWithAmounts(text, pattern, { minCount: 2 });
  if (!hit) return null;
  const values = hit.values;
  return { beginning: values[0], ending: values[values.length - 1] };
}

function checkBalanceSheetContinuity(currentText, priorText, priorYearLabel) {
  const findings = [];
  for (const { key, label, pattern } of SCHEDULE_L_LINES) {
    const current = scheduleLColumns(currentText, pattern);
    const prior = scheduleLColumns(priorText, pattern);
    if (!current || !prior) continue;
    if (!differs(current.beginning, prior.ending)) continue;
    findings.push({
      severity: "HIGH",
      category: "Prior-year continuity",
      title: `Schedule L ${label.toLowerCase()} does not open where the ${priorYearLabel} return closed`,
      detail: `The ${priorYearLabel} return ends the year with ${label.toLowerCase()} of ${money(prior.ending)}; this return opens with ${money(current.beginning)}, a difference of ${money(round2(current.beginning - prior.ending))}. A balance sheet that balances in both years hides this — it only shows when the two are compared.`,
      action: `Reconcile the opening Schedule L to the ${priorYearLabel} closing balances. If the prior return was amended or the books were restated, document the bridge.`,
      authority: "Form 1065/1120/1120-S instructions, Schedule L",
      key,
    });
  }
  return findings;
}

/* ---------------------------------------------------------------------------
 * Accumulated depreciation against the depreciation actually deducted.
 *
 * The reserve should move by exactly the year's depreciation unless something was disposed
 * of. When it does not, either the deduction is wrong or a disposal went unreported — and a
 * disposal that never reached Form 4797 takes its gain with it.
 * ------------------------------------------------------------------------- */

function accumulatedDepreciation(text) {
  // "b Less accumulated depreciation . . . 28,162. 354,443. 41,764. 341,039."
  // Four figures: opening reserve, opening net, closing reserve, closing net.
  // Anchored to the Schedule L line itself: a supporting statement prints the same words in
  // capitals earlier in the package, with only the closing figures, and matching that first
  // read the reserve backwards.
  const hit = lineWithAmounts(text, /^\s*b\s+Less accumulated depreciation/i, { minCount: 2 });
  if (!hit) return null;
  const v = hit.values;
  if (v.length >= 4) return { beginning: v[0], ending: v[2] };
  if (v.length === 2) return { beginning: v[0], ending: v[1] };
  return null;
}

/** Depreciation claimed for the year, from Form 8825 or the return's own deduction line. */
function depreciationDeducted(text) {
  const rental = lineWithAmounts(text, /^\s*14\s+Depreciation \(see instructions\)/i);
  if (rental) return round2(rental.values.reduce((sum, n) => sum + n, 0));
  const direct = lineWithAmounts(text, /^\s*\d{1,2}\s+Depreciation\b(?!.*amortization)/i);
  return direct ? direct.values[direct.values.length - 1] : null;
}

function checkAccumulatedDepreciationRollforward(currentText) {
  const reserve = accumulatedDepreciation(currentText);
  const claimed = depreciationDeducted(currentText);
  if (!reserve || claimed === null) return null;
  const movement = round2(reserve.ending - reserve.beginning);
  if (!differs(movement, claimed)) return null;
  return {
    severity: "MEDIUM",
    category: "Balance sheet vs deduction",
    title: "Accumulated depreciation did not move by the depreciation deducted",
    detail: `Schedule L shows accumulated depreciation going from ${money(reserve.beginning)} to ${money(reserve.ending)}, a movement of ${money(movement)}, while ${money(claimed)} of depreciation was deducted — a gap of ${money(round2(movement - claimed))}.`,
    action: "Reconcile the depreciation schedule to Schedule L. If an asset was disposed of, confirm the disposal reached Form 4797 and that its accumulated depreciation was removed from the reserve.",
    authority: "Form 4562 instructions; Form 1065/1120/1120-S Schedule L",
  };
}

/* ---------------------------------------------------------------------------
 * Schedule M-2: the capital roll-forward, re-added.
 * ------------------------------------------------------------------------- */

const M2_LINES = {
  beginning: /^\s*1\s+Balance at beginning of year/i,
  contributed: /^\s*2\s+Capital contributed/i,
  income: /^\s*3\s+Net income \(loss\)/i,
  // Lines 5 and 8 are the form's own subtotals, and they already contain whatever was
  // itemized on line 4 (other increases) and line 7 (other decreases).
  additions: /\b5\s+Add lines 1 through 4/i,
  reductions: /\b8\s+Add lines 6 and 7/i,
  ending: /Balance at end of year/i,
};

function scheduleM2(text) {
  const out = {};
  for (const [key, pattern] of Object.entries(M2_LINES)) {
    const rightHandColumn = key === "ending" || key === "reductions";
    const hit = lineWithAmounts(text, pattern, { leader: rightHandColumn ? "last" : "first" });
    out[key] = hit ? (rightHandColumn ? hit.values[hit.values.length - 1] : hit.values[0]) : null;
  }
  // Distributions share a printed line with the left-hand column on the real form:
  // "1 Balance at beginning of year . . . 153. 6 Distributions: a Cash . . . 14,274."
  const distributionLine = lineWithAmounts(text, /Distributions:\s*a\s*Cash/i, { minCount: 1, leader: "last" });
  out.distributions = distributionLine ? distributionLine.values[distributionLine.values.length - 1] : null;
  return out;
}

/**
 * True when line 4 (other increases) or line 7 (other decreases) carries an itemized amount.
 *
 * Both rows print their label in one column of the form and their figure in the other, so the
 * figure lands on a neighbouring text line and cannot be attributed to one row or the other
 * with any confidence. This only has to answer "is there something there", which it can.
 */
function hasItemizedOtherMovement(text) {
  const lines = linesOf(text);
  return lines.some((line, index) => {
    if (!/Other\s+(?:increases|decreases)/i.test(line)) return false;
    return amountsOn(line).length > 0 || amountsOn(lines[index + 1] || "").length > 0;
  });
}

function checkCapitalRollforward(currentText) {
  const m2 = scheduleM2(currentText);
  const { beginning, contributed, income, distributions, additions, reductions, ending } = m2;
  if (ending === null) return null;

  // Preferred path: the form's own subtotals. Line 5 already contains line 4 and line 8
  // already contains line 7, so this is the whole roll-forward with nothing left to guess at.
  if (additions !== null && reductions !== null) {
    const expected = round2(additions - reductions);
    if (!differs(expected, ending)) return null;
    return {
      severity: "HIGH",
      category: "Capital accounts",
      title: "Schedule M-2 does not roll forward",
      detail: `Schedule M-2 line 5 (total additions) ${money(additions)} less line 8 (total reductions) ${money(reductions)} comes to ${money(expected)}, but line 9 closes at ${money(ending)} — a difference of ${money(round2(ending - expected))}.`,
      action: "Re-add Schedule M-2. Line 9 must equal line 5 less line 8.",
      authority: "Form 1065 Schedule M-2; Form 1120-S Schedule M-2",
    };
  }

  // Fallback for layouts where the subtotals do not survive extraction. Adding up the
  // components is only the whole story when nothing was itemized on line 4 or line 7 — a
  // return carrying either (non-deductible meals are the common one) would otherwise show a
  // phantom break for exactly that amount, at HIGH, on a return that foots perfectly.
  if ([beginning, income].some((v) => v === null)) return null;
  if (hasItemizedOtherMovement(currentText)) return null;
  const expected = round2(beginning + (contributed || 0) + income - (distributions || 0));
  if (!differs(expected, ending)) return null;
  return {
    severity: "HIGH",
    category: "Capital accounts",
    title: "Schedule M-2 does not roll forward",
    detail: `Opening capital ${money(beginning)} plus contributions ${money(contributed || 0)} plus income ${money(income)} less distributions ${money(distributions || 0)} comes to ${money(expected)}, but Schedule M-2 closes at ${money(ending)} — a difference of ${money(round2(ending - expected))}.`,
    action: "Identify the missing movement. An unexplained change in partners' or shareholders' capital usually means a contribution, distribution or income item was posted to equity without reaching the return.",
    authority: "Form 1065 Schedule M-2; Form 1120-S Schedule M-2",
  };
}

/* ---------------------------------------------------------------------------
 * The K-1s against the return they came from.
 * ------------------------------------------------------------------------- */

const K1_CAPITAL_LINES = {
  beginning: /^Beginning capital account/i,
  contributed: /^Capital contributed during the year/i,
  income: /^Current year net income \(loss\)/i,
  withdrawals: /^Withdrawals and distributions/i,
  ending: /^Ending capital account/i,
};

/** One entry per K-1 in the package, in the order the forms appear. */
function k1CapitalAccounts(text) {
  const lines = linesOf(text);
  const accounts = [];
  let current = null;
  lines.forEach((line) => {
    for (const [key, pattern] of Object.entries(K1_CAPITAL_LINES)) {
      if (!pattern.test(line)) continue;
      const values = amountsOn(line);
      if (!values.length) return;
      if (key === "beginning") {
        current = { beginning: values[0] };
        accounts.push(current);
      } else if (current) {
        // Withdrawals print inside parentheses; store the magnitude.
        current[key] = key === "withdrawals" ? Math.abs(values[0]) : values[0];
      }
      return;
    }
  });
  return accounts.filter((a) => a.ending !== undefined);
}

function checkK1sFootToReturn(currentText) {
  const accounts = k1CapitalAccounts(currentText);
  if (accounts.length < 2) return null;
  const m2 = scheduleM2(currentText);
  const sum = (key) => round2(accounts.reduce((total, a) => total + (a[key] || 0), 0));
  const comparisons = [
    { label: "beginning capital", k1: sum("beginning"), ret: m2.beginning },
    { label: "capital contributed", k1: sum("contributed"), ret: m2.contributed },
    { label: "current-year income (loss)", k1: sum("income"), ret: m2.income },
    { label: "distributions", k1: sum("withdrawals"), ret: m2.distributions },
    { label: "ending capital", k1: sum("ending"), ret: m2.ending },
  ].filter((c) => c.ret !== null && c.ret !== undefined && differs(c.k1, c.ret));
  if (!comparisons.length) return null;
  return {
    severity: "HIGH",
    category: "K-1 reconciliation",
    title: "The K-1s do not add up to the return",
    detail: comparisons.map((c) => `${c.label}: the ${accounts.length} K-1s total ${money(c.k1)} against ${money(c.ret)} on Schedule M-2 (off by ${money(round2(c.k1 - c.ret))})`).join("; ") + ".",
    action: "Every K-1 column must sum to the corresponding Schedule M-2 line. A partner or shareholder whose K-1 disagrees with the return will report the wrong figure and cannot be corrected later without an amended K-1.",
    authority: "Form 1065 Schedule K-1, item L; Form 1120-S Schedule K-1",
  };
}

/* ---------------------------------------------------------------------------
 * Partner/shareholder movements on the K-1s against the movements in the books.
 *
 * The check that motivated this file. A real 1065 split the year's contributions and
 * distributions evenly across two partners, while the workpaper's comparative balance sheet
 * showed one partner's equity accounts unchanged from the prior year and the other's carrying
 * the entire movement. Both K-1s were wrong, the totals were right, so Schedule M-2 footed
 * perfectly and nothing on the return looked out of place. The prior year had allocated the
 * same accounts correctly, so this was a one-year regression.
 * ------------------------------------------------------------------------- */

const EQUITY_ROW = /partner[\s-]*|member[\s-]*|shareholder[\s-]*/i;

/**
 * Per-owner equity movement out of a workpaper's comparative balance sheet, from rows like
 * "Partner-Gerard Contributions,30115.62,17234.32". Requires both years side by side, which
 * is how these workbooks are built.
 */
function ownerMovementsFromWorkpaper(files) {
  const movements = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const text = String((file && (file.fullText || file.text)) || "");
    if (!/contribution/i.test(text) || !/distribution/i.test(text)) continue;
    for (const line of linesOf(text)) {
      const match = line.match(/(?:partner|member|shareholder)[\s-]+([A-Za-z][A-Za-z'.-]+)\s*(contributions?|distributions?|draws?)/i);
      if (!match) continue;
      const values = amountsOn(line);
      if (values.length < 2) continue;
      const name = match[1].toLowerCase();
      const kind = /contrib/i.test(match[2]) ? "contributed" : "withdrawn";
      const movement = Math.abs(round2(values[0] - values[1]));
      const entry = movements.get(name) || { name: match[1], contributed: null, withdrawn: null };
      entry[kind] = movement;
      movements.set(name, entry);
    }
  }
  return [...movements.values()];
}

/** Owner names printed on the K-1s, in the order the forms appear. */
function k1OwnerNames(text) {
  const names = [];
  const lines = linesOf(text);
  lines.forEach((line, index) => {
    if (!/^Beginning capital account/i.test(line)) return;
    // The name sits a few lines above item L, in capitals, on its own.
    for (let i = index - 1; i >= Math.max(0, index - 60); i -= 1) {
      const candidate = lines[i].trim();
      if (/^[A-Z][A-Z .'-]{4,60}$/.test(candidate) && /\s/.test(candidate) && !/[0-9]/.test(candidate)) {
        names.push(candidate);
        return;
      }
    }
    names.push("");
  });
  return names;
}

function checkOwnerAllocationAgainstBooks(currentText, files) {
  const bookMovements = ownerMovementsFromWorkpaper(files);
  if (bookMovements.length < 2) return null;
  const accounts = k1CapitalAccounts(currentText);
  const names = k1OwnerNames(currentText);
  if (accounts.length < 2 || accounts.length !== names.length) return null;

  const mismatches = [];
  accounts.forEach((account, index) => {
    const printed = names[index] || "";
    const book = bookMovements.find((m) => printed.toLowerCase().includes(m.name.toLowerCase()));
    if (!book) return;
    for (const [key, label] of [["contributed", "contributions"], ["withdrawn", "distributions"]]) {
      const onBooks = book[key];
      const onK1 = key === "contributed" ? account.contributed : account.withdrawals;
      if (onBooks === null || onBooks === undefined || onK1 === undefined) continue;
      if (!differs(onBooks, onK1)) continue;
      mismatches.push(`${printed || "an owner"}: the books move ${label} by ${money(onBooks)} for the year, the K-1 reports ${money(onK1)}`);
    }
  });
  if (!mismatches.length) return null;
  return {
    severity: "HIGH",
    category: "K-1 allocation",
    title: "The K-1s allocate contributions or distributions differently from the books",
    detail: `${mismatches.join("; ")}. The totals can still be right — an even split of the correct total foots to Schedule M-2 and leaves nothing visibly wrong on the return — while both owners' capital accounts are misstated.`,
    action: "Allocate each contribution and distribution to the owner who actually made or received it, per the comparative equity accounts, and reissue the affected K-1s. Capital accounts drive basis, and a wrong opening balance follows the owner into every later year.",
    authority: "IRC §704(b); Reg. §1.704-1(b)(2)(iv) (capital account maintenance); Form 1065 Schedule K-1, item L",
  };
}

/* ---------------------------------------------------------------------------
 * The same allocation error in a book that does not name its owners.
 *
 * checkOwnerAllocationAgainstBooks above needs rows like "Partner-Gerard Distributions" with
 * two comparative columns, which is one way these workbooks get built. The other way names
 * nothing: "Member Draws/Contributions -435,765.51" and "Member Draws- Partner Payout
 * -32,808.73", one column, no owner anywhere. Nobody can map those to partners by reading
 * them, so this does not try to.
 *
 * What it can say is narrower and still worth saying. When the draw accounts add up to
 * exactly the distributions on the return — which is what makes them the distributions — and
 * not one of them equals what any K-1 reports, then the K-1s were filled in from the
 * ownership percentages rather than from who took the money. On the return that prompted this
 * the books split 93/7 and the K-1s split 99/1, so about $28,000 of capital sat on the wrong
 * partner while Schedule M-2 footed perfectly.
 * ------------------------------------------------------------------------- */

const DRAW_ROW = /\b(draws?|distributions?|withdrawals?)\b/i;

/**
 * Splits a spreadsheet row into cells, honouring the quotes SheetJS puts around a formatted
 * figure.
 *
 * A workbook whose cells carry a thousands separator exports as `Member Draws,"-435,765.51"`,
 * and the obvious way to separate cells — replacing every comma with a space — cuts that
 * figure into 435 and 765.51. The check then found no draw accounts at all and stayed silent
 * on the return it was written for, while the review's own prose quoted the number correctly.
 */
function csvCells(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (const character of String(line || "")) {
    if (character === '"') { quoted = !quoted; continue; }
    if (character === "," && !quoted) { cells.push(cell.trim()); cell = ""; continue; }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

/** Draw accounts from a workbook's equity section: one label, one figure, not a subtotal. */
function drawAccountsFromWorkpaper(files) {
  const accounts = [];
  for (const file of Array.isArray(files) ? files : []) {
    const text = String((file && (file.fullText || file.text)) || "");
    if (!/^---\s*Sheet:/m.test(text) && !/\.(xlsx|xlsm|xls|csv)$/i.test(String(file?.name || ""))) continue;
    for (const line of linesOf(text)) {
      const cells = csvCells(line);
      const label = cells.find((cell) => cell && DRAW_ROW.test(cell));
      if (!label) continue;
      // "Total for Member Draws/Contributions" is the subtotal of the rows above it.
      if (/^total\b/i.test(label)) continue;
      const values = cells.map(parseAmount).filter((value) => value !== null);
      if (values.length !== 1) continue;
      accounts.push({ label, amount: Math.abs(values[0]) });
    }
  }
  return accounts;
}

function checkDistributionSplitAgainstBooks(currentText, files) {
  const onK1 = k1CapitalAccounts(currentText)
    .map((account) => Math.abs(Number(account.withdrawals)))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  const onBooks = drawAccountsFromWorkpaper(files);
  if (onK1.length < 2 || onBooks.length < 2) return null;

  const sum = (list) => round2(list.reduce((total, value) => total + value, 0));
  const k1Total = sum(onK1);
  const bookTotal = sum(onBooks.map((account) => account.amount));
  // Unless the accounts add up to the distributions on the return, they are not the
  // distributions and there is nothing here to compare.
  if (differs(k1Total, bookTotal, 2)) return null;

  const unmatched = onBooks.filter((account) => !onK1.some((amount) => !differs(amount, account.amount)));
  if (unmatched.length !== onBooks.length) return null;

  return {
    severity: "MEDIUM",
    category: "K-1 allocation",
    title: "Distributions were split by ownership percentage, not by who received them",
    detail: `The K-1s report distributions of ${onK1.map(money).join(" and ")}, which add to ${money(k1Total)}. The books reach the same ${money(bookTotal)} through ${onBooks.map((a) => `"${a.label}" ${money(a.amount)}`).join(" and ")}, and not one of those figures appears on any K-1. The totals agreeing is what makes these the distributions; the split not agreeing is what makes them wrong.`,
    action: "Confirm from the draw detail who actually received each amount and reissue the K-1s to match. Distributions follow the cash, not the profit percentage, and item L capital accounts drive basis into every later year. If the accounts are not per-partner, get the breakdown before filing.",
    authority: "IRC §731; Reg. §1.704-1(b)(2)(iv) (capital account maintenance); Form 1065 Schedule K-1, item L and box 19",
  };
}

/* ---------------------------------------------------------------------------
 * Form 8825: a rental whose only expense is depreciation and which earned nothing.
 * ------------------------------------------------------------------------- */

function checkRentalWithOnlyDepreciation(currentText) {
  const depreciation = lineWithAmounts(currentText, /^\s*14\s+Depreciation \(see instructions\)/i);
  const expenses = lineWithAmounts(currentText, /Add lines 3 through 17/i, { minCount: 2 });
  const result = lineWithAmounts(currentText, /Subtract line 18 from line 2c/i, { minCount: 2 });
  if (!depreciation || !expenses || !result) return null;
  const columns = Math.min(depreciation.values.length, expenses.values.length, result.values.length);
  if (columns < 2) return null;

  const idle = [];
  for (let i = 0; i < columns; i += 1) {
    const dep = depreciation.values[i];
    if (!dep) continue;
    // Depreciation is the entire expense, and the result is exactly that loss: no rent, and
    // no insurance, tax or utility bill either — which is not what an operating rental looks like.
    if (differs(expenses.values[i], dep, 0.5)) continue;
    if (differs(result.values[i], -dep, 0.5)) continue;
    idle.push({ column: String.fromCharCode(65 + i), depreciation: dep });
  }
  if (!idle.length) return null;
  return {
    severity: "HIGH",
    category: "Rental activity",
    title: "A rental property produced no income and no expense other than depreciation",
    detail: `${idle.map((p) => `Property ${p.column} claims ${money(p.depreciation)} of depreciation`).join("; ")}, with no gross rents and no other expense of any kind for the year — no taxes, no insurance, no utilities. A property that was genuinely held out for rent normally costs something to hold.`,
    action: "Establish whether the property was available for rent for the year. If it was not placed in service or was withdrawn from rental use, the depreciation is not deductible here. If it was rented, the income and its share of the operating expenses are missing or have been posted entirely to another property.",
    authority: "IRC §167(a) and §212 (property held for the production of income); Form 8825 instructions",
  };
}

/* ------------------------------------------------------------------------- */

const ENTITY_TYPES = /^(1065|1120|1120-?S|1041)$/i;

function returnTextOf(file) {
  return String((file && (file.fullText || file.text)) || "");
}

/** The current and prior filed returns, by role first and by printed year as a fallback. */
function splitReturns(files, meta = {}) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && returnTextOf(f).trim().length > 500);
  const roleOf = (f) => String(f.reviewRole || f.role || "").toLowerCase();
  let current = list.find((f) => roleOf(f).includes("current_return")) || null;
  let prior = list.find((f) => roleOf(f).includes("prior_return")) || null;
  if (current && prior) return { current, prior };

  const filed = /U\.S\. Return of Partnership Income|Income Tax Return for an S Corporation|U\.S\. Corporation Income Tax Return|U\.S\. Income Tax Return for Estates and Trusts/i;
  const candidates = list
    .filter((f) => filed.test(returnTextOf(f)))
    .map((f) => {
      const counts = new Map();
      for (const m of returnTextOf(f).matchAll(/\b(20[12]\d)\b/g)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
      let best = null;
      for (const [year, n] of counts) if (!best || n > best.n) best = { year: Number(year), n };
      return { file: f, year: best && best.n >= 5 ? best.year : null };
    })
    .filter((c) => c.year !== null)
    .sort((a, b) => b.year - a.year);
  if (!candidates.length) return { current, prior };

  const stated = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
  const wanted = Number.isFinite(stated) && stated > 2000 ? stated : candidates[0].year;
  current = current || (candidates.find((c) => c.year === wanted) || candidates[0]).file;
  prior = prior || (candidates.find((c) => c.year === wanted - 1) || candidates.find((c) => c.file !== current) || {}).file || null;
  return { current, prior };
}

/**
 * Runs the entity-return checks. Returns [] for a 1040 — those belong to prior-year-bridge —
 * and for anything it cannot identify.
 */
function runEntityReturnChecks(files, meta = {}) {
  const returnType = String(meta.returnType || "").replace(/\s+/g, "");
  if (returnType && !ENTITY_TYPES.test(returnType)) return [];
  const { current, prior } = splitReturns(files, meta);
  if (!current) return [];
  const currentText = returnTextOf(current);
  // A 1040 reaching here without a declared type: leave it to the 1040 checks.
  if (!returnType && /U\.S\. Individual Income Tax Return/i.test(currentText)) return [];

  const taxYear = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
  const priorLabel = Number.isFinite(taxYear) && taxYear > 2000 ? String(taxYear - 1) : "prior-year";

  const findings = [
    checkCapitalRollforward(currentText),
    checkK1sFootToReturn(currentText),
    checkOwnerAllocationAgainstBooks(currentText, files),
    checkDistributionSplitAgainstBooks(currentText, files),
    checkRentalWithOnlyDepreciation(currentText),
    checkAccumulatedDepreciationRollforward(currentText),
  ];
  if (prior) findings.push(...checkBalanceSheetContinuity(currentText, returnTextOf(prior), priorLabel));

  const found = findings.filter(Boolean);
  found.identified = { current: current.name || "", prior: (prior && prior.name) || "" };
  return found;
}

module.exports = {
  runEntityReturnChecks,
  checkBalanceSheetContinuity,
  checkAccumulatedDepreciationRollforward,
  checkCapitalRollforward,
  checkK1sFootToReturn,
  checkOwnerAllocationAgainstBooks,
  checkDistributionSplitAgainstBooks,
  drawAccountsFromWorkpaper,
  checkRentalWithOnlyDepreciation,
  scheduleM2,
  k1CapitalAccounts,
  k1OwnerNames,
  ownerMovementsFromWorkpaper,
  accumulatedDepreciation,
  depreciationDeducted,
  amountsOn,
  parseAmount,
  // Compartidos con return-consistency-checks.js: identificar cual archivo es la declaracion
  // del año es justo lo que fallo tres veces en produccion, y no quiero dos versiones de eso.
  splitReturns,
  csvCells,
  returnTextOf,
  linesOf,
};
