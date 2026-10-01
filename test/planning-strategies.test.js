"use strict";
// Las reglas fijas de Tax Planning (lib/planning-strategies.js). Antes el modelo inventaba las
// estrategias y los montos en cada corrida; estos tests fijan que los mismos datos den lo mismo,
// que cada estrategia respete los hechos del cliente y que "Best" no premie gastar plata.
// Datos inventados.
const { test } = require("node:test");
const assert = require("node:assert");
const tax = require("../lib/tax-calculations");
const { planStrategies, pickRecommended, netBenefit, opportunityAmountText } = require("../lib/planning-strategies");

// Una S-corp con empleados, dos dueños en la nomina con un sueldo bajo y una IRA deducible.
const bakery = {
  filingStatus: "MFJ", state: "IL", dependents: 0,
  wages: 50000, ownerWages: 50000, ownerCount: 2, sCorpIncome: 300000,
  otherIncome: 10000, qbi: 300000, w2Wages: 400000, employeeWages: 350000,
  iraDeduction: 14000, ownersAge50Plus: 0, ownersAge55Plus: 0, hsaEligible: "unknown",
};

function evaluate(profile, year) {
  const { defs, items } = planStrategies(profile, year);
  const base = tax.computeScenarioTax(profile, [], year);
  const scenarios = [{ id: "base", isBase: true, taxCalc: base, savingsVsBase: { dollars: 0 } }, ...defs.map((d) => {
    const taxCalc = tax.computeScenarioTax(profile, d.adjustments, year);
    return { ...d, taxCalc, savingsVsBase: { dollars: Math.round((base.total - taxCalc.total) * 100) / 100 } };
  })];
  return { defs, items, scenarios, byId: Object.fromEntries(scenarios.map((s) => [s.id, s])) };
}

test("los mismos datos dan siempre las mismas estrategias y los mismos numeros", () => {
  assert.deepStrictEqual(planStrategies(bakery, 2026), planStrategies(bakery, 2026));
  assert.deepStrictEqual(planStrategies({ ...bakery }, 2026), planStrategies(bakery, 2026));
});

test("con empleados no hay Solo 401(k): es un safe harbor, con su costo para los empleados", () => {
  const { byId } = evaluate(bakery, 2026);
  const plan = byId["retirement-401k"];
  assert.strictEqual(plan.name, "Safe harbor 401(k) for the business");
  assert.strictEqual(plan.extraCost, 10500, "3% de $350.000 de sueldos de empleados");
  assert.doesNotMatch(JSON.stringify(plan.adjustments), /Solo/);
  // Cada dueño cobra $25.000: el diferimiento no puede pasar del sueldo menos el FICA.
  const deferrals = plan.adjustments.find((a) => a.field === "retirementContribution").newValue;
  assert.strictEqual(deferrals, 2 * Math.round(25000 * (1 - 0.0765)));
});

test("sin empleados si es un Solo 401(k), con el 25% del sueldo como aporte de la empresa", () => {
  const { byId } = evaluate({ ...bakery, employeeWages: 0 }, 2026);
  const plan = byId["retirement-401k"];
  assert.strictEqual(plan.name, "Solo 401(k) for the owners");
  assert.strictEqual(plan.extraCost, 0);
  const sCorp = plan.adjustments.find((a) => a.field === "sCorpIncome").newValue;
  assert.strictEqual(sCorp, 300000 - 2 * 6250, "25% de $25.000 por dueño sale del K-1");
});

test("con un plan en el trabajo, la IRA deja de ser deducible a este ingreso", () => {
  const { byId } = evaluate(bakery, 2026);
  const ira = byId["retirement-401k"].adjustments.find((a) => a.field === "iraDeduction");
  assert.ok(ira, "el plan tiene que bajar la IRA");
  assert.strictEqual(ira.newValue, 0);
  assert.match(byId["retirement-401k"].cpaNote, /IRA deduction drops/);
});

test("un plan de retiro existente no se vuelve a proponer: queda como tema para conversar", () => {
  const { byId, items } = evaluate({ ...bakery, hasRetirementPlan: true }, 2026);
  assert.strictEqual(byId["retirement-401k"], undefined);
  assert.ok(items.some((i) => i.id === "retirement-existing"));
});

test("el seguro medico que ya paga la S-corp es un aviso de cumplimiento, no un ahorro nuevo", () => {
  const { byId, items } = evaluate({ ...bakery, healthPremiumsPaidByBusiness: 12000, healthPremiumsPaidPersonally: 12000 }, 2026);
  assert.strictEqual(byId["health-insurance"], undefined, "no se cuenta dos veces");
  const notice = items.find((i) => i.id === "health-insurance-w2");
  assert.strictEqual(notice.kind, "compliance");
});

test("las primas pagadas en persona si son un ahorro, pasando por la S-corp", () => {
  const { byId } = evaluate({ ...bakery, healthPremiumsPaidPersonally: 12000 }, 2026);
  const s = byId["health-insurance"];
  const get = (f) => s.adjustments.find((a) => a.field === f).newValue;
  assert.strictEqual(get("selfEmployedHealthInsurance"), 12000);
  assert.strictEqual(get("wages"), 62000, "las primas van al Box 1");
  assert.strictEqual(get("sCorpIncome"), 288000, "y la S-corp las deduce");
  assert.ok(s.savingsVsBase.dollars > 0);
});

test("un sueldo bajo es un riesgo: muestra lo que cuesta corregirlo y nunca es Best", () => {
  const { byId, scenarios } = evaluate(bakery, 2026);
  const risk = byId["reasonable-comp"];
  assert.strictEqual(risk.kind, "risk");
  assert.strictEqual(risk.adjustments[0].field, "ownerWages");
  assert.strictEqual(risk.adjustments[0].newValue, Math.round((350000 * 0.35) / 1000) * 1000);
  assert.ok(risk.savingsVsBase.dollars < 0, "subir el sueldo cuesta");
  assert.notStrictEqual(pickRecommended(scenarios), "reasonable-comp");
});

test("sin una compra planeada no se inventa equipo; con una, no compite por Best", () => {
  const none = evaluate({ ...bakery, assetPurchaseNotes: ["Loan for a second location"] }, 2026);
  assert.strictEqual(none.byId.equipment, undefined);
  assert.ok(none.items.some((i) => i.id === "capital-spending" && i.kind === "discussion"));

  const planned = evaluate({ ...bakery, plannedAssetPurchases: 400000 }, 2026);
  const eq = planned.byId.equipment;
  assert.strictEqual(eq.requiresSpending, 400000);
  assert.ok(eq.savingsVsBase.dollars > planned.byId.hsa.savingsVsBase.dollars, "ahorra mas que el HSA...");
  assert.notStrictEqual(pickRecommended(planned.scenarios), "equipment", "...y aun asi no es Best");
});

test("el adelanto del premium tax credit devuelto es un aviso", () => {
  const { items } = evaluate({ ...bakery, excessAptcRepayment: 2500 }, 2026);
  const notice = items.find((i) => i.id === "premium-tax-credit");
  assert.strictEqual(notice.kind, "compliance");
  assert.match(notice.description, /\$2,500/);
});

test("el HSA usa el limite familiar del año, y no aparece si el plan no califica", () => {
  assert.strictEqual(evaluate(bakery, 2026).byId.hsa.adjustments[0].newValue, 8750);
  assert.strictEqual(evaluate(bakery, 2027).byId.hsa.adjustments[0].newValue, 9000);
  assert.strictEqual(evaluate({ ...bakery, hsaEligible: "no" }, 2026).byId.hsa, undefined);
});

test("el Combined plan solo suma estrategias que solas dejan beneficio neto", () => {
  const { byId } = evaluate({ ...bakery, healthPremiumsPaidPersonally: 12000 }, 2026);
  const combined = byId.combined;
  assert.ok(combined, "HSA + seguro medico");
  // Entra el plan de retiro solo si solo deja beneficio neto: uno que cuesta mas de lo que
  // ahorra esconderia su costo dentro del total.
  assert.strictEqual(combined.parts.includes("retirement-401k"), netBenefit(byId["retirement-401k"]) > 0);
  assert.ok(combined.parts.includes("hsa") && combined.parts.includes("health-insurance"));
  const costly = evaluate({ ...bakery, healthPremiumsPaidPersonally: 12000, employeeWages: 2000000 }, 2026).byId;
  assert.ok(netBenefit(costly["retirement-401k"]) < 0, "con mucha nomina el safe harbor cuesta mas de lo que ahorra");
  assert.ok(!costly.combined.parts.includes("retirement-401k"));
});

test("Best es el mayor beneficio neto entre los que no exigen gastar", () => {
  const { scenarios } = evaluate({ ...bakery, healthPremiumsPaidPersonally: 12000, plannedAssetPurchases: 400000 }, 2026);
  const eligible = scenarios.filter((s) => !s.isBase && s.kind === "savings" && !s.requiresSpending);
  const top = eligible.reduce((a, b) => (netBenefit(b) > netBenefit(a) ? b : a));
  assert.strictEqual(pickRecommended(scenarios), top.id);
});

test("pasar a S-corp se propone a un autonomo con ganancia suficiente", () => {
  const owner = { filingStatus: "Single", state: "TX", netSEIncome: 150000, qbi: 150000 };
  const { byId } = evaluate(owner, 2026);
  const election = byId["scorp-election"];
  assert.ok(election, "con $150.000 de ganancia");
  assert.ok(election.savingsVsBase.dollars > 0, "ahorra SE tax");
  assert.strictEqual(election.extraCost, 2000);
  assert.strictEqual(evaluate({ ...owner, netSEIncome: 40000, qbi: 40000 }, 2026).byId["scorp-election"], undefined);
});

test("el monto de una tarjeta dice el costo cuando lo hay", () => {
  const fmt = (n) => "$" + Math.round(n).toLocaleString("en-US");
  assert.strictEqual(opportunityAmountText({ kind: "savings", taxSavings: 9000, extraCost: 10500 }, fmt), "$9,000 tax savings · up to $10,500 cost");
  assert.strictEqual(opportunityAmountText({ kind: "risk", taxSavings: -12000 }, fmt), "cost $12,000");
  assert.strictEqual(opportunityAmountText({ kind: "compliance" }, fmt), "compliance");
});
