"use strict";

/**
 * Deterministic tax math for the Tax Planning Studio.
 *
 * IMPORTANT: every number the CPA presents to a client comes from this file,
 * never from the AI model. The AI only extracts facts; which strategies apply
 * and with what amounts is decided in lib/planning-strategies.js, and the
 * dollars are computed here with code.
 *
 * All constants are grouped per-year at the top so they can be refreshed each
 * tax year without touching the calculation logic below.
 *
 * Sources, checked October 2026:
 *  - 2025: Rev. Proc. 2024-40 as amended by the One Big Beautiful Bill Act
 *    (July 2025; restated in Rev. Proc. 2025-32 section 3): standard deduction
 *    $31,500 MFJ, §179 $2,500,000 / $4,000,000, 100% bonus depreciation.
 *  - 2026: Rev. Proc. 2025-32 (brackets, standard deduction, capital-gain
 *    breakpoints, §179, §199A thresholds and phase-in ranges), Notice 2025-67
 *    (retirement limits), Rev. Proc. 2025-19 (HSA), SSA (wage base $184,500).
 *  - 2027: only the HSA limits are published (Rev. Proc. 2026-24). Every other
 *    2027 figure falls back to the latest table, and results say so through
 *    `tablesEstimated` so the UI can flag it.
 *
 * Income model. S corporation K-1 income (`sCorpIncome`) never pays
 * self-employment tax; the owners pay FICA on the salary their S corporation
 * pays them (`ownerWages`, part of `wages`), both halves. Self-employment tax
 * applies only to Schedule C and partnership earnings (`netSEIncome`).
 */

const FILING_STATUSES = ["Single", "MFJ", "MFS", "HOH"];

function normalizeStatus(filingStatus) {
  const s = String(filingStatus || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (s === "mfj" || s === "marriedfilingjointly" || s === "married") return "MFJ";
  if (s === "mfs" || s === "marriedfilingseparately") return "MFS";
  if (s === "hoh" || s === "headofhousehold" || s === "head") return "HOH";
  return "Single";
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function nonNeg(n) {
  const v = Number(n) || 0;
  return v > 0 ? v : 0;
}

// ---------------------------------------------------------------------------
// Federal ordinary-income brackets (taxable income -> tax).
// Each bracket: { upTo: Infinity-or-number, rate }
// ---------------------------------------------------------------------------
const FEDERAL_BRACKETS = {
  2025: {
    Single: [
      { upTo: 11925, rate: 0.10 },
      { upTo: 48475, rate: 0.12 },
      { upTo: 103350, rate: 0.22 },
      { upTo: 197300, rate: 0.24 },
      { upTo: 250525, rate: 0.32 },
      { upTo: 626350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    MFJ: [
      { upTo: 23850, rate: 0.10 },
      { upTo: 96950, rate: 0.12 },
      { upTo: 206700, rate: 0.22 },
      { upTo: 394600, rate: 0.24 },
      { upTo: 501050, rate: 0.32 },
      { upTo: 751600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    MFS: [
      { upTo: 11925, rate: 0.10 },
      { upTo: 48475, rate: 0.12 },
      { upTo: 103350, rate: 0.22 },
      { upTo: 197300, rate: 0.24 },
      { upTo: 250525, rate: 0.32 },
      { upTo: 375800, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    HOH: [
      { upTo: 17000, rate: 0.10 },
      { upTo: 64850, rate: 0.12 },
      { upTo: 103350, rate: 0.22 },
      { upTo: 197300, rate: 0.24 },
      { upTo: 250500, rate: 0.32 },
      { upTo: 626350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
  },
  // Rev. Proc. 2025-32, section 4.01.
  2026: {
    Single: [
      { upTo: 12400, rate: 0.10 },
      { upTo: 50400, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201775, rate: 0.24 },
      { upTo: 256225, rate: 0.32 },
      { upTo: 640600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    MFJ: [
      { upTo: 24800, rate: 0.10 },
      { upTo: 100800, rate: 0.12 },
      { upTo: 211400, rate: 0.22 },
      { upTo: 403550, rate: 0.24 },
      { upTo: 512450, rate: 0.32 },
      { upTo: 768700, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    MFS: [
      { upTo: 12400, rate: 0.10 },
      { upTo: 50400, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201775, rate: 0.24 },
      { upTo: 256225, rate: 0.32 },
      { upTo: 384350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    HOH: [
      { upTo: 17700, rate: 0.10 },
      { upTo: 67450, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201750, rate: 0.24 },
      { upTo: 256200, rate: 0.32 },
      { upTo: 640600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
  },
};

const STANDARD_DEDUCTION = {
  2025: { Single: 15750, MFJ: 31500, MFS: 15750, HOH: 23625 }, // OBBBA
  2026: { Single: 16100, MFJ: 32200, MFS: 16100, HOH: 24150 },
};

// Long-term capital-gains breakpoints (taxable income thresholds). Qualified
// dividends use the same breakpoints.
const LTCG_BREAKPOINTS = {
  2025: {
    Single: { zeroUpTo: 48350, fifteenUpTo: 533400 },
    MFJ: { zeroUpTo: 96700, fifteenUpTo: 600050 },
    MFS: { zeroUpTo: 48350, fifteenUpTo: 300000 },
    HOH: { zeroUpTo: 64750, fifteenUpTo: 566700 },
  },
  2026: {
    Single: { zeroUpTo: 49450, fifteenUpTo: 545500 },
    MFJ: { zeroUpTo: 98900, fifteenUpTo: 613700 },
    MFS: { zeroUpTo: 49450, fifteenUpTo: 306850 },
    HOH: { zeroUpTo: 66200, fifteenUpTo: 579600 },
  },
};

// Social Security wage base (12.4% OASDI ceiling, per person).
const SS_WAGE_BASE = { 2025: 176100, 2026: 184500 };

// FICA rates, each half (employee and employer).
const FICA_SS_RATE = 0.062;
const FICA_MEDICARE_RATE = 0.0145;

// Net Investment Income Tax MAGI thresholds (not inflation indexed).
const NIIT_THRESHOLD = { Single: 200000, MFJ: 250000, MFS: 125000, HOH: 200000 };

// QBI taxable-income thresholds where the W-2 wage limitation starts phasing in,
// and the width of the phase-in range (widened by the OBBBA from 2026 on).
const QBI_THRESHOLD = {
  2025: { Single: 197300, MFJ: 394600, MFS: 197300, HOH: 197300 },
  2026: { Single: 201750, MFJ: 403500, MFS: 201775, HOH: 201750 },
};
const QBI_PHASE_IN_RANGE = {
  2025: { Single: 50000, MFJ: 100000, MFS: 50000, HOH: 50000 },
  2026: { Single: 75000, MFJ: 150000, MFS: 75000, HOH: 75000 },
};

// Section 179 expensing limits.
const SEC179 = {
  2025: { cap: 2500000, phaseoutStart: 4000000 },
  2026: { cap: 2560000, phaseoutStart: 4090000 },
};

// First-year bonus depreciation: 100%, permanent, for property acquired after
// January 19, 2025 (OBBBA). Planning models new purchases, so 100% applies.
const BONUS_DEPRECIATION_PCT = { 2025: 1.0, 2026: 1.0 };

// Retirement contribution limits.
const RETIREMENT_LIMITS = {
  2025: { sepMax: 70000, defined401kTotal: 70000, employee401k: 23500, catchUp50: 7500, catchUp60to63: 11250, ira: 7000, iraCatchUp50: 1000 },
  2026: { sepMax: 72000, defined401kTotal: 72000, employee401k: 24500, catchUp50: 8000, catchUp60to63: 11250, ira: 7500, iraCatchUp50: 1100 },
};

// Traditional IRA deduction phase-out when the contributor is covered by a
// workplace retirement plan, and when only the spouse is covered.
const IRA_DEDUCTION_PHASEOUT = {
  2025: { covered: { Single: [79000, 89000], HOH: [79000, 89000], MFJ: [126000, 146000], MFS: [0, 10000] }, spouseCovered: [236000, 246000] },
  2026: { covered: { Single: [81000, 91000], HOH: [81000, 91000], MFJ: [129000, 149000], MFS: [0, 10000] }, spouseCovered: [242000, 252000] },
};

// HSA contribution limits (HSA years are published earlier than the rest).
const HSA_LIMITS = {
  2025: { self: 4300, family: 8550 },
  2026: { self: 4400, family: 8750 },
  2027: { self: 4500, family: 9000 },
};
const HSA_CATCH_UP_55 = 1000;

// Simplified state tax model. Explicit states use a flat effective rate;
// states not listed fall back to a national-average estimate and are flagged.
const STATE_RATES = {
  FL: { rate: 0, estimated: false },
  TX: { rate: 0, estimated: false },
  WA: { rate: 0, estimated: false },
  NV: { rate: 0, estimated: false },
  SD: { rate: 0, estimated: false },
  WY: { rate: 0, estimated: false },
  AK: { rate: 0, estimated: false },
  TN: { rate: 0, estimated: false },
  NH: { rate: 0, estimated: false },
  NY: { rate: 0.0685, estimated: true },
  CA: { rate: 0.093, estimated: true },
  NJ: { rate: 0.0637, estimated: true },
  IL: { rate: 0.0495, estimated: false },
  PA: { rate: 0.0307, estimated: false },
  OH: { rate: 0.035, estimated: true },
  GA: { rate: 0.0539, estimated: true },
  NC: { rate: 0.0425, estimated: false },
};
const STATE_AVERAGE_RATE = 0.05; // fallback for unlisted states

const TABLE_YEARS = Object.keys(FEDERAL_BRACKETS).map(Number).sort((a, b) => a - b);

/**
 * Which year's tables apply. A year without its own tables uses the closest one
 * — the latest for a future year — and is flagged as estimated. (It used to fall
 * back to 2025, so a 2027 plan ran on pre-OBBBA 2025 figures without saying so.)
 */
function tableYear(year) {
  const requested = Number(year) || TABLE_YEARS[0];
  if (FEDERAL_BRACKETS[requested]) return { key: requested, requested, estimated: false };
  const latest = TABLE_YEARS[TABLE_YEARS.length - 1];
  return { key: requested > latest ? latest : TABLE_YEARS[0], requested, estimated: true };
}

function yearKey(year) {
  return tableYear(year).key;
}

function hsaLimitsFor(year) {
  const y = Number(year) || TABLE_YEARS[0];
  if (HSA_LIMITS[y]) return { ...HSA_LIMITS[y], catchUp55: HSA_CATCH_UP_55, estimated: false };
  const years = Object.keys(HSA_LIMITS).map(Number).sort((a, b) => a - b);
  const key = y > years[years.length - 1] ? years[years.length - 1] : years[0];
  return { ...HSA_LIMITS[key], catchUp55: HSA_CATCH_UP_55, estimated: true };
}

/** Every limit the strategy rules need for a year, from the same tables. */
function limitsFor(year) {
  const t = tableYear(year);
  return {
    tablesYear: t.key,
    tablesEstimated: t.estimated,
    retirement: RETIREMENT_LIMITS[t.key],
    iraPhaseout: IRA_DEDUCTION_PHASEOUT[t.key],
    hsa: hsaLimitsFor(year),
    ssWageBase: SS_WAGE_BASE[t.key],
    bonusPct: BONUS_DEPRECIATION_PCT[t.key],
    sec179: SEC179[t.key],
    standardDeduction: STANDARD_DEDUCTION[t.key],
  };
}

// ---------------------------------------------------------------------------
// Core calculators
// ---------------------------------------------------------------------------

function calcFederalTax(taxableIncome, filingStatus, year) {
  const ti = nonNeg(taxableIncome);
  const status = normalizeStatus(filingStatus);
  const brackets = FEDERAL_BRACKETS[yearKey(year)][status];
  let tax = 0;
  let lower = 0;
  let marginalRate = brackets[0].rate;
  for (const b of brackets) {
    if (ti > lower) {
      const slice = Math.min(ti, b.upTo) - lower;
      tax += slice * b.rate;
      marginalRate = b.rate;
    }
    lower = b.upTo;
    if (ti <= b.upTo) break;
  }
  return { tax: round2(tax), marginalRate, effectiveRate: ti > 0 ? round2((tax / ti) * 100) / 100 : 0 };
}

function calcSETax(netSelfEmploymentIncome, year) {
  const net = nonNeg(netSelfEmploymentIncome);
  const base = net * 0.9235;
  if (base <= 0) return { tax: 0, deduction: 0, taxableBase: 0 };
  const wageBase = SS_WAGE_BASE[yearKey(year)];
  const oasdi = Math.min(base, wageBase) * 0.124;
  const medicare = base * 0.029;
  const tax = oasdi + medicare;
  return { tax: round2(tax), deduction: round2(tax * 0.5), taxableBase: round2(base) };
}

/**
 * FICA on the salary an S corporation pays its owners, both halves: the owners
 * bear the employer half too, as a deduction of their own company. The Social
 * Security part is capped per person, so the salary is split across the owners
 * on the payroll (1 or 2). Additional Medicare tax (0.9%) is not modeled.
 */
function calcOwnerPayrollTax(ownerWages, ownerCount, year) {
  const wages = nonNeg(ownerWages);
  if (wages <= 0) return { tax: 0, employer: 0, employee: 0 };
  const count = Math.min(2, Math.max(1, Math.round(Number(ownerCount) || 1)));
  const perOwner = wages / count;
  const ss = Math.min(perOwner, SS_WAGE_BASE[yearKey(year)]) * count * FICA_SS_RATE;
  const half = ss + wages * FICA_MEDICARE_RATE;
  return { tax: round2(half * 2), employer: round2(half), employee: round2(half) };
}

function calcQBIDeduction(qualifiedBusinessIncome, taxableIncome, filingStatus, options = {}) {
  const qbi = nonNeg(qualifiedBusinessIncome);
  if (qbi <= 0) return { deduction: 0, limitedByTaxableIncome: false, wageLimitApplied: false };
  const status = normalizeStatus(filingStatus);
  const ti = nonNeg(taxableIncome);
  const netCapitalGains = nonNeg(options.netCapitalGains);
  const tentative = qbi * 0.20;
  const incomeLimit = Math.max(0, ti - netCapitalGains) * 0.20;
  let allowed = tentative;
  let wageLimitApplied = false;
  // Above the threshold the deduction moves toward 50% of W-2 wages, fully so at
  // the end of the phase-in range (simplified: ignores the 25% wages + 2.5% UBIA
  // alternative and SSTB rules).
  const key = yearKey(options.year);
  const threshold = QBI_THRESHOLD[key][status];
  if (ti > threshold && options.w2Wages != null) {
    const wageCap = nonNeg(options.w2Wages) * 0.50;
    if (wageCap < tentative) {
      const fraction = Math.min(1, (ti - threshold) / QBI_PHASE_IN_RANGE[key][status]);
      allowed = tentative - (tentative - wageCap) * fraction;
      wageLimitApplied = true;
    }
  }
  const deduction = Math.min(allowed, incomeLimit);
  return {
    deduction: round2(deduction),
    limitedByTaxableIncome: incomeLimit < allowed,
    wageLimitApplied,
  };
}

function calcCapitalGainsTax(gains, ordinaryTaxableIncome, filingStatus, year, options = {}) {
  // Short-term gains are taxed as ordinary income by the caller; this handles
  // long-term gains and qualified dividends.
  const ltcg = nonNeg(options.longTerm != null ? options.longTerm : gains);
  if (ltcg <= 0) return { tax: 0, breakdown: { at0: 0, at15: 0, at20: 0 } };
  const status = normalizeStatus(filingStatus);
  const bp = LTCG_BREAKPOINTS[yearKey(year)][status];
  const ordinary = nonNeg(ordinaryTaxableIncome);
  let remaining = ltcg;
  let tax = 0;
  const breakdown = { at0: 0, at15: 0, at20: 0 };

  const zeroRoom = Math.max(0, bp.zeroUpTo - ordinary);
  const at0 = Math.min(remaining, zeroRoom);
  breakdown.at0 = round2(at0);
  remaining -= at0;

  if (remaining > 0) {
    const fifteenCeiling = Math.max(0, bp.fifteenUpTo - Math.max(ordinary, bp.zeroUpTo));
    const at15 = Math.min(remaining, fifteenCeiling);
    breakdown.at15 = round2(at15);
    tax += at15 * 0.15;
    remaining -= at15;
  }
  if (remaining > 0) {
    breakdown.at20 = round2(remaining);
    tax += remaining * 0.20;
  }
  return { tax: round2(tax), breakdown };
}

function calcNIIT(netInvestmentIncome, magi, filingStatus) {
  const nii = nonNeg(netInvestmentIncome);
  const status = normalizeStatus(filingStatus);
  const threshold = NIIT_THRESHOLD[status];
  const excess = Math.max(0, (Number(magi) || 0) - threshold);
  const taxable = Math.min(nii, excess);
  return { tax: round2(taxable * 0.038), taxableBase: round2(taxable) };
}

function calcStateTax(taxableIncome, state, filingStatus) {
  const ti = nonNeg(taxableIncome);
  const code = String(state || "").trim().toUpperCase();
  const entry = STATE_RATES[code];
  if (entry) {
    return { tax: round2(ti * entry.rate), rate: entry.rate, estimated: entry.estimated, state: code };
  }
  return { tax: round2(ti * STATE_AVERAGE_RATE), rate: STATE_AVERAGE_RATE, estimated: true, state: code || "N/A" };
}

function calcSec179(assetCost, entityIncome, year) {
  const cost = nonNeg(assetCost);
  const limits = SEC179[yearKey(year)];
  let cap = limits.cap;
  // Dollar-for-dollar phase-out once total asset additions exceed the threshold.
  const totalAssets = nonNeg(arguments.length > 3 ? arguments[3] : assetCost);
  if (totalAssets > limits.phaseoutStart) {
    cap = Math.max(0, cap - (totalAssets - limits.phaseoutStart));
  }
  // Cannot create a loss: limited to business taxable income.
  const incomeLimit = nonNeg(entityIncome);
  const deduction = Math.min(cost, cap, incomeLimit > 0 ? incomeLimit : cost);
  return {
    deduction: round2(deduction),
    cap,
    incomeLimited: incomeLimit > 0 && incomeLimit < Math.min(cost, cap),
  };
}

function calcBonusDepreciation(assetCost, year) {
  const cost = nonNeg(assetCost);
  const pct = BONUS_DEPRECIATION_PCT[yearKey(year)] || 0;
  return { deduction: round2(cost * pct), percentage: pct };
}

function calcRetirementContribution(type, netSEIncome, wages, age, year) {
  const limits = RETIREMENT_LIMITS[yearKey(year)];
  const net = nonNeg(netSEIncome);
  const w2 = nonNeg(wages);
  const catchUp = Number(age) >= 50 ? limits.catchUp50 : 0;
  const kind = String(type || "").trim().toLowerCase();

  if (kind.includes("sep")) {
    // SEP-IRA: 25% of W-2 comp, or 20% of net SE income, capped.
    const fromWages = w2 * 0.25;
    const fromSE = net * 0.20;
    const contribution = Math.min(limits.sepMax, Math.max(fromWages, fromSE));
    return { type: "SEP-IRA", contribution: round2(contribution), max: limits.sepMax, isRange: false };
  }
  if (kind.includes("401")) {
    // Solo 401(k): employee deferral + employer (25% comp), total capped.
    const employee = Math.min(limits.employee401k + catchUp, w2 + net);
    const employer = (w2 > 0 ? w2 : net) * 0.25;
    const total = Math.min(limits.defined401kTotal + catchUp, employee + employer);
    return { type: "Solo 401(k)", contribution: round2(total), employee: round2(employee), max: limits.defined401kTotal + catchUp, isRange: false };
  }
  if (kind.includes("defined") || kind.includes("db") || kind.includes("benefit")) {
    // Defined benefit: actuarial — present a range rather than a false-precise number.
    const low = Math.min(net * 0.5, 120000);
    const high = Math.min(net * 0.9, 280000);
    return { type: "Defined Benefit", contributionRange: { min: round2(low), max: round2(high) }, isRange: true };
  }
  return { type: kind || "unknown", contribution: 0, isRange: false };
}

/**
 * The part of a traditional IRA deduction that survives once the contributor
 * (or only the spouse) is covered by a workplace plan. Linear phase-out between
 * the two MAGI ends of the range.
 */
function iraDeductionAllowed(deduction, magi, filingStatus, year, { spouseOnly = false } = {}) {
  const amount = nonNeg(deduction);
  if (amount <= 0) return 0;
  const status = normalizeStatus(filingStatus);
  const table = IRA_DEDUCTION_PHASEOUT[yearKey(year)];
  const [start, end] = spouseOnly ? table.spouseCovered : table.covered[status];
  const m = Number(magi) || 0;
  if (m <= start) return round2(amount);
  if (m >= end) return 0;
  return round2(amount * (end - m) / (end - start));
}

// ---------------------------------------------------------------------------
// Scenario composer: builds taxable income from a profile + adjustments and
// returns the full liability stack. `adjustments` is an array of
// { field, newValue } (and/or convenience deltas) produced by the strategy
// rules or a CPA edit; only known fields are honored.
// ---------------------------------------------------------------------------

const PROFILE_FIELDS = [
  "wages", "ownerWages", "sCorpIncome", "netSEIncome", "otherIncome", "qualifiedDividends",
  "longTermGains", "shortTermGains", "deductions", "qbi", "w2Wages", "retirementContribution",
  "iraDeduction", "sec179", "bonusDepreciation", "selfEmployedHealthInsurance", "hsaContribution",
  "businessCredits",
];

function ownerCountOf(profile) {
  return Math.min(2, Math.max(1, Math.round(Number(profile && profile.ownerCount) || 1)));
}

/**
 * Applies the adjustments to the profile. Returns the adjusted numbers plus the
 * set of fields the adjustments named explicitly.
 *
 * Changing `ownerWages` moves that salary out of (or back into) the S
 * corporation: unless the same scenario sets them itself, `wages` and the
 * business's `w2Wages` follow the change, and `sCorpIncome` drops by the salary
 * plus the employer half of FICA the corporation now pays.
 */
function applyAdjustments(profile, adjustments, year) {
  const p = {};
  for (const field of PROFILE_FIELDS) p[field] = nonNeg(profile && profile[field]);
  const explicit = new Set();
  for (const adj of Array.isArray(adjustments) ? adjustments : []) {
    if (!adj || !adj.field) continue;
    const field = String(adj.field);
    if (!(field in p)) continue;
    if (adj.newValue != null) p[field] = nonNeg(adj.newValue);
    else if (adj.delta != null) p[field] = nonNeg(p[field] + Number(adj.delta));
    else continue;
    explicit.add(field);
  }
  if (explicit.has("ownerWages")) {
    const before = nonNeg(profile && profile.ownerWages);
    const delta = p.ownerWages - before;
    if (delta !== 0) {
      const count = ownerCountOf(profile);
      const employerDelta = calcOwnerPayrollTax(p.ownerWages, count, year).employer
        - calcOwnerPayrollTax(before, count, year).employer;
      if (!explicit.has("wages")) p.wages = nonNeg(p.wages + delta);
      if (!explicit.has("sCorpIncome")) p.sCorpIncome = nonNeg(p.sCorpIncome - delta - employerDelta);
      if (!explicit.has("w2Wages") && p.w2Wages > 0) p.w2Wages = nonNeg(p.w2Wages + delta);
    }
  }
  Object.defineProperty(p, "explicit", { value: explicit, enumerable: false });
  return p;
}

/**
 * QBI of the scenario. Without an explicit `qbi`, the profile's QBI moves with
 * the business income: S-corp and SE income changes, and new §179 / bonus
 * depreciation, which reduce the business's income.
 */
function scenarioQbi(profile, base, p) {
  if (p.explicit && p.explicit.has("qbi")) return p.qbi;
  const baseQbi = base.qbi > 0 ? base.qbi : base.sCorpIncome + base.netSEIncome;
  const delta = (p.sCorpIncome - base.sCorpIncome) + (p.netSEIncome - base.netSEIncome)
    - ((p.sec179 + p.bonusDepreciation) - (base.sec179 + base.bonusDepreciation));
  return Math.max(0, baseQbi + delta);
}

function computeScenarioTax(profile, adjustments, year) {
  const status = normalizeStatus(profile.filingStatus);
  const tables = tableYear(year);
  const y = tables.key;
  const base = applyAdjustments(profile, [], year);
  const p = applyAdjustments(profile, adjustments, year);

  // New equipment reduces the business's income. For an S corporation that is
  // the K-1 (through `businessDeductions` below); for a sole proprietor or
  // partner it is also self-employment income.
  const businessDeductions = p.sec179 + p.bonusDepreciation;
  const assetsReduceSE = !(base.sCorpIncome > 0) && base.netSEIncome > 0;
  const seIncome = Math.max(0, p.netSEIncome - (assetsReduceSE ? businessDeductions : 0));
  const se = calcSETax(seIncome, y);
  const payroll = calcOwnerPayrollTax(p.ownerWages, ownerCountOf(profile), y);

  // Above-the-line deductions. SE health insurance cannot exceed the earned
  // income from the business (net SE income, or an S-corp owner's salary); HSA
  // is taken at face value.
  const seHealthIns = Math.min(p.selfEmployedHealthInsurance, nonNeg(p.netSEIncome) + nonNeg(p.ownerWages));
  const hsa = p.hsaContribution;

  const ordinaryIncome =
    p.wages + p.netSEIncome + p.sCorpIncome + p.otherIncome + p.shortTermGains
    - businessDeductions - se.deduction - p.retirementContribution - p.iraDeduction - seHealthIns - hsa;
  const preferential = p.longTermGains + p.qualifiedDividends;
  const agi = ordinaryIncome + preferential;

  const useStandard = p.deductions <= 0;
  const deductionAmount = useStandard ? STANDARD_DEDUCTION[y][status] : p.deductions;
  // The deduction comes off ordinary income first; what is left reduces the
  // gains and qualified dividends.
  const afterDeduction = ordinaryIncome - deductionAmount;
  const preQbiOrdinary = Math.max(0, afterDeduction);
  const preferentialTaxable = afterDeduction >= 0 ? preferential : Math.max(0, preferential + afterDeduction);

  const qbiIncome = scenarioQbi(profile, base, p);
  const qbi = calcQBIDeduction(qbiIncome, preQbiOrdinary + preferentialTaxable, status, {
    netCapitalGains: preferentialTaxable, w2Wages: p.w2Wages, year: y,
  });
  const ordinaryTaxable = Math.max(0, preQbiOrdinary - qbi.deduction);

  const fed = calcFederalTax(ordinaryTaxable, status, y);
  const ltcg = calcCapitalGainsTax(preferentialTaxable, ordinaryTaxable, status, y, { longTerm: preferentialTaxable });
  // Nonrefundable general business credits (e.g. the FICA tip credit), limited
  // to the regular income tax.
  const creditsUsed = Math.min(p.businessCredits, fed.tax + ltcg.tax);

  const niit = calcNIIT(p.longTermGains + p.shortTermGains + p.qualifiedDividends, agi, status);

  // Most states start from federal AGI and do not allow the §199A deduction,
  // so the state estimate uses taxable income before it.
  const state = calcStateTax(preQbiOrdinary + preferentialTaxable, profile.state, status);

  const taxableIncome = round2(ordinaryTaxable + preferentialTaxable);
  const federalTax = round2(fed.tax + ltcg.tax - creditsUsed + niit.tax);
  const total = round2(federalTax + se.tax + payroll.tax + state.tax);
  const grossIncome = p.wages + p.netSEIncome + p.sCorpIncome + p.otherIncome + p.qualifiedDividends
    + p.longTermGains + p.shortTermGains;
  const effectiveRate = grossIncome > 0 ? round2((total / grossIncome) * 1000) / 1000 : 0;

  // Payments & safe harbor
  const withholding = nonNeg(profile.withholding);
  const estimatedTaxPaid = nonNeg(profile.estimatedTaxPaid);
  const paymentsCredits = round2(withholding + estimatedTaxPaid);
  const balanceDue = round2(total - paymentsCredits);

  const priorYearTax = nonNeg(profile.priorYearTax);
  const safeHarbor90 = round2(total * 0.90);
  // High-income rule: 110% of prior year if prior AGI > $150k (approximated by this AGI).
  const priorYearMultiplier = agi > 150000 ? 1.10 : 1.00;
  const safeHarborPrior = priorYearTax > 0 ? round2(priorYearTax * priorYearMultiplier) : null;
  // Safe harbor = the lower of the two methods (either satisfies the rule).
  const safeHarbor = safeHarborPrior != null ? Math.min(safeHarbor90, safeHarborPrior) : safeHarbor90;
  const q4Recommended = round2(Math.max(0, safeHarbor - paymentsCredits));

  return {
    taxableIncome,
    federalTax,
    stateTax: state.tax,
    seTax: se.tax,
    payrollTax: payroll.tax,
    niit: niit.tax,
    longTermGainsTax: ltcg.tax,
    businessCredits: round2(creditsUsed),
    qbiDeduction: qbi.deduction,
    qbiIncome: round2(qbiIncome),
    seHealthInsuranceDeduction: round2(seHealthIns),
    hsaDeduction: round2(hsa),
    iraDeduction: round2(p.iraDeduction),
    agi: round2(agi),
    total,
    effectiveRate,
    marginalRate: fed.marginalRate,
    stateEstimated: state.estimated,
    grossIncome: round2(grossIncome),
    tablesYear: tables.key,
    tablesEstimated: tables.estimated,
    // Payments & balance
    withholding,
    estimatedTaxPaid,
    paymentsCredits,
    balanceDue,
    priorYearTax,
    safeHarbor,
    safeHarborPrior,
    q4Recommended,
    highIncomeRule: priorYearMultiplier > 1,
  };
}

module.exports = {
  FILING_STATUSES,
  PROFILE_FIELDS,
  normalizeStatus,
  tableYear,
  limitsFor,
  calcFederalTax,
  calcSETax,
  calcOwnerPayrollTax,
  calcQBIDeduction,
  calcCapitalGainsTax,
  calcNIIT,
  calcStateTax,
  calcSec179,
  calcBonusDepreciation,
  calcRetirementContribution,
  iraDeductionAllowed,
  computeScenarioTax,
  applyAdjustments,
  // exported for tests / yearly review
  _constants: {
    FEDERAL_BRACKETS,
    STANDARD_DEDUCTION,
    LTCG_BREAKPOINTS,
    SS_WAGE_BASE,
    NIIT_THRESHOLD,
    QBI_THRESHOLD,
    QBI_PHASE_IN_RANGE,
    SEC179,
    BONUS_DEPRECIATION_PCT,
    RETIREMENT_LIMITS,
    IRA_DEDUCTION_PHASEOUT,
    HSA_LIMITS,
    STATE_RATES,
  },
};
