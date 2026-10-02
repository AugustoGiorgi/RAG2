"use strict";
// Las casillas leidas por codigo (lib/checkbox-inventory.js): las preguntas Si/No que anota
// pdfPageLines y las casillas marcadas con una X, comparadas contra el año anterior. Los
// cambios de una pregunta Si/No van al cuadro; lo que da igual se cuenta en la fila de alcance.
// Las casillas sueltas solo suman al conteo. Formularios y respuestas ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const { checkboxInventoryRows, yesNoQuestions, checkedBoxes, questionKey } = require("../lib/checkbox-inventory");

function fakeReturn(year, { form1099 = "No", cash = false } = {}) {
  return [
    `Form 1040 ${year} U.S. Individual Income Tax Return`,
    "Filing Status Check only X Married filing jointly (even if only one had income)",
    `Digital Assets At any time during ${year}, did you receive or sell a digital asset? . . . . Yes X No [ANSWER: No]`,
    `A Did you make any payments in ${year} that would require you to file Form(s) 1099? . . . . X [ANSWER: ${form1099}]`,
    "B If you did, did you file all required Forms 1099?",
    "Yes X No [ANSWER: Yes]",
    "your spouse lived [ANSWER: No]",
    "Mark an X in one box for each spouse",
    "X SHORT-TERM GAIN STATEMENT DETAIL",
    "LINE 3 X .9% 1,200.",
    "Type of account: X Checking Savings",
    cash ? "F Accounting method: (1) X Cash (2) Accrual (3) Other (specify)" : "",
  ].join("\n");
}
const file = (name, text, role) => ({ name, text, fullText: text, reviewRole: role });
const pack = (current, prior) => [file("2025.pdf", current, "current_return"), file("2024.pdf", prior, "prior_return")];

test("las preguntas Si/No se leen con su respuesta; las lineas sin pregunta no", () => {
  const questions = yesNoQuestions(fakeReturn(2025));
  assert.deepStrictEqual(questions.map((q) => q.answer), ["No", "No", "Yes"]);
  assert.match(questions[2].label, /^B If you did, did you file all required Forms 1099\?/, "la pregunta de la linea de arriba se junta");
});

test("una casilla marcada se lee; la X de las instrucciones, las mayusculas y las cuentas no", () => {
  const labels = checkedBoxes(fakeReturn(2025, { cash: true })).map((b) => b.label);
  assert.deepStrictEqual(labels, [
    "Married filing jointly (even if only one had", // el rotulo se corta en ocho palabras
    "Checking Savings",
    "Cash (2) Accrual (3) Other (specify)",
  ]);
});

test("lo que da igual que el año anterior se cuenta en la fila de alcance, sin filas de cambio", () => {
  const rows = checkboxInventoryRows(pack(fakeReturn(2025), fakeReturn(2024)), { taxYear: "2025" });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].box, "Boxes verified by code (same as the prior year)");
  assert.strictEqual(rows[0].currentState, "5", "3 preguntas y 2 casillas iguales");
  assert.match(rows[0].explanation, /3 Yes\/No question\(s\) and 2 marked box\(es\)/);
});

test("una respuesta que cambio va al cuadro para confirmar", () => {
  const rows = checkboxInventoryRows(pack(fakeReturn(2025, { form1099: "Yes" }), fakeReturn(2024)), { taxYear: "2025" });
  assert.strictEqual(rows.length, 2);
  assert.match(rows[0].box, /^A Did you make any payments in 2025 that would require you to file Form\(s\) 1099\?/);
  assert.deepStrictEqual([rows[0].currentState, rows[0].shouldBe], ["Yes", "No (prior year) — confirm"]);
  assert.strictEqual(rows[1].currentState, "4");
});

test("lo nuevo este año se lee pero no se compara, y nunca es una fila de cambio", () => {
  const rows = checkboxInventoryRows(pack(fakeReturn(2025, { cash: true }), fakeReturn(2024)), { taxYear: "2025" });
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0].explanation, /1 more read with nothing to compare against/);
});

test("sin declaracion del año anterior no hay nada que comparar", () => {
  assert.deepStrictEqual(checkboxInventoryRows([file("2025.pdf", fakeReturn(2025), "current_return")], { taxYear: "2025" }), []);
});

test("la misma pregunta se reconoce en los dos años aunque cambie el año impreso", () => {
  assert.strictEqual(
    questionKey("A Did you make any payments in 2025 that would require you to file Form(s) 1099?"),
    questionKey("A Did you make any payments in 2024 that would require you to file Form(s) 1099?"),
  );
});
