"use strict";
// La depreciacion de propiedad listada, recalculada en vez de opinada.
//
// El caso que motiva esto salio en un informe de produccion como HIGH: "la depreciacion de
// $1.285 parece subestimada". La cuenta correcta es $4.016 de base x 32% = $1.285,12 — año dos
// de cinco, 200DB, medio año — o sea que estaba clavada. El modelo habia leido la base
// depreciable como depreciacion acumulada. Estas pruebas fijan que la aritmetica la haga el
// codigo, y sobre todo que NO reporte de mas: una deduccion menor que la tabla tiene
// explicaciones legitimas y marcarla seria repetir el mismo falso positivo por el otro lado.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  listedProperty, checkListedPropertyDepreciation, verifiedDepreciation, tableAmount,
} = require("../lib/depreciation-check");
const { verifyDepreciationClaims } = require("../lib/review-guards");

// El layout exacto que produce pdf.js sobre un Form 4562 Parte V. Vehiculo ficticio.
const CORRECTO_2025 = `
26 Property used more than 50% in a qualified business use:
SEDAN MODEL 4/20/24 100.0 40,540. 4,016. 5.0 200DB HY 1,285.
`;
const CORRECTO_2024 = `
SEDAN MODEL 4/20/24 100.0 40,540. 4,016. 5.0 200DB HY 803. 30,500.
`;
// La misma linea con una deduccion inflada: 4.016 x 32% son 1.285, no 2.400.
const EXCESIVO = `
SEDAN MODEL 4/20/24 100.0 40,540. 4,016. 5.0 200DB HY 2,400.
`;
// Y una deduccion MENOR que la tabla, que es lo que produce el tope del 280F.
const TOPE_280F = `
SEDAN MODEL 4/20/24 100.0 40,540. 4,016. 5.0 200DB HY 900.
`;

test("recalcula el año dos de una tabla de cinco años al centavo", () => {
  const rows = listedProperty(CORRECTO_2025, "2025");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].basis, 4016);
  assert.strictEqual(rows[0].yearIndex, 2);
  assert.strictEqual(rows[0].expected, 1285.12);
  assert.strictEqual(rows[0].agrees, true);
});

test("y el año uno, que lleva media anualidad", () => {
  const rows = listedProperty(CORRECTO_2024, "2024");
  assert.strictEqual(rows[0].yearIndex, 1);
  assert.strictEqual(rows[0].expected, 803.2);
  assert.strictEqual(rows[0].agrees, true);
});

test("una deduccion correcta no produce ningun hallazgo", () => {
  assert.strictEqual(checkListedPropertyDepreciation(CORRECTO_2025, { taxYear: "2025" }), null);
  assert.strictEqual(checkListedPropertyDepreciation(CORRECTO_2024, { taxYear: "2024" }), null);
});

test("una deduccion por encima de la tabla si se reporta", () => {
  const found = checkListedPropertyDepreciation(EXCESIVO, { taxYear: "2025" });
  assert.ok(found, "esperaba un hallazgo");
  assert.strictEqual(found.severity, "HIGH");
  assert.match(found.detail, /\$4,016\.00 of basis in year 2 of a 5-year 200DB/);
  assert.match(found.detail, /\$1,285\.12/);
});

test("una deduccion POR DEBAJO de la tabla no se reporta: el 280F la explica", () => {
  // Marcar esto seria el mismo falso positivo que el modulo vino a evitar, del otro lado.
  assert.strictEqual(checkListedPropertyDepreciation(TOPE_280F, { taxYear: "2025" }), null);
});

test("un año fuera del periodo de recuperacion no se recalcula", () => {
  // 2032 es el año 9 de una tabla de 5: no hay porcentaje, asi que no hay opinion.
  assert.deepStrictEqual(listedProperty(CORRECTO_2025, "2032"), []);
});

test("una convencion que no es medio año no se toca", () => {
  const trimestral = "SEDAN MODEL 4/20/24 100.0 40,540. 4,016. 5.0 200DB MQ 1,285.";
  assert.deepStrictEqual(listedProperty(trimestral, "2025"), []);
});

test("un metodo que no esta en las tablas no se toca", () => {
  const raro = "SEDAN MODEL 4/20/24 100.0 40,540. 4,016. 5.0 S/L HY 803.";
  assert.deepStrictEqual(listedProperty(raro, "2025"), []);
});

test("texto sin propiedad listada no rompe nada", () => {
  assert.deepStrictEqual(listedProperty("1 Gross receipts . . . 242,270.", "2025"), []);
  assert.deepStrictEqual(listedProperty("", "2025"), []);
  assert.strictEqual(checkListedPropertyDepreciation("", { taxYear: "2025" }), null);
});

test("sin año fiscal no se calcula nada", () => {
  assert.deepStrictEqual(listedProperty(CORRECTO_2025, ""), []);
});

test("las tablas son las del Rev. Proc. 87-57", () => {
  assert.strictEqual(tableAmount({ method: "200DB", recovery: 5, basis: 10000, yearIndex: 1 }), 2000);
  assert.strictEqual(tableAmount({ method: "200DB", recovery: 7, basis: 10000, yearIndex: 2 }), 2449);
  assert.strictEqual(tableAmount({ method: "150DB", recovery: 5, basis: 10000, yearIndex: 1 }), 1500);
  assert.strictEqual(tableAmount({ method: "200DB", recovery: 4, basis: 10000, yearIndex: 1 }), null, "4 años no es una tabla");
});

/* --- El guard que desmiente al modelo con la tabla ---------------------- */

test("un hallazgo que dice que la cifra correcta esta mal se baja a LOW, con la cuenta", () => {
  const verified = verifiedDepreciation(CORRECTO_2025, { taxYear: "2025" });
  const review = {
    issues: [{
      priority: "HIGH",
      formOrSchedule: "Form 4562, Part V",
      issueDescription: "2025 depreciation of $1,285 does not match a MACRS continuation and appears understated.",
      evidence: "2025 depreciation taken: $1,285.",
      proposedSolution: "Recompute year 2 MACRS depreciation.",
    }],
  };
  const out = verifyDepreciationClaims(review, verified);
  assert.strictEqual(out.corrected, 1);
  assert.strictEqual(out.issues[0].priority, "LOW");
  assert.match(out.issues[0].riskAnalysis, /RECOMPUTED AND CORRECT/);
  assert.match(out.issues[0].riskAnalysis, /\$4,016\.00 of depreciable basis/);
  assert.match(out.issues[0].riskAnalysis, /\$1,285\.12/);
});

test("un hallazgo de depreciacion sobre OTRA cifra no se toca", () => {
  const verified = verifiedDepreciation(CORRECTO_2025, { taxYear: "2025" });
  const review = {
    issues: [{
      priority: "HIGH",
      formOrSchedule: "Form 4562",
      issueDescription: "Depreciation of $88,300 on the building does not match the schedule.",
      evidence: "",
    }],
  };
  assert.strictEqual(verifyDepreciationClaims(review, verified).corrected, 0);
});

test("un hallazgo que no pone en duda la depreciacion no se toca", () => {
  const verified = verifiedDepreciation(CORRECTO_2025, { taxYear: "2025" });
  const review = {
    issues: [{ priority: "MEDIUM", formOrSchedule: "Form 4562", issueDescription: "Depreciation of $1,285 was taken on the vehicle.", evidence: "" }],
  };
  assert.strictEqual(verifyDepreciationClaims(review, verified).corrected, 0);
});

test("el guard no toca los hallazgos deterministas de la propia app", () => {
  const verified = verifiedDepreciation(CORRECTO_2025, { taxYear: "2025" });
  const review = {
    issues: [{
      priority: "HIGH", source: "Automated cross-year check", formOrSchedule: "Form 4562",
      issueDescription: "Depreciation of $1,285 appears understated.", evidence: "",
    }],
  };
  assert.strictEqual(verifyDepreciationClaims(review, verified).corrected, 0);
});

test("sin lineas verificadas el guard se queda quieto", () => {
  const review = { issues: [{ priority: "HIGH", formOrSchedule: "Form 4562", issueDescription: "Depreciation understated." }] };
  assert.strictEqual(verifyDepreciationClaims(review, []).corrected, 0);
});
