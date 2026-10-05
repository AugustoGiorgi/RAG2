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

/* --- Segunda lectura ---------------------------------------------------------
 * Las formas de casilla que la primera lectura dejaba afuera, tal como las imprime pdf.js
 * sobre una declaracion real, y al lado las X que no son marcas. Todo ficticio. */

function secondLook(year, { designee = "Yes X No Email:" } = {}) {
  return [
    `Form 1040 ${year} U.S. Individual Income Tax Return`,
    // La X despues del rotulo; delante, texto de otra columna (la direccion).
    `100 EXAMPLE ROAD the U.S. for more than half of ${year} . . . . . X`,
    "c If you do not want to claim the EIC, check here . . . . . . . . . . . . X",
    // Un rotulo de una palabra, y una segunda X (de otra columna) cerrando el renglon.
    "A Filing 1 X Single X",
    designee,
    // La respuesta en un renglon con texto de la otra columna; la pregunta termina debajo.
    "Married filing joint return",
    "X in one 2 Yes No X [ANSWER: No]",
    `(enter spouse's Social Security number above) quarters in Sampletown for any part of ${year}?`,
    // Nada de esto es una marca.
    "If received as a beneficiary, mark an X",
    "in the box . . . . . . 9 .00",
    "See the Tax Rate Schedule X",
    "Part X",
    "penalty: amount on line 10 X before 4/15/26",
    "JANE EXAMPLE X",
    "X",
  ].join("\n");
}

test("segunda lectura: la X despues del rotulo y el rotulo de una palabra con su contexto", () => {
  assert.deepStrictEqual(checkedBoxes(secondLook(2025)).map((b) => b.key), [
    "^ for more than half of",
    "^ to claim the eic check here",
    "a filing ^ single",
    "yes ^ no email",
  ]);
});

test("segunda lectura: 'Yes X No' y 'Yes No X' son respuestas distintas, no la misma casilla", () => {
  const [yes] = checkedBoxes("Yes X No Email:");
  const [no] = checkedBoxes("Yes No X Email:");
  assert.notStrictEqual(yes.key, no.key);
  const rows = checkboxInventoryRows(pack(secondLook(2025, { designee: "Yes No X Email:" }), secondLook(2024)), { taxYear: "2025" });
  assert.match(rows[rows.length - 1].explanation, /1 Yes\/No question\(s\) and 3 marked box\(es\)\. 1 more read with nothing to compare/);
});

test("segunda lectura: la pregunta que termina en el renglon de abajo de su respuesta", () => {
  const [q] = yesNoQuestions(secondLook(2025));
  assert.strictEqual(q.answer, "No");
  assert.match(q.label, /quarters in Sampletown for any part of 2025\?$/);
  // Si el renglon de abajo trae su propia respuesta, es otra pregunta y no se toma prestado.
  const two = yesNoQuestions(["X in one 2 Yes No X [ANSWER: No]", "Did you live in Sampletown during the year? . . . Yes X No [ANSWER: Yes]"].join("\n"));
  assert.deepStrictEqual(two.map((x) => x.answer), ["Yes"]);
});

test("segunda lectura: lo que da igual que el año anterior suma, sin filas de cambio", () => {
  const rows = checkboxInventoryRows(pack(secondLook(2025), secondLook(2024)), { taxYear: "2025" });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].currentState, "5", "1 pregunta y 4 casillas");
  assert.match(rows[0].explanation, /1 Yes\/No question\(s\) and 4 marked box\(es\)\.$/);
});

test("la misma pregunta se empareja aunque un año arranque con el rotulo del margen", () => {
  // Un archivo de menos de 500 caracteres no se toma como declaracion: se rellena.
  const filler = "Statement filler text for a return of normal length.\n".repeat(12);
  const form = (year, line) => `Form 1040 ${year} U.S. Individual Income Tax Return\n${line}\n${filler}`;
  const ask = (prefix, answer) => `${prefix}exchange, or otherwise dispose of a digital asset (or a financial interest in a digital asset)? (See instructions.) . . . Yes X No [ANSWER: ${answer}]`;
  const same = checkboxInventoryRows(pack(form(2025, ask("Digital Assets ", "No")), form(2024, ask("", "No"))), { taxYear: "2025" });
  assert.match(same[0].explanation, /1 Yes\/No question\(s\) and 0 marked box\(es\)\.$/, "emparejada: no queda como 'sin comparar'");
  const changed = checkboxInventoryRows(pack(form(2025, ask("Digital Assets ", "Yes")), form(2024, ask("", "No"))), { taxYear: "2025" });
  assert.deepStrictEqual([changed[0].currentState, changed[0].shouldBe], ["Yes", "No (prior year) — confirm"]);
  // Dos preguntas distintas no se emparejan por terminar parecido en dos palabras.
  const other = checkboxInventoryRows(pack(
    form(2025, "Did you sell your main home during the tax year? . . Yes X No [ANSWER: No]"),
    form(2024, "Did you buy a second home during the tax year? . . Yes X No [ANSWER: No]"),
  ), { taxYear: "2025" });
  assert.deepStrictEqual(other, [], "sin par no hay nada verificado");
});

test("dos columnas: la tilde que ya respondio la pregunta de abajo no se cuenta ademas como casilla", () => {
  // El lector le dio esa tilde a la pregunta del renglon de abajo (ver pdf-page-lines.test.js).
  const text = [
    "X Sampletown, and Otherville) during 2025? . . . . . Yes No",
    "on another taxpayer's federal return? . . . . Yes No [ANSWER: No]",
  ].join("\n");
  assert.deepStrictEqual(checkedBoxes(text), []);
  assert.strictEqual(yesNoQuestions(text).length, 1, "se cuenta una vez, como pregunta");
  // Con el texto del lector anterior (sin la respuesta abajo) se sigue contando como antes.
  assert.strictEqual(checkedBoxes(text.replace(" [ANSWER: No]", "")).length, 1);
  // Y si el renglon de abajo tiene su propia X, la de arriba es otra casilla.
  const own = ["X Sampletown, and Otherville) during 2025? . . . . . Yes No", "Did you live there all year? . . Yes No X [ANSWER: No]"].join("\n");
  assert.strictEqual(checkedBoxes(own).length, 1);
});
