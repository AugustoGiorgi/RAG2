"use strict";
// Tax Planning corre en Sonnet 5.5 sin razonamiento previo. Estos tests fijan el orden de los
// modelos, que se manda en `thinking` a cada uno, y el lugar extra de salida.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  planningModels, upfrontThinkingOff, planningMaxTokens, PLANNING_DEFAULT_MODEL,
} = require("../lib/planning-model");

test("Sonnet 5.5 va primero y los fallbacks de siempre quedan detras", () => {
  assert.strictEqual(PLANNING_DEFAULT_MODEL, "claude-sonnet-5-5");
  assert.deepStrictEqual(
    planningModels("", ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]),
    ["claude-sonnet-5-5", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929"],
  );
});

test("la variable de entorno manda sobre el modelo por defecto, sin repetir modelos", () => {
  assert.deepStrictEqual(
    planningModels(" claude-sonnet-4-6 ", ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]),
    ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929"],
  );
  assert.strictEqual(planningModels(undefined, [])[0], "claude-sonnet-5-5", "sin variable, el de por defecto");
});

test("a cada modelo se le pide no razonar con lo que ese modelo acepta", () => {
  // En 5.5 "disabled" da 400: lo mas bajo que acepta es between_tools.
  assert.deepStrictEqual(upfrontThinkingOff("claude-sonnet-5-5"), { type: "between_tools" });
  assert.deepStrictEqual(upfrontThinkingOff("claude-sonnet-5"), { type: "disabled" });
  // Los 4.x no razonan si no se les pide: el pedido queda como estaba.
  for (const model of ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "", undefined]) {
    assert.strictEqual(upfrontThinkingOff(model), null, String(model));
  }
});

test("el tope de salida crece por el tokenizador nuevo", () => {
  assert.strictEqual(planningMaxTokens(4000), 5400);
  assert.strictEqual(planningMaxTokens(8000), 10800);
  assert.strictEqual(planningMaxTokens(3000), 4050);
});
