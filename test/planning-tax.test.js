"use strict";
// El motor de impuestos de Tax Planning. Fija lo que se arreglo en octubre de 2026:
// - la ganancia de una S-corp no paga self-employment tax (antes se lo cobraba como a un
//   autonomo);
// - el sueldo de los dueños paga FICA, las dos mitades, y subirlo sale del K-1;
// - la IRA, los creditos y los dividendos calificados entran en la base;
// - las tablas son las oficiales (ley de julio de 2025 y Rev. Proc. 2025-32), y un año sin tablas
//   usa las mas nuevas y lo avisa;
// - el estado no descuenta la deduccion QBI.
// Datos inventados.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const tax = require("../lib/tax-calculations");

const scorpOwners = {
  filingStatus: "MFJ", state: "IL",
  wages: 50000, ownerWages: 50000, ownerCount: 2, sCorpIncome: 300000,
  otherIncome: 10000, qbi: 300000, w2Wages: 400000,
};
const near = (actual, expected, tol = 0.01) => assert.ok(Math.abs(actual - expected) <= tol, `esperaba ~${expected}, dio ${actual}`);

test("la ganancia de una S-corp no paga SE tax; el sueldo de los dueños paga FICA, las dos mitades", () => {
  const r = tax.computeScenarioTax(scorpOwners, [], 2026);
  assert.strictEqual(r.seTax, 0);
  // Dos dueños de $25.000: 6,2% + 1,45% cada mitad.
  near(r.payrollTax, 50000 * 0.0765 * 2);
  near(r.total, r.federalTax + r.stateTax + r.payrollTax);
});

test("la misma ganancia como Schedule C si paga SE tax", () => {
  const r = tax.computeScenarioTax({ filingStatus: "MFJ", state: "IL", netSEIncome: 300000 }, [], 2026);
  assert.ok(r.seTax > 20000, `SE tax ${r.seTax}`);
  assert.strictEqual(r.payrollTax, 0);
});

test("subir el sueldo de los dueños lo saca del K-1 junto con la mitad patronal del FICA", () => {
  const adj = [{ field: "ownerWages", newValue: 80000 }];
  const p = tax.applyAdjustments(scorpOwners, adj, 2026);
  assert.strictEqual(p.wages, 80000);
  near(p.sCorpIncome, 300000 - 30000 - 30000 * 0.0765);
  assert.strictEqual(p.w2Wages, 430000);
  const before = tax.computeScenarioTax(scorpOwners, [], 2026);
  const after = tax.computeScenarioTax(scorpOwners, adj, 2026);
  near(after.payrollTax, 80000 * 0.0765 * 2);
  assert.ok(after.total > before.total, "subir el sueldo cuesta: mas FICA y menos QBI");
});

test("si el escenario fija el K-1 a mano, el sueldo no lo vuelve a tocar", () => {
  const p = tax.applyAdjustments(scorpOwners, [{ field: "ownerWages", newValue: 80000 }, { field: "sCorpIncome", newValue: 250000 }], 2026);
  assert.strictEqual(p.sCorpIncome, 250000);
  assert.strictEqual(p.wages, 80000);
});

test("la IRA baja el taxable income y los creditos generales bajan el impuesto federal", () => {
  const base = tax.computeScenarioTax(scorpOwners, [], 2026);
  const ira = tax.computeScenarioTax({ ...scorpOwners, iraDeduction: 14000 }, [], 2026);
  assert.ok(base.taxableIncome - ira.taxableIncome > 10000, "la IRA reduce el taxable (menos el efecto en el QBI)");
  const credits = tax.computeScenarioTax({ ...scorpOwners, businessCredits: 8000 }, [], 2026);
  near(base.federalTax - credits.federalTax, 8000);
  assert.strictEqual(credits.businessCredits, 8000);
  const huge = tax.computeScenarioTax({ ...scorpOwners, businessCredits: 10000000 }, [], 2026);
  assert.ok(huge.federalTax >= 0 && huge.businessCredits < 10000000, "el credito no pasa del impuesto");
});

test("los dividendos calificados pagan la tasa de ganancias de capital y el NIIT", () => {
  const ordinary = tax.computeScenarioTax({ ...scorpOwners, otherIncome: 30000 }, [], 2026);
  const qualified = tax.computeScenarioTax({ ...scorpOwners, otherIncome: 10000, qualifiedDividends: 20000 }, [], 2026);
  assert.ok(qualified.federalTax < ordinary.federalTax);
  assert.ok(qualified.niit > 0, "con AGI sobre $250.000 los dividendos pagan NIIT");
  assert.strictEqual(ordinary.niit, 0, "el interes en otherIncome no se cuenta como inversion");
});

test("2027 usa las tablas de 2026 y lo dice; 2026 no", () => {
  const r27 = tax.computeScenarioTax(scorpOwners, [], 2027);
  assert.strictEqual(r27.tablesYear, 2026);
  assert.strictEqual(r27.tablesEstimated, true);
  const r26 = tax.computeScenarioTax(scorpOwners, [], 2026);
  assert.strictEqual(r26.tablesEstimated, false);
  assert.strictEqual(tax.limitsFor(2027).hsa.family, 9000, "el HSA de 2027 ya esta publicado");
});

test("las tablas oficiales: ley de 2025 y Rev. Proc. 2025-32", () => {
  const c = tax._constants;
  assert.strictEqual(c.STANDARD_DEDUCTION[2025].MFJ, 31500);
  assert.strictEqual(c.STANDARD_DEDUCTION[2026].MFJ, 32200);
  assert.strictEqual(c.FEDERAL_BRACKETS[2026].MFJ[3].upTo, 403550);
  assert.strictEqual(c.SS_WAGE_BASE[2026], 184500);
  assert.strictEqual(c.QBI_THRESHOLD[2026].MFJ, 403500);
  assert.strictEqual(c.QBI_PHASE_IN_RANGE[2026].MFJ, 150000);
  assert.strictEqual(c.SEC179[2025].cap, 2500000);
  assert.strictEqual(c.SEC179[2026].cap, 2560000);
  assert.strictEqual(c.BONUS_DEPRECIATION_PCT[2026], 1);
  assert.strictEqual(c.RETIREMENT_LIMITS[2026].employee401k, 24500);
  assert.strictEqual(c.LTCG_BREAKPOINTS[2026].MFJ.fifteenUpTo, 613700);
});

test("el limite por sueldos del QBI entra de a poco en el rango", () => {
  // Single 2026: umbral $201.750, rango $75.000. A mitad de rango, la mitad del recorte.
  const r = tax.calcQBIDeduction(100000, 239250, "Single", { w2Wages: 0, netCapitalGains: 0, year: 2026 });
  near(r.deduction, 10000);
  const below = tax.calcQBIDeduction(100000, 200000, "Single", { w2Wages: 0, year: 2026 });
  near(below.deduction, 20000);
});

test("el estado se calcula antes de la deduccion QBI", () => {
  const r = tax.computeScenarioTax(scorpOwners, [], 2026);
  near(r.stateTax, Math.round(0.0495 * (r.taxableIncome + r.qbiDeduction) * 100) / 100, 0.02);
});

test("la depreciacion nueva de una S-corp baja el QBI", () => {
  const r = tax.computeScenarioTax(scorpOwners, [{ field: "bonusDepreciation", newValue: 50000 }], 2026);
  assert.strictEqual(r.qbiIncome, 250000);
  assert.strictEqual(r.seTax, 0, "y no crea SE tax");
});

test("la IRA deja de ser deducible con un plan en el trabajo, segun el ingreso", () => {
  assert.strictEqual(tax.iraDeductionAllowed(14000, 400000, "MFJ", 2026), 0);
  assert.strictEqual(tax.iraDeductionAllowed(14000, 100000, "MFJ", 2026), 14000);
  near(tax.iraDeductionAllowed(14000, 139000, "MFJ", 2026), 7000);
  assert.strictEqual(tax.iraDeductionAllowed(7000, 247000, "MFJ", 2026, { spouseOnly: true }), 3500);
});

// normalizePlanningProfile vive en server.js y no se exporta; se toma de ahi para probar lo que
// de verdad corre.
const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no encontre ${name} en server.js`);
  return src.slice(start, src.indexOf("\n}", start) + 2);
};
// eslint-disable-next-line no-new-func
const normalizePlanningProfile = new Function(
  "planningTax",
  `${grab("planningNum")}\n${grab("planningRound")}\n${grab("planningCount")}\n${grab("planningIncomeType")}\n${grab("normalizePlanningProfile")}\nreturn normalizePlanningProfile;`,
)(tax);

test("el perfil nuevo separa la S-corp del self-employment", () => {
  const p = normalizePlanningProfile({
    filingStatus: "MFJ", businessIncomeType: "scorp", businessIncomeTotal: 300000, ownershipPct: 100,
    sCorpIncome: 300000, netSEIncome: 0, wages: 50000, ownerWages: 50000, ownerCount: 2,
  });
  assert.strictEqual(p.sCorpIncome, 300000);
  assert.strictEqual(p.netSEIncome, 0);
  assert.strictEqual(p.ownerCount, 2);
});

test("un analisis guardado antes del cambio, de una S-corp, pasa el K-1 a sCorpIncome", () => {
  const p = normalizePlanningProfile({ entityType: "S-Corp", filingStatus: "MFJ", businessIncomeTotal: 0, netSEIncome: 300000 });
  assert.strictEqual(p.businessIncomeType, "scorp");
  assert.strictEqual(p.sCorpIncome, 300000);
  assert.strictEqual(p.netSEIncome, 0);
  const r = tax.computeScenarioTax(p, [], 2026);
  assert.strictEqual(r.seTax, 0);
});

test("un autonomo sigue siendo autonomo", () => {
  const p = normalizePlanningProfile({ entityType: "Sole proprietor", businessIncomeTotal: 120000, ownershipPct: 100 });
  assert.strictEqual(p.businessIncomeType, "se");
  assert.strictEqual(p.netSEIncome, 120000);
  assert.strictEqual(p.sCorpIncome, 0);
});

test("el sueldo de los dueños siempre esta dentro de los W-2", () => {
  const p = normalizePlanningProfile({ businessIncomeType: "scorp", wages: 0, ownerWages: 40000 });
  assert.strictEqual(p.wages, 40000);
  assert.strictEqual(p.ownerCount, 1);
});
