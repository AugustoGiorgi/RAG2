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
  checkApportionmentOutOfRange, lastAmount, checkStateBalanceSheets, checkStateBusinessIncome,
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

/* --- El balance de la copia estatal --------------------------------------- */

function balance(assets, equity, footer) {
  return [
    "--- Page 5 ---",
    "Schedule L Balance Sheets",
    `14 Total assets . . . . . . . . . . 900,000. ${assets}`,
    "21 Partners' capital accounts . . . . . . 400,000. 500,000.",
    `22 Total liabilities and capital . . . . . 900,000. ${equity}`,
    footer,
  ].join("\n");
}

test("el balance estatal que no cuadra se marca con su formulario", () => {
  const text = [balance("1,000,000.", "1,000,000.", "Form 1065 (2025) Page 5"), balance("1,000,000.", "1,040,000.", "EXAMPLE 000 Form 568 2025 Page 6")].join("\n");
  const f = checkStateBalanceSheets(text);
  assert.match(f.title, /Form 568/);
  assert.match(f.detail, /closes with \$1,000,000 of assets against \$1,040,000 of liabilities and capital, out by \$40,000/);
});

test("el federal no se mira aca, y un estatal que cuadra no dice nada", () => {
  const soloFederal = balance("1,000,000.", "1,040,000.", "Form 1065 (2025) Page 5");
  assert.strictEqual(checkStateBalanceSheets(soloFederal), null, "el federal lo cubre entity-return-checks");
  const estatalBien = [balance("1,000,000.", "1,040,000.", "Form 1065 (2025) Page 5"), balance("1,000,000.", "1,000,000.", "Form 568 2025 Page 6")].join("\n");
  assert.strictEqual(checkStateBalanceSheets(estatalBien), null);
});


/* --- Una categoria de ingreso del federal contra la misma en la estatal ------ */

const conNuevaJersey = (federal, estatal, tipo = "S", linea = "22. Net pro rata share of S Corporation Income (Schedule NJ-BUS-1, Part III, line 4)") => [
  "28 (a) Name (b) Enter P for partnership; S for S corporation (d) Employer identification number",
  `A EXAMPLE HOLDINGS LLC ${tipo} 98-7654321 X`,
  `32 Total partnership and S corporation income or (loss). Combine lines 30 and 31 . . . . 32 ${federal}`,
  "NEW JERSEY: NJ-1040, SCH NJ-HCC, NJ-BUS-1",
  `${linea} 22. ${estatal} .`,
].join("\n");

test("la misma categoria de ingreso, distinta en el federal y en Nueva Jersey", () => {
  const f = checkStateBusinessIncome(conNuevaJersey("465,181.", "462564"));
  assert.match(f.detail, /New Jersey line 22 \(net pro rata share of S corporation income\) reports \$462,564, against \$465,181 on federal Schedule E line 32/);
  assert.match(f.detail, /difference of \$2,617/);
  assert.strictEqual(checkStateBusinessIncome(conNuevaJersey("465,181.", "465181")), null, "la misma cifra no dice nada");
  assert.strictEqual(checkStateBusinessIncome(conNuevaJersey("465,181.", "465100")), null, "una diferencia de redondeo tampoco");
});

test("con sociedades y S corps mezcladas no se puede atribuir la cifra federal", () => {
  const mezcla = conNuevaJersey("465,181.", "462564") + "\nB OTHER EXAMPLE LP P 11-1111111 X";
  assert.strictEqual(checkStateBusinessIncome(mezcla), null);
  assert.strictEqual(checkStateBusinessIncome(conNuevaJersey("465,181.", "462564", "P")), null, "la linea 22 es de S corps, no de sociedades");
  // El renglon 32 vacio imprime solo su numero: leerlo como $32 daria una diferencia falsa.
  assert.strictEqual(checkStateBusinessIncome(conNuevaJersey("", "462564")), null);
});

/* --- Nueva York: MCTMT del autonomo -------------------------------------------- */

// El Schedule SE y el IT-201 como los imprime pdf.js: el importe de la linea 4c en el renglon
// de la excepcion, y las lineas 54a-54e con ".00" suelto cuando estan en blanco.
const scheduleSE = (net) => [
  "SCHEDULE SE Self-Employment Tax",
  "c Combine lines 4a and 4b. If less than $400, stop; you don't owe self-employment tax.",
  `Exception: If less than $400 and you had church employee income, enter -0- and continue . . . . . . 4c ${net}`,
].join("\n");
const it201 = ({ year = 2025, months = "12", cityTax = "9000", l54a = "", l54e = "" } = {}) => [
  "IT-201 Resident Income Tax Return",
  "F NYC residents and NYC part-year residents only :",
  `(1) Number of months you lived in NYC in ${year} . . . . . . . . . . ${months}`.trimEnd(),
  `(2) Number of months your spouse lived in NYC in ${year}`,
  `Page 3 of 4 IT-201 (${year})`,
  "47 NYC taxable income . . . . . . . . . . . . . 47 250000 .00",
  `47a 47a ${cityTax} .00`.replace("  ", " "),
  "54a MCTMT net earnings",
  `base for Zone 1 . . . 54a ${l54a} .00`.replace("  ", " "),
  "54b MCTMT net earnings",
  "base for Zone 2 . . . 54b .00",
  "54c MCTMT for Zone 1 . . . . . . . . . . . . . 54c .00",
  "54d MCTMT for Zone 2 . . . . . . . . . . . . . 54d .00 See instructions to calculate",
  `54e Total MCTMT (add lines 54c and 54d) . . . . . . . 54e ${l54e} .00 the MCTMT for each zone.`.replace("  ", " "),
].join("\n");

test("Nueva York: ganancias de autoempleo sobre el umbral con las lineas del MCTMT en blanco", () => {
  const { checkNewYorkMctmt } = require("../lib/state-return-checks");
  const f = checkNewYorkMctmt(`${scheduleSE("200,000.")}\n${it201()}`, { taxYear: "2025" });
  assert.strictEqual(f.severity, "MEDIUM");
  assert.match(f.detail, /^Schedule SE shows \$200,000 of net earnings from self-employment for a New York City resident, and Form IT-201 lines 54a-54e \(MCTMT\) are blank\. If the business is carried on in the city the tax is about \$1,200 \(0\.6% in Zone 1, owed once the earnings pass \$50,000\)\.$/);
  assert.ok(f.detail.length <= 320);
});

test("Nueva York: el MCTMT ya calculado, por debajo del umbral o fuera de la ciudad no dice nada", () => {
  const { checkNewYorkMctmt, mctmtRules } = require("../lib/state-return-checks");
  const meta = { taxYear: "2025" };
  assert.strictEqual(checkNewYorkMctmt(`${scheduleSE("200,000.")}\n${it201({ l54a: "200000", l54e: "1200" })}`, meta), null, "ya esta calculado");
  assert.strictEqual(checkNewYorkMctmt(`${scheduleSE("32,000.")}\n${it201()}`, meta), null, "no pasa el umbral");
  assert.strictEqual(checkNewYorkMctmt(`${scheduleSE("200,000.")}\n${it201({ months: "", cityTax: "" })}`, meta), null, "no es residente de la ciudad: no se sabe la zona");
  assert.strictEqual(checkNewYorkMctmt(it201(), meta), null, "sin Schedule SE no hay ganancias de autoempleo");
  assert.strictEqual(checkNewYorkMctmt(scheduleSE("200,000."), meta), null, "sin IT-201 no es de Nueva York");
  // Dos Schedule SE: el umbral es por persona.
  const two = checkNewYorkMctmt(`${scheduleSE("200,000.")}\n${scheduleSE("40,000.")}\n${it201()}`, meta);
  assert.match(two.detail, /\$200,000 of net earnings/);
  // Desde 2026 el umbral sube a $150,000; la tasa de la zona 1 cambio en 2023 y en 2024.
  assert.strictEqual(checkNewYorkMctmt(`${scheduleSE("120,000.")}\n${it201({ year: 2026 })}`, { taxYear: "2026" }), null);
  assert.deepStrictEqual([2022, 2023, 2024, 2026].map((y) => mctmtRules(y).zone1Rate), [0.0034, 0.0047, 0.006, 0.006]);
});
