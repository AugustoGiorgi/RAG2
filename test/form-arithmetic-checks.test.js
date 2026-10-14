"use strict";
// La cuenta que cada renglon imprime en su rotulo, hecha con los importes de la misma pagina
// (lib/form-arithmetic-checks.js). Formularios, renglones y cifras ficticios; el formato de cada
// renglon es el que deja pdf.js en las declaraciones reales: "@ 7 1,250,000" en los estatales de
// Nueva York, "7e. 1,250,000" en los de la ciudad, "24 50,000." en los federales.
const { test } = require("node:test");
const assert = require("node:assert");
const { runFormArithmeticChecks, checkPrintedArithmetic, arithmeticErrorsOnPage, formOfPage, tailOf } = require("../lib/form-arithmetic-checks");

const PAD = "Filler text so the return clears the minimum length. ".repeat(12);

const nolPage = ({ seven = "1,250,000", sevenB = "2,050,000", sevenD = "" } = {}) => [
  "--- Page 40 ---",
  "Department of Taxation and Finance",
  "Net Operating Loss Deduction (NOLD)",
  "CT-3.4",
  "5a NOL carryforward from prior year's Form CT-3.4 . . . . . . . . . . @ 5a 1,250,000",
  "5 Total NOLs available to be used in the current tax year (subtract line 5g from line 5d) . . . @ 5 1,250,000",
  "5f NOL carryforwards unavailable for use in the current tax year . . . . @ 5f",
  "6 NOL to be used in the current tax year . . . . . . . . . . . . . . @ 6 0",
  "7a NOL incurred in the current tax year ( if applicable, complete Worksheet for line 7a) . . . @ 7a 800,000",
  `7b Net NOLs available (add lines 5, 5f, and 7a) . . . . . . . . . . . @ 7b ${sevenB}`,
  `7d Add lines 6 and 7c . . . . . . . . . . . . . . . . . . . . . . . @ 7d ${sevenD}`.trimEnd(),
  `7 NOL available to be carried forward (subtract line 7d from 7b) . . . . . @ 7 ${seven}`,
].join("\n");

test("un arrastre que no hace la resta que su propio rotulo pide", () => {
  const [error] = arithmeticErrorsOnPage(nolPage());
  assert.deepStrictEqual({ line: error.line, printed: error.printed, computed: error.computed }, { line: "7", printed: 1250000, computed: 2050000 });
  const [f] = checkPrintedArithmetic(`${nolPage()}\n${PAD}`);
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /^CT-3\.4 line 7 prints \$1,250,000 where its own instruction \("subtract line 7d from 7b"\) gives \$2,050,000\.$/);
  assert.match(f.evidence, /CT-3\.4 line 7, page 40/);
  assert.deepStrictEqual(arithmeticErrorsOnPage(nolPage({ seven: "2,050,000" })), [], "hecha bien, nada");
  // La 7b mal sumada tambien se ve: 1,250,000 + 800,000.
  assert.strictEqual(arithmeticErrorsOnPage(nolPage({ sevenB: "2,000,000", seven: "2,000,000" }))[0].line, "7b");
});

test("los renglones federales: importe despues del numero repetido, con su punto", () => {
  const page = [
    "--- Page 2 ---",
    "Form 1040 (2025) Page 2",
    "22 Subtract line 21 from line 18. If zero or less, enter -0- . . . . . 22 6,500.",
    "23 Other taxes, including self-employment tax, from Schedule 2, line 21 . . . 23 1,200.",
    "24 Add lines 22 and 23. This is your total tax . . . . . . . . . 24 7,900.",
  ].join("\n");
  const [error] = arithmeticErrorsOnPage(page);
  assert.deepStrictEqual({ line: error.line, computed: error.computed, printed: error.printed }, { line: "24", computed: 7700, printed: 7900 });
  assert.strictEqual(formOfPage(page), "1040");
  assert.deepStrictEqual(arithmeticErrorsOnPage(page.replace("24 7,900.", "24 7,700.")), []);
  assert.deepStrictEqual(arithmeticErrorsOnPage(page.replace("24 7,900.", "24 7,701.")), [], "un dolar es redondeo");
});

test("lo que la cuenta simple no cubre no se afirma", () => {
  // Topes, condiciones y rangos.
  const capped = ["--- Page 3 ---", "9 Tentative deduction . . . . 9 50,000.", "10 Carryover from last year . . . . 10 47,500.", "12 Section 179 expense deduction. Add lines 9 and 10, but don't enter more than line 11 . . . 12 0."].join("\n");
  assert.deepStrictEqual(arithmeticErrorsOnPage(capped), []);
  const range = ["--- Page 3 ---", "3 Gross profit . . . . 3 10,000.", "10 Other income . . . . 10 500.", "11 Total income. Add lines 3 through 10 . . . . 11 9,000."].join("\n");
  assert.deepStrictEqual(arithmeticErrorsOnPage(range), [], "un rango puede incluir renglones que no se leyeron");
  // Todos los citados en blanco: el formulario se lleno desde una hoja de trabajo (el 8606 lo hace).
  const worksheet = ["--- Page 4 ---", "11 Multiply line 8 by line 10 . . . . 11", "12 Multiply line 7 by line 10 . . . . 12", "13 Add lines 11 and 12. This is the nontaxable portion . . . . 13 576."].join("\n");
  assert.deepStrictEqual(arithmeticErrorsOnPage(worksheet), []);
  // Un resultado negativo impreso como cero es el "if zero or less, enter -0-".
  const floor = ["--- Page 5 ---", "3 Investment interest . . . . 3 2,000.", "6 Net investment income . . . . 6 9,000.", "7 Disallowed interest to be carried forward. Subtract line 6 from line 3 . . . . 7 0."].join("\n");
  assert.deepStrictEqual(arithmeticErrorsOnPage(floor), []);
  // Un renglon citado que esta despues del resultado, o dos veces en la pagina, no se usa.
  const twice = ["--- Page 6 ---", "1 Wages . . . . 1 5,000.", "2 Tips . . . . 2 100.", "3 Add lines 1 and 2 . . . . 3 9,999.", "1 Wages (spouse) . . . . 1 3,000."].join("\n");
  assert.deepStrictEqual(arithmeticErrorsOnPage(twice), []);
});

test("el importe de un renglon: con el numero repetido, en blanco o ilegible", () => {
  assert.deepStrictEqual(tailOf("7e NOL available (subtract line 7d from 7b) . . . 7e. 1,250,000", "7e"), { blank: false, value: 1250000 });
  assert.deepStrictEqual(tailOf("7d Add lines 6 and 7c . . . . @ 7d", "7d"), { blank: true, value: 0 });
  assert.deepStrictEqual(tailOf("28 Taxable income . . . 28 -1,250,000.", "28"), { blank: false, value: -1250000 });
  assert.deepStrictEqual(tailOf("14 Long-term capital loss carryover . . . 14 ( 4,000. )", "14"), { blank: false, value: -4000 });
  assert.strictEqual(tailOf("2a Tax-exempt interest . . 2a 1,258. b Taxable interest . . 2b 5,623.", "2a"), null, "dos columnas: no se adivina");
});

test("el modulo corre solo sobre la declaracion del año y nunca revienta", () => {
  const files = [
    { name: "2025.pdf", reviewRole: "current_return", text: `${nolPage()}\n${PAD}` },
    { name: "2024.pdf", reviewRole: "prior_return", text: `${nolPage({ seven: "9" })}\n${PAD}` },
  ];
  const found = runFormArithmeticChecks(files, { taxYear: "2025" });
  assert.strictEqual(found.length, 1);
  assert.match(found[0].detail, /\$1,250,000/);
  assert.deepStrictEqual(runFormArithmeticChecks([], {}), []);
  assert.deepStrictEqual(runFormArithmeticChecks([{ reviewRole: "current_return", text: "corto" }], {}), []);
});
