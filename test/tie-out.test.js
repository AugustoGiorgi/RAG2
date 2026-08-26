"use strict";
// Veredictos numéricos deterministas del Review. Reproduce las divergencias reales
// observadas entre dos corridas del MISMO paquete (importes ficticios donde aplica).
const { test } = require("node:test");
const assert = require("node:assert");
const { enforceNumericVerdicts, enforceTieOutVerdicts, enforceBalanceSheetVerdict, parseAmount } = require("../lib/tie-out");

test("parseAmount: formatos que llegan del modelo", () => {
  assert.strictEqual(parseAmount(81825), 81825);
  assert.strictEqual(parseAmount("81,825"), 81825);
  assert.strictEqual(parseAmount("$1,733.04"), 1733.04);
  assert.strictEqual(parseAmount("(218)"), -218);
  assert.strictEqual(parseAmount(""), null);
  assert.strictEqual(parseAmount(null), null);
  assert.strictEqual(parseAmount("n/a"), null);
});

test("el caso grave: una diferencia enorme NO puede quedar como TIE", () => {
  const { rows, changed } = enforceTieOutVerdicts([
    { lineItem: "Form 7203 stock basis", returnAmount: 74456, workpaperAmount: 95973, difference: -21517, status: "TIE" },
  ]);
  assert.strictEqual(rows[0].status, "OUT_OF_BALANCE");
  assert.strictEqual(rows[0].difference, -21517);
  assert.match(rows[0].note, /Recomputed by the app/);
  assert.strictEqual(changed, 1);
});

test("redondeo IRS por debajo de $1 siempre TIE (aunque el modelo diga lo contrario)", () => {
  const { rows } = enforceTieOutVerdicts([
    { lineItem: "W-2 wages", returnAmount: 81825, workpaperAmount: 81824.69, status: "OUT_OF_BALANCE" },
  ]);
  assert.strictEqual(rows[0].status, "TIE");
  assert.strictEqual(rows[0].difference, 0.31);
  assert.match(rows[0].note, /whole-dollar rounding/);
});

test("mismo importe = mismo veredicto, sin importar lo que dijo cada corrida", () => {
  const row = { lineItem: "Interest", returnAmount: 1738, workpaperAmount: 1733.04 };
  const run12 = enforceTieOutVerdicts([{ ...row, status: "TIE" }]).rows[0];
  const run13 = enforceTieOutVerdicts([{ ...row, status: "OUT_OF_BALANCE" }]).rows[0];
  assert.strictEqual(run12.status, run13.status);
  assert.strictEqual(run12.difference, run13.difference);
  assert.strictEqual(run12.status, "OUT_OF_BALANCE"); // 4.96 supera el umbral de $1
});

test("un lado faltante nunca se reporta como verificado", () => {
  const { rows, changed } = enforceTieOutVerdicts([
    { lineItem: "Schedule E line 30", returnAmount: 193201, workpaperAmount: "", status: "TIE" },
  ]);
  assert.strictEqual(rows[0].status, "OUT_OF_BALANCE");
  assert.match(rows[0].note, /Not verified/);
  assert.strictEqual(changed, 1);
});

test("la diferencia se recalcula: no se confía en la aritmética del modelo", () => {
  const { rows } = enforceTieOutVerdicts([
    { lineItem: "Total tax", returnAmount: 58949, workpaperAmount: 58949, difference: 999, status: "TIE" },
  ]);
  assert.strictEqual(rows[0].difference, 0);
  assert.strictEqual(rows[0].status, "TIE");
});

test("balance sheet: 'balanced' también es aritmética, no opinión", () => {
  const bad = enforceBalanceSheetVerdict({ totalAssets: 340025.35, totalLiabEquity: 320000, balanced: true });
  assert.strictEqual(bad.check.balanced, false);
  assert.strictEqual(bad.check.difference, 20025.35);
  assert.strictEqual(bad.changed, 1);
  const good = enforceBalanceSheetVerdict({ totalAssets: 340025.35, totalLiabEquity: 340025.35, balanced: false });
  assert.strictEqual(good.check.balanced, true);
});

test("balance sheet sin importes legibles se deja intacto (no inventa un veredicto)", () => {
  const untouched = enforceBalanceSheetVerdict({ totalAssets: null, totalLiabEquity: null, balanced: false, note: "no Schedule L" });
  assert.strictEqual(untouched.changed, 0);
  assert.strictEqual(untouched.check.note, "no Schedule L");
});

test("enforceNumericVerdicts no muta el objeto original", () => {
  const original = { tieOutResults: [{ lineItem: "x", returnAmount: 10, workpaperAmount: 99, status: "TIE" }] };
  const result = enforceNumericVerdicts(original);
  assert.strictEqual(original.tieOutResults[0].status, "TIE");
  assert.strictEqual(result.review.tieOutResults[0].status, "OUT_OF_BALANCE");
  assert.strictEqual(result.corrections, 1);
});
