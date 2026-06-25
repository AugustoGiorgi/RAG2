"use strict";

/**
 * Deterministic tax math for the Tax Planning Studio.
 *
 * IMPORTANT: every number the CPA presents to a client comes from this file,
 * never from the AI model. The AI only extracts facts and suggests which
 * scenarios to model; the dollars are computed here with code.
 *
 * All constants are grouped per-year at the top so they can be refreshed each
 * tax year without touching the calculation logic below. Where 2026 figures
 * were not yet finalized at authoring time they are marked ESTIMATE and should
 * be confirmed against the IRS revenue procedure for that year.
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
  // 2026 ESTIMATE: ~2.7% inflation adjustment over 2025. Confirm against the
  // final IRS revenue procedure before relying on these for filed returns.
  2026: {
    Single: [
      { upTo: 12250, rate: 0.10 },
      { upTo: 49775, rate: 0.12 },
      { upTo: 106150, rate: 0.22 },
      { upTo: 202650, rate: 0.24 },
      { upTo: 257300, rate: 0.32 },
      { upTo: 643250, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    MFJ: [
      { upTo: 24500, rate: 0.10 },
      { upTo: 99575, rate: 0.12 },
      { upTo: 212300, rate: 0.22 },
      { upTo: 405250, rate: 0.24 },
      { upTo: 514575, rate: 0.32 },
      { upTo: 772100, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    MFS: [
      { upTo: 12250, rate: 0.10 },
      { upTo: 49775, rate: 0.12 },
      { upTo: 106150, rate: 0.22 },
      { upTo: 202650, rate: 0.24 },
      { upTo: 257300, rate: 0.32 },
      { upTo: 386050, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    HOH: [
      { upTo: 17450, rate: 0.10 },
      { upTo: 66600, rate: 0.12 },
      { upTo: 106150, rate: 0.22 },
      { upTo: 202650, rate: 0.24 },
      { upTo: 257300, rate: 0.32 },
      { upTo: 643250, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
  },
};

const STANDARD_DEDUCTION = {
  2025: { Single: 15000, MFJ: 30000, MFS: 15000, HOH: 22500 },
  2026: { Single: 15400, MFJ: 30800, MFS: 15400, HOH: 23100 }, // ESTIMATE
};

// Long-term capital-gains breakpoints (taxable income thresholds).
const LTCG_BREAKPOINTS = {
  2025: {
    Single: { zeroUpTo: 48350, fifteenUpTo: 533400 },
    MFJ: { zeroUpTo: 96700, fifteenUpTo: 600050 },
    MFS: { zeroUpTo: 48350, fifteenUpTo: 300000 },
    HOH: { zeroUpTo: 64750, fifteenUpTo: 566700 },
  },
  2026: {
    Single: { zeroUpTo: 49650, fifteenUpTo: 547800 }, // ESTIMATE
    MFJ: { zeroUpTo: 99300, fifteenUpTo: 616250 }, // ESTIMATE
    MFS: { zeroUpTo: 49650, fifteenUpTo: 308100 }, // ESTIMATE
    HOH: { zeroUpTo: 66500, fifteenUpTo: 581900 }, // ESTIMATE
  },
};

// Self-employment / Social Security wage base (12.4% OASDI ceiling).
const SS_WAGE_BASE = { 2025: 176100, 2026: 181800 /* ESTIMATE */ };

// Net Investment Income Tax MAGI thresholds (not inflation indexed).
const NIIT_THRESHOLD = { Single: 200000, MFJ: 250000, MFS: 125000, HOH: 200000 };

// QBI taxable-income thresholds where the W-2 wage limitation phases in.
const QBI_THRESHOLD = {
  2025: { Single: 197300, MFJ: 394600, MFS: 197300, HOH: 197300 },
  2026: { Single: 202650, MFJ: 405250, MFS: 202650, HOH: 202650 }, // ESTIMATE
};

// Section 179 expensing limits (per the firm's spec; adjust yearly).
const SEC179 = {
  2025: { cap: 1160000, phaseoutStart: 2890000 },
  2026: { cap: 1160000, phaseoutStart: 2890000 }, // ESTIMATE — confirm yearly
};

// First-year bonus depreciation percentage (TCJA phase-down schedule).
const BONUS_DEPRECIATION_PCT = { 2025: 0.40, 2026: 0.20 };

// Retirement contribution limits.
const RETIREMENT_LIMITS = {
  2025: { sepMax: 70000, defined401kTotal: 70000, employee401k: 23500, catchUp50: 7500 },
  2026: { sepMax: 72000, defined401kTotal: 72000, employee401k: 24500, catchUp50: 8000 }, // ESTIMATE
};

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

function yearKey(year) {
  const y = Number(year) || 2025;
  return FEDERAL_BRACKETS[y] ? y : 2025;
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

function calcQBIDeduction(qualifiedBusinessIncome, taxableIncome, filingStatus, options = {}) {
  const qbi = nonNeg(qualifiedBusinessIncome);
  if (qbi <= 0) return { deduction: 0, limitedByTaxableIncome: false, wageLimitApplied: false };
  const status = normalizeStatus(filingStatus);
  const ti = nonNeg(taxableIncome);
  const netCapitalGains = nonNeg(options.netCapitalGains);
  const tentative = qbi * 0.20;
  const incomeLimit = Math.max(0, ti - netCapitalGains) * 0.20;
  let deduction = Math.min(tentative, incomeLimit);
  let wageLimitApplied = false;
  // Above the threshold the deduction is capped at 50% of W-2 wages (simplified;
  // ignores the 25% wages + 2.5% UBIA alternative).
  const threshold = QBI_THRESHOLD[yearKey(options.year)][status];
  if (ti > threshold && options.w2Wages != null) {
    const wageCap = nonNeg(options.w2Wages) * 0.50;
    if (wageCap < deduction) {
      deduction = wageCap;
      wageLimitApplied = true;
    }
  }
  return {
    deduction: round2(deduction),
    limitedByTaxableIncome: incomeLimit < tentative,
    wageLimitApplied,
  };
}

function calcCapitalGainsTax(gains, ordinaryTaxableIncome, filingStatus, year, options = {}) {
  // Short-term gains are taxed as ordinary income by the caller; this handles LTCG.
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

// ---------------------------------------------------------------------------
// Scenario composer: builds taxable income from a profile + adjustments and
// returns the full liability stack. `adjustments` is an array of
// { field, newValue } (and/or convenience deltas) produced by the AI scenario
// definitions; only known fields are honored.
// ---------------------------------------------------------------------------

function applyAdjustments(profile, adjustments) {
  const p = {
    wages: nonNeg(profile.wages),
    netSEIncome: nonNeg(profile.netSEIncome),
    otherIncome: nonNeg(profile.otherIncome),
    longTermGains: nonNeg(profile.longTermGains),
    shortTermGains: nonNeg(profile.shortTermGains),
    deductions: nonNeg(profile.deductions),
    qbi: nonNeg(profile.qbi),
    w2Wages: nonNeg(profile.w2Wages),
    retirementContribution: nonNeg(profile.retirementContribution),
    sec179: nonNeg(profile.sec179),
    bonusDepreciation: nonNeg(profile.bonusDepreciation),
    selfEmployedHealthInsurance: nonNeg(profile.selfEmployedHealthInsurance),
    hsaContribution: nonNeg(profile.hsaContribution),
  };
  for (const adj of Array.isArray(adjustments) ? adjustments : []) {
    if (!adj || !adj.field) continue;
    const field = String(adj.field);
    if (!(field in p)) continue;
    if (adj.newValue != null) p[field] = nonNeg(adj.newValue);
    else if (adj.delta != null) p[field] = nonNeg(p[field] + Number(adj.delta));
  }
  return p;
}

function computeScenarioTax(profile, adjustments, year) {
  const status = normalizeStatus(profile.filingStatus);
  const y = yearKey(year);
  const p = applyAdjustments(profile, adjustments);

  const se = calcSETax(p.netSEIncome, y);

  // Above-the-line deductions applied before the standard/itemized comparison.
  // SE health insurance cannot exceed net SE income; HSA is taken at face value.
  const seHealthIns = Math.min(p.selfEmployedHealthInsurance, nonNeg(p.netSEIncome));
  const hsa = p.hsaContribution;

  const ordinaryIncome =
    p.wages + p.netSEIncome + p.otherIncome + p.shortTermGains
    - se.deduction - p.retirementContribution - seHealthIns - hsa;

  const useStandard = p.deductions <= 0;
  const deductionAmount = useStandard ? STANDARD_DEDUCTION[y][status] : p.deductions;
  const businessDeductions = p.sec179 + p.bonusDepreciation;

  const preQbiTaxable = Math.max(0, ordinaryIncome - deductionAmount - businessDeductions);
  const qbi = calcQBIDeduction(p.qbi, preQbiTaxable, status, { netCapitalGains: p.longTermGains, w2Wages: p.w2Wages, year: y });
  const ordinaryTaxable = Math.max(0, preQbiTaxable - qbi.deduction);

  const fed = calcFederalTax(ordinaryTaxable, status, y);
  const ltcg = calcCapitalGainsTax(p.longTermGains, ordinaryTaxable, status, y, { longTerm: p.longTermGains });

  const magi = ordinaryTaxable + p.longTermGains;
  const niit = calcNIIT(p.longTermGains + p.shortTermGains, magi, status);

  const stateTaxableIncome = ordinaryTaxable + p.longTermGains;
  const state = calcStateTax(stateTaxableIncome, profile.state, status);

  const taxableIncome = round2(ordinaryTaxable + p.longTermGains);
  const federalTax = round2(fed.tax + ltcg.tax + niit.tax);
  const total = round2(federalTax + se.tax + state.tax);
  const grossIncome = p.wages + p.netSEIncome + p.otherIncome + p.longTermGains + p.shortTermGains;
  const effectiveRate = grossIncome > 0 ? round2((total / grossIncome) * 1000) / 1000 : 0;

  // Payments & safe harbor
  const withholding = nonNeg(profile.withholding);
  const estimatedTaxPaid = nonNeg(profile.estimatedTaxPaid);
  const paymentsCredits = round2(withholding + estimatedTaxPaid);
  const balanceDue = round2(total - paymentsCredits);

  const priorYearTax = nonNeg(profile.priorYearTax);
  const safeHarbor90 = round2(total * 0.90);
  // High-income rule: 110% of prior year if prior AGI > $150k (approximated by magi).
  const priorYearMultiplier = magi > 150000 ? 1.10 : 1.00;
  const safeHarborPrior = priorYearTax > 0 ? round2(priorYearTax * priorYearMultiplier) : null;
  // Safe harbor = the lower of the two methods (either satisfies the rule).
  const safeHarbor = safeHarborPrior != null ? Math.min(safeHarbor90, safeHarborPrior) : safeHarbor90;
  const q4Recommended = round2(Math.max(0, safeHarbor - paymentsCredits));

  return {
    taxableIncome,
    federalTax,
    stateTax: state.tax,
    seTax: se.tax,
    niit: niit.tax,
    longTermGainsTax: ltcg.tax,
    qbiDeduction: qbi.deduction,
    seHealthInsuranceDeduction: round2(seHealthIns),
    hsaDeduction: round2(hsa),
    total,
    effectiveRate,
    marginalRate: fed.marginalRate,
    stateEstimated: state.estimated,
    grossIncome: round2(grossIncome),
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
  normalizeStatus,
  calcFederalTax,
  calcSETax,
  calcQBIDeduction,
  calcCapitalGainsTax,
  calcNIIT,
  calcStateTax,
  calcSec179,
  calcBonusDepreciation,
  calcRetirementContribution,
  computeScenarioTax,
  applyAdjustments,
  // exported for tests / yearly review
  _constants: {
    FEDERAL_BRACKETS,
    STANDARD_DEDUCTION,
    LTCG_BREAKPOINTS,
    SS_WAGE_BASE,
    NIIT_THRESHOLD,
    SEC179,
    BONUS_DEPRECIATION_PCT,
    RETIREMENT_LIMITS,
    STATE_RATES,
  },
};
