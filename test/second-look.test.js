"use strict";
// La segunda pasada hace otro trabajo que la primera: recibe lo encontrado y preguntas que
// obligan a cruzar documentos. Hallazgos ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const { buildSecondLookInstructions, returnFamily, alreadyReported, CHECKLISTS } = require("../lib/second-look");

test("cada tipo de declaracion recibe sus propias preguntas", () => {
  assert.strictEqual(returnFamily("1040"), "individual");
  assert.strictEqual(returnFamily("Form 1065"), "partnership");
  assert.strictEqual(returnFamily("1120-S"), "scorp");
  assert.strictEqual(returnFamily("1120S"), "scorp");
  assert.strictEqual(returnFamily("1120"), "corporation");
  const partnership = buildSecondLookInstructions({ returnType: "1065", issues: [] });
  assert.match(partnership, /PARTNER LIABILITIES \(K-1 item K\)/);
  assert.doesNotMatch(partnership, /RESIDENCY/);
  assert.match(buildSecondLookInstructions({ returnType: "1040", issues: [] }), /RESIDENCY/);
});

test("lo ya encontrado va en la lista de no repetir, una linea por hallazgo", () => {
  const text = alreadyReported([
    { priority: "high", formOrSchedule: "Form 4797", issueDescription: "Sale of 100 Example St not reported." },
    { priority: "MEDIUM", areaReviewed: "Schedule E", issueDescription: "x".repeat(400) },
    null,
  ]);
  const lines = text.split("\n");
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0], "1. [HIGH] Form 4797 — Sale of 100 Example St not reported.");
  assert.ok(lines[1].length < 260, "la descripcion se corta");
  assert.strictEqual(alreadyReported([]), "None.");
});

test("la segunda mirada no rehace el tie-out ni la transcripcion de escaneados", () => {
  const text = buildSecondLookInstructions({ returnType: "1120-S", issues: [] });
  assert.match(text, /Do not repeat, reword or re-verify them/);
  assert.match(text, /do not add SCANNED lines/);
  assert.match(text, /Leave tieOutResults, infoConsistency, checkboxReview and verifiedItems empty/);
  for (const family of Object.keys(CHECKLISTS)) assert.ok(CHECKLISTS[family].length >= 5, family);
});
