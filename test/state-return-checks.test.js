"use strict";
// Cruces de declaraciones estatales, sin un parser por estado.
//
// Por que en codigo: los cruces deterministas leen el texto completo del paquete, sin pasar por
// el presupuesto de entrada ni por el techo de gasto. Sobre un paquete con doce estados el
// modelo alcanza a leer cuatro; el codigo lee los doce, siempre, y no cuesta nada.
//
// Estas pruebas fijan sobre todo el silencio. Escribiendo este modulo salieron cuatro falsos
// positivos sobre paquetes sanos, cada uno de una forma distinta, y los cuatro estan cubiertos
// abajo: el numero de casilla leido como porcentaje, los ultimos tres digitos de un importe
// leidos como porcentaje, una linea de adiciones leida como reexpresion del federal, y un
// formulario de dos columnas del que se leia la columna equivocada.
// Entidades, numeros y montos ficticios; el layout es el que produce pdf.js.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  runStateReturnChecks, checkStateFederalStartingFigure, checkStateIdentifiersAgainstFederal,
  checkApportionmentOutOfRange, lastAmount,
} = require("../lib/state-return-checks");

const FEDERAL_1040 = `
11 a Subtract line 10 from line 9. This is your adjusted gross income . . . . . . . . 11a 4,812,000.
`;
const ESTATAL_OK = `
FEDERAL ADJUSTED GROSS INCOME . . . . . . . . . . . . . . . . . . . . . . . . . . 4,812,000
13 Enter federal adjusted gross income (AGI) from federal Form 1040, line 11 . . 13 4,812,000.
`;
const ESTATAL_VIEJO = `
FEDERAL ADJUSTED GROSS INCOME . . . . . . . . . . . . . . . . . . . . . . . . . . 4,655,300
`;

const asPack = (text, returnType) => runStateReturnChecks(
  [{ name: "cur.pdf", reviewRole: "current_return", fullText: text, text }],
  { returnType, taxYear: "2025" }
);

test("una estatal que arranca del mismo AGI federal no dispara nada", () => {
  assert.strictEqual(checkStateFederalStartingFigure(FEDERAL_1040 + ESTATAL_OK, { returnType: "1040" }), null);
});

test("una estatal armada contra un federal viejo si se reporta", () => {
  const found = checkStateFederalStartingFigure(FEDERAL_1040 + ESTATAL_VIEJO, { returnType: "1040" });
  assert.ok(found, "esperaba un hallazgo");
  assert.strictEqual(found.severity, "HIGH");
  assert.match(found.detail, /\$4,812,000/);
  assert.match(found.detail, /\$4,655,300/);
  assert.match(found.action, /redone rather than patched/);
});

test("las lineas de adiciones y sustracciones NO son la cifra federal", () => {
  // Falso positivo real: "2 Additions to federal adjusted gross income (from Schedule 1) 2 19375"
  // se leia como una reexpresion del AGI y se reportaba una diferencia de millones.
  const modificaciones = `
2 Additions to federal adjusted gross income (from Schedule 1, Line 40) 2 19375
4 Subtractions from federal adjusted gross income (from Schedule 1, Line 52) 4 4729
`;
  assert.strictEqual(checkStateFederalStartingFigure(FEDERAL_1040 + modificaciones, { returnType: "1040" }), null);
});

test("un formulario de dos columnas no se lee por la columna equivocada", () => {
  // "19 Federal adjusted gross income 19 4812000 .00 19 10030 .00": la primera columna es la
  // federal y la segunda la del estado. Tomando el ultimo importe se reportaba un desajuste.
  const dosColumnas = "\n19 Federal adjusted gross income (subtract line 18 from line 17) 19 4812000 .00 19 10030 .00\n";
  assert.strictEqual(checkStateFederalStartingFigure(FEDERAL_1040 + dosColumnas, { returnType: "1040" }), null);
});

test("una linea 'recomputed' no tiene por que coincidir", () => {
  const recomputado = "\nRECOMPUTED FEDERAL ADJUSTED GROSS INCOME . . . . . . . . . . . . 0\n";
  assert.strictEqual(checkStateFederalStartingFigure(FEDERAL_1040 + recomputado, { returnType: "1040" }), null);
});

test("sin poder leer la cifra federal no se opina", () => {
  assert.strictEqual(checkStateFederalStartingFigure(ESTATAL_VIEJO, { returnType: "1040" }), null);
});

test("un tipo de declaracion sin cifra unica de arranque no se toca", () => {
  assert.strictEqual(checkStateFederalStartingFigure(FEDERAL_1040 + ESTATAL_VIEJO, { returnType: "1120-S" }), null);
  assert.strictEqual(checkStateFederalStartingFigure(FEDERAL_1040 + ESTATAL_VIEJO, { returnType: "" }), null);
});

test("tambien funciona sobre un 1120, que arranca del ingreso gravable federal", () => {
  const federal = "\n30 Taxable income. Subtract line 29c from line 28. See instructions . . . 30 -4,333,026.\n";
  const estatalOk = "\n1 Federal taxable income (see instructions)\nAttach pages 1-6 of federal return Check here if negative X -4,333,026.\n";
  assert.strictEqual(checkStateFederalStartingFigure(federal + estatalOk, { returnType: "1120" }), null);
  const estatalMal = "\n1 Federal taxable income (see instructions) -3,900,000.\n";
  assert.ok(checkStateFederalStartingFigure(federal + estatalMal, { returnType: "1120" }));
});

/* --- Identificadores del encabezado ------------------------------------ */

const FEDERAL_HEADER = `
C Business code number F Total assets (see instructions)
722511 $ 937,579.
E Date business started
12/01/2010
`;

test("un encabezado estatal que coincide no dispara nada", () => {
  const estatal = `
Address (number and street) City NAICS business code number (from NYS Pub 910)
269 COLUMBUS AVE NEW YORK 722511
Date business started
12012010
`;
  assert.strictEqual(checkStateIdentifiersAgainstFederal(FEDERAL_HEADER + estatal), null);
});

test("un codigo NAICS distinto en la estatal se reporta", () => {
  const estatal = "\nNAICS business code number (from NYS Pub 910)\n722513\n";
  const found = checkStateIdentifiersAgainstFederal(FEDERAL_HEADER + estatal);
  assert.ok(found);
  assert.strictEqual(found.severity, "MEDIUM");
  assert.match(found.detail, /722511/);
  assert.match(found.detail, /722513/);
});

// La fecha de inicio se probo y se dejo afuera: "E Date business started" en el 1065 y
// "...Principal product or service Date business started" en el IT-204 no se distinguen con un
// patron de texto, asi que el valor "federal" terminaba siendo los dos y el cruce se apagaba
// solo. Un campo que no puede separar sus dos lados no es un cruce, es una ilusion de cruce.
test("un campo cuya etiqueta federal y estatal no se distinguen queda afuera", () => {
  const conFecha = "\nE Date business started\n12/01/2010\nPrincipal product or service Date business started\n03152014\n";
  assert.strictEqual(checkStateIdentifiersAgainstFederal(conFecha), null);
});

test("sin un valor federal claro no se compara nada", () => {
  const soloEstatal = "\nNAICS business code number\n722513\n";
  assert.strictEqual(checkStateIdentifiersAgainstFederal(soloEstatal), null);
});

/* --- Apportionment ------------------------------------------------------ */

test("el numero de la casilla no es un porcentaje", () => {
  // Falso positivo real, la cuarta vez que este repositorio tropieza con lo mismo:
  // una linea vacia reimprime su propio numero antes del campo.
  const casillaVacia = "126 Business allocation percentage (divide line 125 by three or by actual number of percentages if less than three) 126 %";
  assert.strictEqual(checkApportionmentOutOfRange(casillaVacia), null);
});

test("los ultimos digitos de un importe no son un porcentaje", () => {
  // Falso positivo real: de "... 5. 14,255" se leia 255%.
  const importe = "5 Multiply Line 4 by the business allocation percentage on Schedule E, Part 3, Line 2 . . . . . 5. 14,255";
  assert.strictEqual(checkApportionmentOutOfRange(importe), null);
});

test("un porcentaje normal no dispara nada", () => {
  assert.strictEqual(checkApportionmentOutOfRange("Business allocation percentage . . . . . . . 100 %"), null);
  assert.strictEqual(checkApportionmentOutOfRange("4 Apportionment fraction . . . . . . . 37.5 %"), null);
});

test("un porcentaje imposible si se reporta", () => {
  const found = checkApportionmentOutOfRange("Business allocation percentage . . . . . . . 143.5 %");
  assert.ok(found);
  assert.strictEqual(found.severity, "HIGH");
  assert.match(found.detail, /143\.5%/);
});

/* --- El runner ---------------------------------------------------------- */

test("sin declaracion corriente no devuelve nada", () => {
  assert.deepStrictEqual(runStateReturnChecks([], { returnType: "1040" }), []);
  assert.deepStrictEqual(runStateReturnChecks(null, {}), []);
});

test("un paquete sano no produce ningun hallazgo", () => {
  assert.deepStrictEqual(asPack(FEDERAL_1040 + ESTATAL_OK + FEDERAL_HEADER, "1040"), []);
});

test("un documento demasiado corto no se analiza", () => {
  assert.deepStrictEqual(asPack("nada", "1040"), []);
});

test("lastAmount ignora un año suelto pero no un importe", () => {
  assert.strictEqual(lastAmount("For calendar year 2025"), null);
  assert.strictEqual(lastAmount("Total . . . 1,234,567."), 1234567);
});
