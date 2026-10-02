"use strict";
// El Word de la Review abre con "Informational Data Consistency" y "Checkbox Review", cada una
// con su puntaje al lado del titulo: lo pidio un cliente del estudio. Es solo formato: el
// contenido de las tablas no cambia. Datos inventados.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no encontré ${name}`);
  return src.slice(start, src.indexOf("\n}", start) + 2);
};
// eslint-disable-next-line no-eval
const { build, infoLabel, checkboxLabel } = eval(`(() => {
  const safeText = (v) => String(v == null ? "" : v);
  const escapeXml = (v) => String(v == null ? "" : v);
  ${grab("dxP")}
  ${grab("dxH")}
  ${grab("dxLabel")}
  ${grab("dxTable")}
  ${src.match(/^const REVIEW_SCOPE_ROW = .*$/m)[0]}
  ${grab("reviewScopeCount")}
  ${grab("reviewInfoMatchLabel")}
  ${grab("checkboxNeedsChange")}
  ${grab("reviewCheckboxLabel")}
  ${grab("buildStructuredReviewDocxXml")}
  return { build: buildStructuredReviewDocxXml, infoLabel: reviewInfoMatchLabel, checkboxLabel: reviewCheckboxLabel };
})()`);

const info = (statuses) => statuses.map((status, i) => ({ item: `Item ${i + 1}`, returnValue: "A", sourceValue: "A", status }));
const box = (currentState, shouldBe) => ({ box: "Form 1040 box", currentState, shouldBe, explanation: "x" });

test("8 de 10 items que coinciden es 80% match", () => {
  const rows = info(["MATCH", "MATCH", "MATCH", "MATCH", "MATCH", "MATCH", "MISMATCH", "MATCH", "MISMATCH", "MATCH"]);
  assert.strictEqual(infoLabel(rows), "80% match (8 of 10)");
});

test("lo no verificado no cuenta como coincidencia y se dice", () => {
  assert.strictEqual(infoLabel(info(["MATCH", "NOT VERIFIED", "MISMATCH", "MATCH"])), "50% match (2 of 4; 1 not verified)");
});

test("checkbox: cuantos se revisaron, cuantos cambian y el porcentaje correcto", () => {
  assert.strictEqual(checkboxLabel([box("No", "No"), box("Checked", "Checked"), box("No", "No"), box("No", "No")]), "4 reviewed · 0 to change · 100% correct");
  assert.strictEqual(checkboxLabel([box("No", "Yes"), box("Checked", "Checked"), box("Unchecked", "Checked"), box("No", "No")]), "4 reviewed · 2 to change · 50% correct");
});

test("checkbox: Yes, Checked y X son lo mismo; No, Unchecked y vacio tambien", () => {
  assert.strictEqual(checkboxLabel([box("Yes", "Checked"), box("X", "Yes"), box("", "No"), box("Unchecked", "No.")]), "4 reviewed · 0 to change · 100% correct");
});

test("checkbox: sin un 'should be' no se cuenta como cambio", () => {
  assert.strictEqual(checkboxLabel([box("No", ""), box("No", "Yes")]), "2 reviewed · 1 to change · 50% correct");
});

// La review resume lo que esta bien en una fila final de alcance, con la cantidad: esa fila
// cuenta por lo que dice, no como una casilla mas. Su cantidad ya incluye las casillas correctas
// listadas arriba, asi que no se suman dos veces.
test("checkbox: la fila 'Boxes verified as correct' cuenta su numero", () => {
  const rows = [box("No", "No"), box("Unchecked", "Unchecked"), box("Checked", "Checked"), box("No", "No"), box("Unchecked", "Checked"), box("No", "No"),
    { box: "Boxes verified as correct", currentState: "22", shouldBe: "No action", explanation: "Form 1040 page 1; Schedule B Part III" }];
  assert.strictEqual(checkboxLabel(rows), "23 reviewed · 1 to change · 96% correct");
});

test("datos: la fila 'Identifiers verified as matching' cuenta el numero de su nota", () => {
  const rows = [...info(["MATCH", "MATCH", "MISMATCH"]), { item: "Identifiers verified as matching", returnValue: "N/A", sourceValue: "N/A", status: "MATCH", note: "14 — names, SSNs, address, dependents" }];
  assert.strictEqual(infoLabel(rows), "93% match (14 of 15)");
  const sinNumero = [...info(["MATCH", "MISMATCH"]), { item: "Identifiers verified as matching", status: "MATCH", note: "names and SSNs" }];
  assert.strictEqual(infoLabel(sinNumero), "50% match (1 of 2)", "una fila de alcance sin cantidad no inventa una");
});

test("el Word muestra la nota de cada dato, donde la fila de alcance lista lo verificado", () => {
  const xml = build({ issues: [], tieOutResults: [], checkboxReview: [], missingDocuments: [],
    infoConsistency: [{ item: "Identifiers verified as matching", returnValue: "N/A", sourceValue: "N/A", status: "MATCH", note: "14 — names, SSNs, address" }] });
  assert.match(xml, /Note/);
  assert.match(xml, /14 — names, SSNs, address/);
});

test("las dos secciones van primero, con su puntaje, antes del resumen y de los issues", () => {
  const xml = build({
    filingReadiness: "Ready",
    executiveSummary: "Resumen de prueba.",
    issues: [], tieOutResults: [{ lineItem: "Wages", returnAmount: "1", workpaperAmount: "1", difference: "0", status: "TIES" }],
    infoConsistency: info(["MATCH", "MISMATCH"]),
    checkboxReview: [box("No", "No")],
    missingDocuments: [],
  });
  const at = (s) => xml.indexOf(s);
  assert.ok(at("Informational Data Consistency — 50% match (1 of 2)") > 0);
  assert.ok(at("Checkbox Review — 1 reviewed · 0 to change · 100% correct") > 0);
  assert.ok(at("FILING READINESS") < at("Informational Data Consistency"), "el veredicto sigue en el encabezado");
  assert.ok(at("Informational Data Consistency") < at("Checkbox Review"));
  assert.ok(at("Checkbox Review") < at("Executive Summary"));
  assert.ok(at("Executive Summary") < at("Numeric Tie-Out"));
  assert.strictEqual(xml.split("Informational Data Consistency").length - 1, 1, "una sola vez");
  assert.strictEqual(xml.split("Checkbox Review").length - 1, 1, "una sola vez");
});

test("sin filas, no hay seccion ni contador", () => {
  const xml = build({ issues: [], tieOutResults: [], checkboxReview: [], infoConsistency: [], missingDocuments: [] });
  assert.doesNotMatch(xml, /Informational Data Consistency|Checkbox Review/);
});
