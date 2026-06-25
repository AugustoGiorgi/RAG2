"use strict";

/**
 * Plain assert-based checks for lib/tax-calculations.js (no test runner needed).
 * Run: node scripts/test-tax-calculations.js
 */

const assert = require("node:assert");
const tax = require("../lib/tax-calculations");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
    process.exitCode = 1;
  }
}

function approx(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ""} expected ~${expected}, got ${actual}`);
}

// --- Federal brackets -------------------------------------------------------
check("federal Single $0 = $0", () => {
  assert.strictEqual(tax.calcFederalTax(0, "Single", 2025).tax, 0);
});

check("federal Single $50,000 (2025)", () => {
  // 10% to 11,925 = 1,192.50; 12% to 48,475 = 4,386.00; 22% on 1,525 = 335.50
  const r = tax.calcFederalTax(50000, "Single", 2025);
  approx(r.tax, 1192.5 + 4386 + 335.5, 1, "Single 50k");
  assert.strictEqual(r.marginalRate, 0.22);
});

check("federal MFJ $200,000 (2025)", () => {
  // 10%*23,850 + 12%*(96,950-23,850) + 22%*(200,000-96,950)
  const expected = 23850 * 0.10 + (96950 - 23850) * 0.12 + (200000 - 96950) * 0.22;
  approx(tax.calcFederalTax(200000, "MFJ", 2025).tax, expected, 1, "MFJ 200k");
});

check("federal top bracket marginal = 37%", () => {
  assert.strictEqual(tax.calcFederalTax(1000000, "Single", 2025).marginalRate, 0.37);
});

check("federal 2026 brackets exist and differ from 2025", () => {
  const a = tax.calcFederalTax(200000, "MFJ", 2025).tax;
  const b = tax.calcFederalTax(200000, "MFJ", 2026).tax;
  assert.ok(b < a, "2026 inflation-adjusted brackets should tax 200k slightly less");
});

// --- SE tax -----------------------------------------------------------------
check("SE tax on $100,000 net", () => {
  const r = tax.calcSETax(100000, 2025);
  const base = 100000 * 0.9235;
  approx(r.tax, base * 0.153, 1, "SE 100k");
  approx(r.deduction, (base * 0.153) / 2, 1, "SE deduction");
});

check("SE tax respects SS wage base", () => {
  const r = tax.calcSETax(500000, 2025);
  const base = 500000 * 0.9235;
  const expected = 176100 * 0.124 + base * 0.029;
  approx(r.tax, expected, 1, "SE high income capped OASDI");
});

// --- Capital gains ----------------------------------------------------------
check("LTCG 0% bracket for low income", () => {
  const r = tax.calcCapitalGainsTax(20000, 10000, "MFJ", 2025);
  assert.strictEqual(r.tax, 0);
});

check("LTCG 15% bracket", () => {
  // Ordinary 100k (MFJ), 50k LTCG -> all in 15% band
  const r = tax.calcCapitalGainsTax(50000, 100000, "MFJ", 2025);
  approx(r.tax, 50000 * 0.15, 1, "LTCG 15%");
});

// --- NIIT -------------------------------------------------------------------
check("NIIT 3.8% over threshold (MFJ)", () => {
  const r = tax.calcNIIT(50000, 300000, "MFJ");
  approx(r.tax, Math.min(50000, 300000 - 250000) * 0.038, 0.5, "NIIT");
});

check("NIIT zero below threshold", () => {
  assert.strictEqual(tax.calcNIIT(50000, 200000, "MFJ").tax, 0);
});

// --- State ------------------------------------------------------------------
check("FL state tax = 0, not estimated", () => {
  const r = tax.calcStateTax(200000, "FL", "MFJ");
  assert.strictEqual(r.tax, 0);
  assert.strictEqual(r.estimated, false);
});

check("unlisted state falls back to estimate flag", () => {
  const r = tax.calcStateTax(100000, "ZZ", "Single");
  assert.strictEqual(r.estimated, true);
});

// --- Section 179 ------------------------------------------------------------
check("Sec179 caps at limit", () => {
  const r = tax.calcSec179(2000000, 5000000, 2025);
  assert.strictEqual(r.deduction, 1160000);
});

check("Sec179 income-limited (no loss)", () => {
  const r = tax.calcSec179(80000, 50000, 2025);
  assert.strictEqual(r.deduction, 50000);
  assert.strictEqual(r.incomeLimited, true);
});

check("Sec179 phase-out over threshold", () => {
  // total assets 3,000,000 -> cap reduced by (3,000,000-2,890,000)=110,000
  const r = tax.calcSec179(1200000, 5000000, 2025, 3000000);
  assert.strictEqual(r.cap, 1160000 - 110000);
});

// --- Bonus depreciation -----------------------------------------------------
check("bonus depreciation 2025 = 40%", () => {
  assert.strictEqual(tax.calcBonusDepreciation(100000, 2025).deduction, 40000);
});

check("bonus depreciation 2026 = 20%", () => {
  assert.strictEqual(tax.calcBonusDepreciation(100000, 2026).deduction, 20000);
});

// --- Retirement -------------------------------------------------------------
check("SEP-IRA capped at max", () => {
  const r = tax.calcRetirementContribution("SEP-IRA", 1000000, 0, 45, 2025);
  assert.strictEqual(r.contribution, 70000);
});

check("Defined benefit returns a range", () => {
  const r = tax.calcRetirementContribution("Defined Benefit", 400000, 0, 55, 2025);
  assert.ok(r.isRange && r.contributionRange.max > r.contributionRange.min);
});

// --- Scenario composer ------------------------------------------------------
check("computeScenarioTax base case returns full stack", () => {
  const profile = { filingStatus: "MFJ", state: "FL", wages: 0, netSEIncome: 200000 };
  const r = tax.computeScenarioTax(profile, [], 2025);
  assert.ok(r.total > 0 && r.federalTax > 0 && r.seTax > 0);
  assert.strictEqual(r.stateTax, 0); // FL
  assert.ok(r.effectiveRate > 0 && r.effectiveRate < 1);
});

check("computeScenarioTax: Sec179 adjustment lowers tax", () => {
  const profile = { filingStatus: "MFJ", state: "FL", netSEIncome: 300000 };
  const base = tax.computeScenarioTax(profile, [], 2025);
  const withSec179 = tax.computeScenarioTax(profile, [{ field: "sec179", newValue: 80000 }], 2025);
  assert.ok(withSec179.total < base.total, "Sec 179 should reduce total tax");
});

check("computeScenarioTax: retirement contribution lowers taxable income", () => {
  const profile = { filingStatus: "Single", state: "CA", netSEIncome: 200000 };
  const base = tax.computeScenarioTax(profile, [], 2025);
  const withSep = tax.computeScenarioTax(profile, [{ field: "retirementContribution", newValue: 50000 }], 2025);
  assert.ok(withSep.taxableIncome < base.taxableIncome);
});

console.log(`\n${passed} checks passed.`);
if (process.exitCode === 1) {
  console.error("\nSome checks FAILED.");
} else {
  console.log("All checks passed.");
}
