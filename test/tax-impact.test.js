"use strict";
// El efecto estimado de cada hallazgo en el impuesto (lib/tax-impact.js). Cifras ficticias.
const { test } = require("node:test");
const assert = require("node:assert");
const { taxProfile, attachTaxImpact, fromImpact, fromModel, promptLine } = require("../lib/tax-impact");
const { canonicalLineKey } = require("../lib/tie-out");
const { leerFixtures } = require("../scripts/banco/calificar.cjs");

const profile = { kind: "individual", rate: 0.12, short: "12% marginal rate", basis: "12% marginal rate (taxable income $30,670, MFS, 2025)" };

test("creditos y pagos peso por peso; ingresos y deducciones por la tasa marginal", () => {
  assert.strictEqual(fromImpact({ kind: "credit", amount: 2200 }, profile).value, 2200);
  assert.strictEqual(fromImpact({ kind: "payment", amount: 600 }, profile).value, 600);
  const deduction = fromImpact({ kind: "deduction", amount: 15750 }, profile);
  assert.strictEqual(deduction.value, 1890);
  assert.match(deduction.label, /\$15,750 × 12% marginal rate/);
  // Sin tasa no se estima lo que depende de ella; lo que no depende, si.
  assert.strictEqual(fromImpact({ kind: "income", amount: 1000 }, { kind: "pass-through", rate: null }), null);
  assert.strictEqual(fromImpact({ kind: "payment", amount: 500 }, { kind: "pass-through", rate: null }).value, 500);
});

test("la estimacion del modelo se muestra solo si sale de las cifras de su hallazgo", () => {
  assert.strictEqual(fromModel({ issueDescription: "Line 2b reports $420 of bank interest.", taxImpact: 50 }).value, 50);
  assert.strictEqual(fromModel({ issueDescription: "A $300 item.", taxImpact: 90000 }), null);
  assert.strictEqual(fromModel({ issueDescription: "No figures here.", taxImpact: 10 }), null);
});

test("el orden por plata dentro de cada prioridad, con la integridad del paquete primero", () => {
  const issues = [
    { priority: "HIGH", category: "Income", formOrSchedule: "a", issueDescription: "x", impact: { kind: "income", amount: 1000 } },
    { priority: "HIGH", category: "Credits", formOrSchedule: "b", issueDescription: "x", impact: { kind: "credit", amount: 2200 } },
    { priority: "HIGH", category: "Package integrity", formOrSchedule: "c", issueDescription: "Return type mismatch." },
    { priority: "MEDIUM", formOrSchedule: "Form 1040-NR Line 33 - Total payments", issueDescription: "The return is $900 lower.", source: "Tie-out computed by RAG Tax AI", difference: -900 },
    { priority: "MEDIUM", formOrSchedule: "d", issueDescription: "A question." },
  ];
  const out = attachTaxImpact(issues, profile, { canonicalLineKey });
  assert.deepStrictEqual(out.issues.map((i) => i.formOrSchedule), ["c", "b", "a", "Form 1040-NR Line 33 - Total payments", "d"]);
  assert.deepStrictEqual(out.issues.map((i) => i.taxImpact || 0), [0, 2200, 120, 900, 0]);
  assert.strictEqual(out.estimated, 3);
  assert.ok(out.issues.every((i) => !("impact" in i)), "el dato interno no llega al informe");
});

test("la tasa marginal sale de la declaracion: 1040-NR, 1040 y C corp del banco", () => {
  const byType = Object.fromEntries(leerFixtures().map((f) => [f.returnType, f]));
  const files = (f) => f.files.map((x) => ({ ...x, reviewRole: x.role }));
  assert.strictEqual(taxProfile(files(byType["1040-NR"]), "1040-NR", { taxYear: "2025" }).rate, 0.12);
  assert.strictEqual(taxProfile(files(byType["1040"]), "1040", { taxYear: "2025" }).rate, 0.12);
  assert.strictEqual(taxProfile(files(byType["1120"]), "1120", {}).rate, 0.21);
  assert.strictEqual(taxProfile(files(byType["1065"]), "1065", {}).kind, "pass-through");
  assert.match(promptLine(taxProfile(files(byType["1040"]), "1040", { taxYear: "2025" })), /12% marginal rate/);
});
