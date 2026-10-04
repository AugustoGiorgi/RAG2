"use strict";
// Lo que cuesta una corrida no llega a quien no es dueño de la app (lib/cost-privacy.js), y
// los datos del cliente que se llaman parecido quedan intactos. Datos ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const { stripCostData } = require("../lib/cost-privacy");

const usage = { input_tokens: 120000, output_tokens: 9000, cache_read_input_tokens: 50000 };
const estimate = { currency: "USD", inputTokens: 120000, outputTokens: 9000, inputUsd: 0.36, outputUsd: 0.135, totalUsd: 0.495, model: "m" };

test("saca el costo y los tokens de la respuesta de una review, y deja todo lo demas", () => {
  const response = {
    ok: true,
    review: { executiveSummary: "Fine.", issues: [{ priority: "HIGH", issueDescription: "x" }] },
    meta: { clientName: "Sample Co" },
    documentsRead: [{ name: "2025.pdf" }],
    model: "m",
    usage,
    passes: 2,
    tokensUsed: 129000,
    costEstimate: estimate,
    ceilingUsd: 3,
    ceilingClamped: false,
    savedReviewHistory: { id: "h1" },
  };
  const clean = stripCostData(response);
  assert.deepStrictEqual(Object.keys(clean), ["ok", "review", "meta", "documentsRead", "model", "passes", "savedReviewHistory"]);
  assert.strictEqual(clean.review, response.review, "lo que no cambia no se copia");
  assert.ok("costEstimate" in response && "usage" in response, "no modifica el original");
});

test("tambien con otros nombres: cost, tokensUsed como objeto, y el formato del registro de costos", () => {
  const clean = stripCostData({
    filename: "deck.pptx",
    tokensUsed: usage,
    cost: estimate,
    billing: { inputCost: 0.1, outputCost: 0.2, totalCost: 0.3 },
    passesUsage: [usage, usage],
  });
  assert.deepStrictEqual(clean, { filename: "deck.pptx" });
});

test("lo encuentra anidado: una sesion guardada con la respuesta completa adentro", () => {
  const session = { id: "s1", reviewResult: { review: { issues: [] }, costEstimate: estimate, usage }, list: [{ preparationResult: { workbook: { sheets: [] }, costEstimate: estimate } }] };
  const clean = stripCostData(session);
  assert.deepStrictEqual(clean, { id: "s1", reviewResult: { review: { issues: [] } }, list: [{ preparationResult: { workbook: { sheets: [] } } }] });
});

test("los datos del cliente que se llaman parecido no se tocan", () => {
  const data = {
    assets4562: [{ description: "Truck", cost: 42000, priorDepreciation: 8400 }],
    strategies: [{ title: "Retirement plan", taxSavings: 9000, extraCost: 1500 }],
    penalties: [{ scenario: "No extension", monthlyCost: 120, annualCost: 1440 }],
    transactions8949: [{ description: "100 sh", proceeds: 5000, basis: 3000 }],
    usage: "Used in the Review tab",
    cost: 15,
    totals: { totalCost: 99 },
    summary: { total: 22, tabs: [{ tab: "Review", count: 12 }], users: [{ username: "ana", total: 9 }] },
  };
  const clean = stripCostData(data);
  assert.strictEqual(clean, data, "sin nada que sacar devuelve el mismo objeto");
});

test("valores que no son objetos comunes pasan como estan", () => {
  const when = new Date(0);
  const bytes = Buffer.from("PK");
  const clean = stripCostData({ when, bytes, nothing: null, n: 0, s: "", list: [null, 1, "a"], costEstimate: null });
  assert.strictEqual(clean.when, when);
  assert.strictEqual(clean.bytes, bytes);
  assert.deepStrictEqual(Object.keys(clean), ["when", "bytes", "nothing", "n", "s", "list"]);
  assert.strictEqual(stripCostData(null), null);
  assert.strictEqual(stripCostData("texto"), "texto");
  assert.deepStrictEqual(stripCostData([1, { tokensUsed: 5, a: 1 }]), [1, { a: 1 }]);
});
