"use strict";
// Cruces validados sobre un Form 1120 real de dos años.
//
// El 1120 era el tipo con menos cobertura de la biblioteca: no comparte nada con las formas
// de K-1 y M-2 que leen los cheques de sociedades, y una corrida a ciegas sobre un paquete
// corporativo saco menos de un tercio de lo que encontro la revision manual. Cuatro de los
// seis necesitan el año anterior o el workpaper, y ese es justo el punto: un 1120 equivocado
// suele estarlo de un modo que solo se ve poniendo este año al lado del anterior, o la
// declaracion al lado de los libros. En la cara de la declaracion no se nota nada.
//
// Entidades, personas y montos ficticios; el layout es el que produce pdf.js en produccion.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  runCorporateReturnChecks, checkContributionsThroughRetainedEarnings,
  checkScheduleM1TiesToBooks, checkAmortizationAgainstBooks,
  checkShareholderLoansMisclassified, checkLoanToShareholder,
  checkApportionmentSwing, apportionmentFactors, scheduleGOwners,
} = require("../lib/corporate-return-checks");

const RETURN_1120 = ({
  m1Books = "-1,240,806.", paidInBegin = "2,200,000.", paidInEnd = "2,200,000.",
  contributions = "1,650,400.", accumBegin = "88,400.", accumEnd = "191,900.",
  loans19 = "", njFactor = ".214500", nycFactor = "1.8400",
} = {}) => `
U.S. Corporation Income Tax Return
SCHEDULE G Information on Certain Persons Owning the Corporation's Voting Stock
DARIA VOSKUIJLEN 412-77-9031 UNITED STATES 61.00%
THEO MARCHETTI 388-04-2216 UNITED STATES 39.00%
13 a Intangible assets (amortizable only) . . . . . . . . . 305,000. 305,000.
b Less accumulated amortization . . . . . . . . . ( ${accumBegin} ) 216,600. ( ${accumEnd} ) 113,100.
18 Other current liabilities (attach stmt) . . . . . . . . SEE ST 6 402,100. 517,300.
19 Loans from shareholders . . . . . . . . . . . . . . . . . . . ${loans19}
23 Additional paid-in capital . . . . . . . . . . . . . . . . . . . ${paidInBegin} ${paidInEnd}
Schedule M-1 Reconciliation of Income (Loss) per Books With Income per Return
1 Net income (loss) per books . . . . . . . . . . . . . . . . ${m1Books} 7 Income recorded on books this year not
Schedule M-2 Analysis of Unappropriated Retained Earnings per Books (Schedule L, Line 25)
3 Other increases (itemize): 6 Other decreases (itemize):
STATEMENT 7 ${contributions} 7 Add lines 5 and 6 . . . . . . . . . . .
STATEMENT 5
FORM 1120, SCHEDULE L, LINE 14
OTHER ASSETS
BEGINNING ENDING
LOAN RECEIVABLE - DARIA . . . . . . . . . . . . . . . . 150,000. 150,000.
SECURITY DEPOSIT . . . . . . . . . . . . . . . . . . . . 4,000. 4,000.
TOTAL $ 154,000. $ 154,000.
STATEMENT 6
FORM 1120, SCHEDULE L, LINE 18
OTHER CURRENT LIABILITIES
BEGINNING ENDING
CREDIT CARD . . . . . . . . . . . . . . . . . . . . . . . 8,100. 3,200.
LOAN PAYABLE - DARIA . . . . . . . . . . . . . . . . . . 210,000. 289,100.
LOAN PAYABLE - THEO . . . . . . . . . . . . . . . . . . . 184,000. 225,000.
TOTAL $ 402,100. $ 517,300.
STATEMENT 7
FORM 1120, SCHEDULE M-2, LINE 3
OTHER INCREASES
CONTRIBUTIONS . . . . . . . . . . . . . . . . . . . . . .
TOTAL $ ${contributions}
8 Allocation Factor (Percentage in New Jersey) (Divide line 6 by line 7). Carry the fraction 6 decimal places.
Do not express as a percent. Include here and on Schedule A, Part II, line 18 . . . . . . . 8 ${njFactor}
SCHEDULE F, Part 3 - Enter your business allocation percentage either from Part 1 or Part 2.
If a factor is missing, divide line 4 by the total of the weights of the factors present . . . ${nycFactor} %
${"linea de relleno para el largo minimo. ".repeat(20)}`;

const PRIOR_1120 = RETURN_1120({
  m1Books: "-980,110.", paidInBegin: "1,100,000.", paidInEnd: "2,200,000.",
  contributions: "", accumBegin: "42,300.", accumEnd: "88,400.",
  njFactor: "1.000000", nycFactor: "3.6800",
});

const WORKBOOK = {
  name: "Cliente_Profit and Loss.xlsx",
  reviewRole: "supporting_document",
  fullText: `--- Sheet: Sheet1 ---
Cliente Corporation
Profit and Loss
January-December, 2025
,Jan 1 - Dec 31 2025,Jan 1 - Dec 31 2024 (PY)
Total for Expenses,1290400,1010220
Net Operating Income,-1179450,-901000
Other Expenses
Amortization expenses,46100,46100
Net Income,-1240806.40,-980110.22`,
};

const filesFor = (current, prior, extra = [WORKBOOK]) => [
  { name: "Cliente 1120 2025.pdf", reviewRole: "current_return", fullText: current },
  ...(prior ? [{ name: "Cliente 1120 2024.pdf", reviewRole: "prior_return", fullText: prior }] : []),
  ...extra,
];

/* --- 1. Aportes por resultados acumulados ------------------------------- */

test("aportes de accionistas pasados por el M-2", () => {
  const finding = checkContributionsThroughRetainedEarnings(RETURN_1120());
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /\$1,650,400\.00/);
  assert.match(finding.detail, /\$2,200,000\.00/);
});

test("si el capital integrado se movio, el M-2 llevaba otra cosa", () => {
  // Un aporte registrado donde va no deja el capital integrado quieto.
  const movido = RETURN_1120({ paidInEnd: "3,850,400." });
  assert.strictEqual(checkContributionsThroughRetainedEarnings(movido), null);
});

test("sin statement de la linea 3 no hay nada que mirar", () => {
  const sinStatement = RETURN_1120().replace(/FORM 1120, SCHEDULE M-2, LINE 3/, "FORM 1120, SCHEDULE M-2, LINE 6");
  assert.strictEqual(checkContributionsThroughRetainedEarnings(sinStatement), null);
});

/* --- 2. M-1 linea 1 contra los libros ----------------------------------- */

test("el M-1 linea 1 no es el resultado contable", () => {
  const roto = RETURN_1120({ m1Books: "-1,315,443." });
  const finding = checkScheduleM1TiesToBooks(roto, [WORKBOOK]);
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /-\$1,315,443\.00/);
  assert.match(finding.detail, /-\$1,240,806\.40/);
});

test("unos pesos de redondeo no son un hallazgo", () => {
  // Las declaraciones van en dolares enteros y los libros traen centavos.
  assert.strictEqual(checkScheduleM1TiesToBooks(RETURN_1120(), [WORKBOOK]), null);
});

test("sin P&L no se inventa una diferencia", () => {
  assert.strictEqual(checkScheduleM1TiesToBooks(RETURN_1120({ m1Books: "-999,999." }), []), null);
  const soloBalance = { name: "bs.xlsx", reviewRole: "supporting_document", fullText: "--- Sheet: Sheet1 ---\nBalance Sheet\nNet Income,-1240806.40" };
  assert.strictEqual(checkScheduleM1TiesToBooks(RETURN_1120({ m1Books: "-999,999." }), [soloBalance]), null);
});

/* --- 3. Amortizacion contra los libros ---------------------------------- */

test("la declaracion amortiza mas que los libros", () => {
  // Schedule L mueve la acumulada 103,500; los libros registran 46,100.
  const finding = checkAmortizationAgainstBooks(RETURN_1120(), [WORKBOOK]);
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /\$103,500\.00/);
  assert.match(finding.detail, /\$46,100\.00/);
  assert.match(finding.detail, /\$57,400\.00/);
});

test("si coinciden, se calla", () => {
  const igual = RETURN_1120({ accumEnd: "134,500." });
  assert.strictEqual(checkAmortizationAgainstBooks(igual, [WORKBOOK]), null);
});

test("sin renglon de amortizacion en los libros no hay comparacion", () => {
  const sinAmort = { ...WORKBOOK, fullText: WORKBOOK.fullText.replace(/Amortization expenses,[^\n]*\n/, "") };
  assert.strictEqual(checkAmortizationAgainstBooks(RETURN_1120(), [sinAmort]), null);
});

/* --- 4 y 5. Prestamos con los accionistas ------------------------------- */

test("lee los duenos del Schedule G", () => {
  assert.deepStrictEqual(scheduleGOwners(RETURN_1120()), ["DARIA VOSKUIJLEN", "THEO MARCHETTI"]);
});

test("prestamos de accionistas metidos en otros pasivos", () => {
  const finding = checkShareholderLoansMisclassified(RETURN_1120());
  assert.ok(finding);
  assert.strictEqual(finding.severity, "MEDIUM");
  assert.match(finding.detail, /LOAN PAYABLE - DARIA/);
  assert.match(finding.detail, /LOAN PAYABLE - THEO/);
  assert.match(finding.detail, /\$514,100\.00/);
  // La tarjeta de credito no es de un accionista.
  assert.doesNotMatch(finding.detail, /CREDIT CARD/);
});

test("si la linea 19 ya trae algo, el preparador sabe que existe", () => {
  assert.strictEqual(checkShareholderLoansMisclassified(RETURN_1120({ loans19: "514,100." })), null);
});

test("prestamo de la sociedad a su propio accionista", () => {
  const finding = checkLoanToShareholder(RETURN_1120());
  assert.ok(finding);
  assert.match(finding.detail, /LOAN RECEIVABLE - DARIA/);
  assert.match(finding.detail, /\$150,000\.00/);
  // El deposito en garantia no es un prestamo a nadie.
  assert.doesNotMatch(finding.detail, /SECURITY DEPOSIT/);
});

test("sin Schedule G no se adivina quien es accionista", () => {
  const sinG = RETURN_1120().replace(/^DARIA VOSKUIJLEN.*$/m, "").replace(/^THEO MARCHETTI.*$/m, "");
  assert.strictEqual(checkShareholderLoansMisclassified(sinG), null);
  assert.strictEqual(checkLoanToShareholder(sinG), null);
});

/* --- 6. Factores de asignacion ------------------------------------------ */

test("lee los factores por jurisdiccion y descarta el resto de la pagina", () => {
  const factors = apportionmentFactors(RETURN_1120());
  assert.strictEqual(factors.get("New Jersey").percent, 21.45);
  assert.strictEqual(factors.get("New York City").percent, 1.84);
  // Numeros de linea, de pagina y texto de instrucciones no son factores.
  assert.strictEqual(factors.size, 2);
});

test("un factor que se movio fuerte contra el anio anterior", () => {
  const finding = checkApportionmentSwing(RETURN_1120(), PRIOR_1120, "2024");
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /New Jersey went from 100\.00% to 21\.45%/);
  assert.match(finding.detail, /New York City went from 3\.68% to 1\.84%/);
});

test("un movimiento chico no es una pregunta", () => {
  const casiIgual = RETURN_1120({ njFactor: "0.960000", nycFactor: "3.5000" });
  const previo = RETURN_1120({ njFactor: "1.000000", nycFactor: "3.6800" });
  assert.strictEqual(checkApportionmentSwing(casiIgual, previo, "2024"), null);
});

test("sin declaracion anterior no se compara nada", () => {
  assert.strictEqual(checkApportionmentSwing(RETURN_1120(), null, "2024"), null);
});

/* --- entrada ------------------------------------------------------------ */

test("de punta a punta sobre el paquete corporativo", () => {
  const findings = runCorporateReturnChecks(filesFor(RETURN_1120({ m1Books: "-1,315,443." }), PRIOR_1120), { returnType: "1120", taxYear: "2025" });
  assert.strictEqual(findings.length, 6);
  assert.strictEqual(findings.filter((f) => f.severity === "HIGH").length, 4);
});

test("no corre sobre declaraciones que no son corporativas", () => {
  assert.deepStrictEqual(runCorporateReturnChecks(filesFor(RETURN_1120()), { returnType: "1065" }), []);
  // Y sin el encabezado del 1120 tampoco, aunque no venga declarado el tipo.
  const sinEncabezado = RETURN_1120().replace("U.S. Corporation Income Tax Return", "U.S. Return of Partnership Income");
  assert.deepStrictEqual(runCorporateReturnChecks(filesFor(sinEncabezado), {}), []);
});

test("un paquete sin declaracion legible no produce nada", () => {
  assert.deepStrictEqual(runCorporateReturnChecks([], {}), []);
  assert.deepStrictEqual(runCorporateReturnChecks(null, {}), []);
});
