"use strict";
// Como entran las filas calculadas por codigo en la Review: las de identidad (SSN, nombres,
// EIN de los K-1) y las de casillas (preguntas Si/No y casillas marcadas, contra el año
// anterior). Se prueban las funciones reales de server.js, tomadas del archivo. Lo que el
// modelo escribio sobre otros temas tiene que seguir ahi. Datos ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { identityRows, COMPUTED_ITEMS, COMPUTED_SOURCE } = require("../lib/identity-consistency");
const { identityInventoryRows } = require("../lib/identity-inventory");
const { checkboxInventoryRows, questionKey } = require("../lib/checkbox-inventory");

const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no encontre ${name} en server.js`);
  return src.slice(start, src.indexOf("\n}", start) + 2);
};
const quiet = { log() {} };
// eslint-disable-next-line no-new-func
const mergeIdentity = new Function("identityRows", "identityInventoryRows", "COMPUTED_ITEMS", "COMPUTED_SOURCE", "console",
  `${grab("mergeComputedIdentityRows")}\nreturn mergeComputedIdentityRows;`)(identityRows, identityInventoryRows, COMPUTED_ITEMS, COMPUTED_SOURCE, quiet);
// eslint-disable-next-line no-new-func
const mergeCheckboxes = new Function("checkboxInventoryRows", "checkboxQuestionKey", "console",
  `${grab("mergeComputedCheckboxRows")}\nreturn mergeComputedCheckboxRows;`)(checkboxInventoryRows, questionKey, quiet);

function fakeReturn(year, form1099) {
  const out = [`Form 1040 ${year} U.S. Individual Income Tax Return`];
  for (let page = 1; page <= 6; page += 1) out.push(`--- Page ${page} ---`, `JOHN Q SAMPLE 400-00-1111`);
  out.push(`Schedule E Part II ACME FUND LP P 12-3456789 12,500.`);
  out.push(`A Did you make any payments in ${year} that would require you to file Form(s) 1099? . . . X [ANSWER: ${form1099}]`);
  out.push(`Digital Assets At any time during ${year}, did you receive or sell a digital asset? . . . Yes X No [ANSWER: No]`);
  out.push("Filing Status Check only X Married filing jointly (even if only one had income)");
  return out.join("\n");
}
const file = (name, text, role) => ({ name, text, fullText: text, reviewRole: role });
const payload = (form1099) => ({
  metadata: { taxYear: "2025" },
  files: [
    file("2025.pdf", fakeReturn(2025, form1099), "current_return"),
    file("2024.pdf", fakeReturn(2024, "No"), "prior_return"),
    file("W-2.pdf", "Form W-2 2025\nEmployee's SSN 400-00-1111\nJOHN Q SAMPLE", "supporting_document"),
  ],
});

test("identidad: las filas del codigo van primero y lo demas del modelo se queda", () => {
  const review = { infoConsistency: [
    { item: "Mailing address", status: "MATCH", note: "Same as last year." },
    { item: "Identifiers verified as matching", status: "MATCH", note: "6 — address, occupation" },
  ] };
  mergeIdentity(review, payload("No"));
  const items = review.infoConsistency.map((r) => r.item);
  assert.ok(items.indexOf("Identifiers verified by code") < items.indexOf("Mailing address"), "lo calculado antes que lo del modelo");
  assert.ok(items.includes("Mailing address") && items.includes("Identifiers verified as matching"));
  const scope = review.infoConsistency.find((r) => r.item === "Identifiers verified by code");
  assert.match(scope.note, /^3 — SSNs matching the prior-year return: 1; documents whose SSN is on the return: 1; documents carrying the name the return prints: 1/);
});

test("casillas: sin cambios, solo se suma la fila de alcance del codigo al final", () => {
  const review = { checkboxReview: [
    { box: "Schedule B Part III line 7a", currentState: "No", shouldBe: "No", explanation: "No foreign accounts." },
    { box: "Boxes verified as correct", currentState: "4", shouldBe: "No action", explanation: "Form 1040 page 1" },
  ] };
  mergeCheckboxes(review, payload("No"));
  assert.deepStrictEqual(review.checkboxReview.map((r) => r.box), [
    "Schedule B Part III line 7a",
    "Boxes verified as correct",
    "Boxes verified by code (same as the prior year)",
  ]);
  assert.strictEqual(review.checkboxReview[2].currentState, "3", "2 preguntas y 1 casilla iguales al año anterior");
});

test("casillas: un cambio va primero y saca la fila del modelo sobre la misma pregunta", () => {
  const review = { checkboxReview: [
    { box: "A Did you make any payments in 2025 that would require you to file Form(s) 1099?", currentState: "Yes", shouldBe: "Yes", explanation: "Contractors were paid." },
    { box: "Schedule B Part III line 7a", currentState: "No", shouldBe: "No", explanation: "No foreign accounts." },
  ] };
  mergeCheckboxes(review, payload("Yes"));
  const boxes = review.checkboxReview.map((r) => r.box);
  assert.match(boxes[0], /^A Did you make any payments in 2025/);
  assert.strictEqual(review.checkboxReview[0].shouldBe, "No (prior year) — confirm");
  assert.strictEqual(boxes.filter((b) => /payments in 2025/.test(b)).length, 1, "una sola fila por pregunta");
  assert.ok(boxes.includes("Schedule B Part III line 7a"));
  assert.strictEqual(boxes[boxes.length - 1], "Boxes verified by code (same as the prior year)");
});

test("sin declaraciones legibles no se toca nada", () => {
  const review = { infoConsistency: [{ item: "X", status: "MATCH" }], checkboxReview: [{ box: "Y", currentState: "No", shouldBe: "No" }] };
  const before = JSON.stringify(review);
  mergeIdentity(review, { metadata: {}, files: [] });
  mergeCheckboxes(review, { metadata: {}, files: [] });
  assert.strictEqual(JSON.stringify(review), before);
});

// La Review corre dos pasadas y las une (lib/review-merge.js): dos filas cuyo nombre contiene
// al de la otra se toman por la misma. La fila de alcance del codigo no puede chocar con la
// del modelo, o se pierde al unir.
test("al unir dos pasadas sobreviven las dos filas de alcance, la del modelo y la del codigo", () => {
  const { mergeReviews } = require("../lib/review-merge");
  const pass = () => {
    const review = { issues: [], checkboxReview: [
      { box: "Schedule B Part III line 7a", currentState: "No", shouldBe: "No", explanation: "No foreign accounts." },
      { box: "Boxes verified as correct", currentState: "4", shouldBe: "No action", explanation: "Form 1040 page 1" },
    ], infoConsistency: [{ item: "Identifiers verified as matching", status: "MATCH", note: "6 — address" }] };
    mergeIdentity(review, payload("No"));
    mergeCheckboxes(review, payload("No"));
    return review;
  };
  const { review } = mergeReviews([pass(), pass()]);
  const boxes = review.checkboxReview.map((r) => r.box);
  assert.ok(boxes.includes("Boxes verified as correct"));
  assert.ok(boxes.includes("Boxes verified by code (same as the prior year)"));
  const items = review.infoConsistency.map((r) => r.item);
  assert.ok(items.includes("Identifiers verified as matching") && items.includes("Identifiers verified by code"));
});
