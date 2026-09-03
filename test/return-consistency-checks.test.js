"use strict";
// Posiciones que la declaracion afirma en un lado y contradice en otro.
//
// Los cuatro salen de un 1065 real donde TODOS los numeros cerraban -- el tie-out daba
// perfecto -- y habia cuatro posiciones equivocadas igual. Ninguna es aritmetica: cada una es
// un par de hechos impresos a paginas de distancia, y ninguna mitad llama la atencion sola.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  checkSection280CElection, checkResearchCreditEqualsAllWages,
  checkCashBasisUnexplainedLiability, checkPaymentsRequiring1099,
  runReturnConsistencyChecks, answerOn, nonEmployeePayments, unexplainedLiabilities,
  checkPaymentsWithNoFilingQuestion, checkDeferredRevenueOnAccrual,
  checkJurisdictionDropped, checkAccountingMethodChanged, checkCashMethodWithGrowingPayables, accountingMethod,
  checkScheduleM1TiesToBooks, checkClosingInventoryMissing,
} = require("../lib/return-consistency-checks");

// Las respuestas Si/No llegan anotadas por pdfPageLines: la columna donde estaba la tilde.
const RETURN = ({
  election = "No", credit = "3,200.", qre = "61,400.", wages = "61,400.",
  method = "(1) X Cash", form1099 = "No", m1extra = "", liability = "CUSTOMER FUNDS HELD . . . . . . . . 0. 58,900.",
} = {}) => `
Form 1065 U.S. Return of Partnership Income
H Check accounting method: ${method} (2) Accrual (3) Other (specify):
9 Salaries and wages (other than to partners) (less employment credits) . . . . . . . . 9 ${wages}
21 Other deductions (att stmt) . . . . . . . . SEE STATEMENT 2 21 180,000.
Schedule B Other Information Yes No
16 a Did you make any payments in 2025 that would require you to file Form(s) 1099? See instructions . . . . X [ANSWER: ${form1099}]
Schedule M-1 Reconciliation of Income (Loss) per Books With Analysis of Net Income (Loss) per Return
1 Net income (loss) per books . . . . . . . . 402,000.
4 Expenses recorded on books this year not included on Schedule K
entertainment . . . . . . $ 260.${m1extra}
5 Add lines 1 through 4 . . . . . . . . 402,260.
Form 6765 Credit for Increasing Research Activities
A Are you electing the reduced credit under section 280C? See instructions . . . . . . Yes X No [ANSWER: ${election}]
5 Total qualified research expenses (QREs). Enter amount from line 48 . . . . . . . . 5 ${qre}
30 Add lines 28 and 29 . . . . . . . . . . . . . . . . . . . . . . . . . . 30 ${credit}
STATEMENT 2
FORM 1065, LINE 21
OTHER DEDUCTIONS
ACCOUNTING $ . . . . . . . . . . . . . . . . 7,100.
OUTSIDE SERVICES . . . . . . . . . . . . . . 23,400.
SOFTWARE & SUBSCRIPTIONS . . . . . . . . . . 149,500.
TOTAL $ 180,000.
STATEMENT 5
FORM 1065, SCHEDULE L, LINE 17
OTHER CURRENT LIABILITIES
BEGINNING ENDING
CREDIT CARDS $ . . . . . . . . . . . . . . . 0. 3,100.
${liability}
TOTAL $ 0. 62,000.
STATEMENT 6
FORM 1125-A, LINE 5
OTHER COSTS
READER COMMISSIONS . . . . . . . . . . . . . $ 288,700.
TOTAL $ 288,700.
`;

/* --- 1. Seccion 280C ---------------------------------------------------- */

test("credito de investigacion al 20% sin reducir la deduccion", () => {
  const finding = checkSection280CElection(RETURN());
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /\$3,200\.00/);
  assert.match(finding.detail, /understated by \$3,200\.00/);
  // Y le dice al preparador cuanto cuesta cada camino: 3,200 x 79% = 2,528.
  assert.match(finding.action, /\$2,528\.00/);
});

test("si eligio el credito reducido, no hay nada que marcar", () => {
  assert.strictEqual(checkSection280CElection(RETURN({ election: "Yes" })), null);
});

test("si el M-1 ya trae el ajuste del credito, se calla", () => {
  const conAjuste = RETURN({ m1extra: "\nsection 280C reduction . . . . . . $ 3,200." });
  assert.strictEqual(checkSection280CElection(conAjuste), null);
});

test("sin respuesta legible en la casilla A no se inventa nada", () => {
  // Fail-closed: si pdfPageLines no pudo resolver la columna, no hay hallazgo.
  const sinRespuesta = RETURN().replace(/ \[ANSWER: No\]\n5 Total/, "\n5 Total");
  assert.strictEqual(checkSection280CElection(sinRespuesta), null);
});

test("sin Form 6765 en el paquete no aplica", () => {
  assert.strictEqual(checkSection280CElection("Form 1065 sin nada de esto"), null);
});

/* --- 2. QRE igual a toda la nomina -------------------------------------- */

test("los QRE son exactamente toda la nomina", () => {
  const finding = checkResearchCreditEqualsAllWages(RETURN());
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /\$61,400\.00/);
  assert.match(finding.detail, /to the dollar/);
});

test("una asignacion parcial de la nomina no se marca", () => {
  assert.strictEqual(checkResearchCreditEqualsAllWages(RETURN({ qre: "38,900." })), null);
});

test("el numero de linea de la seccion sin usar no se confunde con un importe", () => {
  // La linea 5 de un filer que usa el credito simplificado imprime solo el numero de casilla.
  const sinSeccionA = RETURN({ qre: "5" });
  assert.strictEqual(checkResearchCreditEqualsAllWages(sinSeccionA), null);
});

/* --- 3. Pasivo que no es un prestamo en base percibido ------------------ */

test("declaracion por lo percibido con fondos de terceros en el balance", () => {
  const finding = checkCashBasisUnexplainedLiability(RETURN());
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /CUSTOMER FUNDS HELD/);
  assert.match(finding.detail, /\$58,900\.00/);
  // La tarjeta de credito es un endeudamiento: no entra.
  assert.doesNotMatch(finding.detail, /CREDIT CARDS/);
});

test("por lo devengado la pregunta no se hace", () => {
  assert.strictEqual(checkCashBasisUnexplainedLiability(RETURN({ method: "(2) X Accrual" })), null);
});

test("un pasivo que si es endeudamiento no dispara", () => {
  const soloPrestamo = RETURN({ liability: "NOTES PAYABLE - BANK . . . . . . . 0. 58,900." });
  assert.strictEqual(checkCashBasisUnexplainedLiability(soloPrestamo), null);
});

test("un saldo chico no vale mandar al revisor de vuelta al cliente", () => {
  const chico = RETURN({ liability: "CUSTOMER FUNDS HELD . . . . . . . . 0. 900." });
  assert.strictEqual(checkCashBasisUnexplainedLiability(chico), null);
});

test("no barre el resto del Schedule L", () => {
  // El renglon 17 del propio Schedule L dice "Other current liabilities (attach stmt)", y
  // arrastraba el capital de los socios y el total del balance al hallazgo.
  const conScheduleL = `${RETURN()}
17 Other current liabilities (attach stmt) . . . SEE ST 5 62,000.
21 Partners' capital accounts . . . . . . . . . . . . 340,000.
22 Total liabilities and capital . . . . . . . . . . . 402,000.`;
  const finding = checkCashBasisUnexplainedLiability(conScheduleL);
  assert.ok(finding);
  assert.doesNotMatch(finding.detail, /capital|Total liabilities/i);
});

/* --- 4. La pregunta de los 1099 ---------------------------------------- */

test("Schedule B dice No sobre pagos a no empleados", () => {
  const finding = checkPaymentsRequiring1099(RETURN());
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /OUTSIDE SERVICES/);
  assert.match(finding.detail, /READER COMMISSIONS/);
  assert.match(finding.detail, /\$312,100\.00/);
  // El procesador de pagos es una salida legitima y el hallazgo tiene que decirlo.
  assert.match(finding.action, /third-party settlement/i);
});

test("si contesto que si, no hay nada que discutir", () => {
  assert.strictEqual(checkPaymentsRequiring1099(RETURN({ form1099: "Yes" })), null);
});

test("sin pagos a no empleados la respuesta No es correcta", () => {
  const sinPagos = RETURN()
    .replace(/OUTSIDE SERVICES[^\n]*\n/, "")
    .replace(/READER COMMISSIONS[^\n]*\n/, "");
  assert.strictEqual(checkPaymentsRequiring1099(sinPagos), null);
});

test("nada por debajo del umbral de 600", () => {
  const chico = RETURN().replace("23,400.", "450.").replace("$ 288,700.", "$ 320.");
  assert.strictEqual(checkPaymentsRequiring1099(chico), null);
});

/* --- helpers y entrada ------------------------------------------------- */

test("answerOn lee la anotacion y nada mas", () => {
  assert.strictEqual(answerOn("pregunta [ANSWER: Yes]"), "yes");
  assert.strictEqual(answerOn("pregunta [ANSWER: No]"), "no");
  assert.strictEqual(answerOn("pregunta sin anotar X"), null);
  assert.strictEqual(answerOn(null), null);
});

test("las etiquetas salen sin la columna de apertura ni el signo peso", () => {
  assert.deepStrictEqual(
    unexplainedLiabilities(RETURN()).map((l) => l.label),
    ["CUSTOMER FUNDS HELD"],
  );
  assert.deepStrictEqual(
    nonEmployeePayments(RETURN()).map((p) => p.label),
    ["OUTSIDE SERVICES", "READER COMMISSIONS"],
  );
});

test("de punta a punta sobre el paquete", () => {
  const files = [{ name: "Cliente 1065 2025.pdf", reviewRole: "current_return", fullText: RETURN() }];
  const findings = runReturnConsistencyChecks(files, { returnType: "1065", taxYear: "2025" });
  assert.strictEqual(findings.length, 4);
  assert.ok(findings.every((f) => f.severity === "HIGH"));
});

test("un paquete sin declaracion legible no produce nada", () => {
  assert.deepStrictEqual(runReturnConsistencyChecks([], {}), []);
  assert.deepStrictEqual(runReturnConsistencyChecks(null, {}), []);
  assert.deepStrictEqual(runReturnConsistencyChecks([{ name: "x.pdf", fullText: "corto" }], {}), []);
});

/* --- 5 y 6. Lo que el Form 1120 no pregunta --------------------------- */

// Schedule B le pregunta a una sociedad y a una S corporation si algun pago necesitaba un
// 1099. El Form 1120 no pregunta, asi que una C corporation deduce lo que quiera a no
// empleados y nada en la declaracion lo levanta. En dos clientes ese silencio tapo $509,600 y
// $883,079 de comisiones, consultorias y contract labor.
const RETURN_1120_SIN_PREGUNTA = `
Form 1120 U.S. Corporation Income Tax Return
1 Check accounting method: a Cash b X Accrual c Other (specify)
26 Other deductions (attach statement) . . . . . . . . SEE STATEMENT 2 26 940,000.
STATEMENT 2
FORM 1120, LINE 26
OTHER DEDUCTIONS
ACCOUNTING . . . . . . . . . . . . . . . . 31,200.
OUTSIDE SERVICES . . . . . . . . . . . . . 142,880.
SOFTWARE AND SUBSCRIPTIONS . . . . . . . . 765,920.
TOTAL $ 940,000.
STATEMENT 6
FORM 1120, SCHEDULE L, LINE 18
OTHER CURRENT LIABILITIES
BEGINNING ENDING
CREDIT CARD . . . . . . . . . . . . . . . 8,100. 3,200.
CUSTOMER PREPAYMENTS . . . . . . . . . . . 0. 41,500.
TOTAL $ 8,100. $ 44,700.
${"relleno para el largo minimo. ".repeat(20)}`;

test("pagos a no empleados en una declaracion que no pregunta por 1099", () => {
  const finding = checkPaymentsWithNoFilingQuestion(RETURN_1120_SIN_PREGUNTA);
  assert.ok(finding);
  assert.strictEqual(finding.severity, "MEDIUM");
  assert.match(finding.detail, /OUTSIDE SERVICES/);
  assert.match(finding.detail, /\$142,880\.00/);
  // La contabilidad no es un pago a un no empleado por servicios sujetos a 1099-NEC.
  assert.doesNotMatch(finding.detail, /SOFTWARE/);
});

test("si la declaracion si pregunta, de eso se ocupa el otro cheque", () => {
  const conPregunta = `${RETURN_1120_SIN_PREGUNTA}
16 a Did you make any payments in 2025 that would require you to file Form(s) 1099? . . X [ANSWER: Yes]`;
  assert.strictEqual(checkPaymentsWithNoFilingQuestion(conPregunta), null);
});

test("un solo contratista chico no merece un hallazgo", () => {
  const chico = RETURN_1120_SIN_PREGUNTA.replace("142,880.", "700.");
  assert.strictEqual(checkPaymentsWithNoFilingQuestion(chico), null);
});

test("cobrado por adelantado y fuera de ingresos, por lo devengado", () => {
  const finding = checkDeferredRevenueOnAccrual(RETURN_1120_SIN_PREGUNTA);
  assert.ok(finding);
  assert.strictEqual(finding.severity, "MEDIUM");
  assert.match(finding.detail, /CUSTOMER PREPAYMENTS/);
  assert.match(finding.detail, /\$41,500\.00/);
  assert.match(finding.action, /451\(c\)|deferral/i);
});

test("por lo percibido la pregunta es otra y ya tiene su cheque", () => {
  const percibido = RETURN_1120_SIN_PREGUNTA.replace("a Cash b X Accrual", "a X Cash b Accrual");
  assert.strictEqual(checkDeferredRevenueOnAccrual(percibido), null);
});

test("un saldo chico de anticipos no se marca", () => {
  const chico = RETURN_1120_SIN_PREGUNTA.replace("0. 41,500.", "0. 900.");
  assert.strictEqual(checkDeferredRevenueOnAccrual(chico), null);
});

/* --- 7, 8 y 9. Lo que solo se ve poniendo los dos años al lado ---------- */

// Los tres salen de un 1065 real de un restaurante en Manhattan. Ninguno se ve desde adentro
// de la declaracion del año: hay que poner 2024 al lado de 2025.
const REST_2025 = ({ metodo = "(1) X Cash (2) Accrual", apBegin = "134,078.", apEnd = "374,516.", con3115 = "" } = {}) => `
Form 1065 U.S. Return of Partnership Income
H Check accounting method: ${metodo} (3) Other (specify):
Forms needed for this return
Federal: 1065, Sch B-1, Sch K-1, 1125-A, 8879-PE${con3115}
New York: IT-204, IT-204.1, IT-204-IP, IT-204-CP, IT-204-LL
Form IT-204 line 1 . . . IT-204 IT-204 IT-204 IT-204
15 Accounts payable . . . . . . . . . . . . . . ${apBegin} ${apEnd}
${"relleno para el largo minimo. ".repeat(20)}`;

const REST_2024 = `
Form 1065 U.S. Return of Partnership Income
H Check accounting method: (1) Cash (2) X Accrual (3) Other (specify):
Form NYC-204 - 2024 Page 2
NYC-204 NYC-204 NYC-204 NYC-204 NYC-204
Form IT-204 line 1 . . . IT-204 IT-204 IT-204 IT-204
15 Accounts payable . . . . . . . . . . . . . . 91,510. 134,078.
${"relleno para el largo minimo. ".repeat(20)}`;

test("una jurisdiccion que se presento el año pasado y este no", () => {
  const finding = checkJurisdictionDropped(REST_2025(), REST_2024, "2024");
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /New York City \(NYC-204\)/);
  // El estado sigue presentandose: no entra.
  assert.doesNotMatch(finding.detail, /IT-204/);
});

test("una jurisdiccion nueva no es una caida", () => {
  // Florida aparece este año y no el pasado: eso no es un incumplimiento.
  const conFlorida = `${REST_2025()}\nF-1120 F-1120 F-1120 F-1120 F-1120`;
  assert.strictEqual(checkJurisdictionDropped(conFlorida, REST_2025(), "2024"), null);
});

test("sin declaracion del año anterior no se compara nada", () => {
  assert.strictEqual(checkJurisdictionDropped(REST_2025(), null, "2024"), null);
  // Y una mencion suelta no es un formulario presentado.
  const mencion = `${REST_2025()}\nsee the instructions for Form NYC-204 if applicable`;
  assert.strictEqual(checkJurisdictionDropped(REST_2025(), mencion, "2024"), null);
});

test("el metodo contable cambio y no hay Form 3115", () => {
  assert.strictEqual(accountingMethod(REST_2025()), "cash");
  assert.strictEqual(accountingMethod(REST_2024), "accrual");
  const finding = checkAccountingMethodChanged(REST_2025(), REST_2024, "2024");
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /checks the cash method/);
  assert.match(finding.detail, /2024 return checks accrual/);
  assert.match(finding.authority, /446\(e\)/);
});

test("con el Form 3115 en el paquete, el preparador sabe lo que hizo", () => {
  const con3115 = REST_2025({ con3115: ", 3115" });
  assert.strictEqual(checkAccountingMethodChanged(con3115, REST_2024, "2024"), null);
});

test("si el metodo no cambio, no hay nada que preguntar", () => {
  const igual = REST_2025({ metodo: "(1) Cash (2) X Accrual" });
  assert.strictEqual(checkAccountingMethodChanged(igual, REST_2024, "2024"), null);
});

test("las cuentas por pagar crecieron en una declaracion por lo percibido", () => {
  const finding = checkCashMethodWithGrowingPayables(REST_2025());
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /\$134,078\.00/);
  assert.match(finding.detail, /\$374,516\.00/);
  assert.match(finding.detail, /\$240,438\.00/);
});

test("por lo devengado la pregunta no aplica", () => {
  const devengado = REST_2025({ metodo: "(1) Cash (2) X Accrual" });
  assert.strictEqual(checkCashMethodWithGrowingPayables(devengado), null);
});

test("un movimiento chico de las cuentas por pagar es puro calendario", () => {
  const chico = REST_2025({ apEnd: "140,000." });
  assert.strictEqual(checkCashMethodWithGrowingPayables(chico), null);
  // Y si bajaron, tampoco.
  const bajaron = REST_2025({ apEnd: "40,000." });
  assert.strictEqual(checkCashMethodWithGrowingPayables(bajaron), null);
});

/* --- 10 y 11. La declaracion contra los libros del mismo dia ------------ */

// Los dos salen de un 1065 de gastronomia. El M-1 vivia en el modulo corporativo y por eso
// nunca corria sobre una sociedad: es la misma cedula en 1065, 1120 y 1120-S, y tenerlo
// atado a un tipo costo un hallazgo. Entidad y montos ficticios.
const LIBRO_GASTRO = {
  name: "workpaper.xlsx",
  reviewRole: "supporting_document",
  fullText: `--- Sheet: Profit and Loss ---
Total Income,2418330.10
Cost of Goods Sold
,Less: Opening Inventory,-8415
Net Operating Income,-203470.55
Net Income,-203470.55
--- Sheet: Balance Sheet ---
Assets
Bank Accounts,41208.77
Inventory Asset,8415
Total for Assets,937679.17`,
};

const GASTRO_1065 = ({ m1Books = "-210,400.", invFin = "", invIni = "8,415." } = {}) => `
Form 1065 U.S. Return of Partnership Income
Form 1125-A Cost of Goods Sold
1 Inventory at beginning of year . . . . . . . . . . . . . . . . . . . 1 ${invIni}
2 Purchases less cost of items withdrawn for personal use . . . . . . 2 704,118.
7 Inventory at end of year . . . . . . . . . . . . . . . . . . . . . . 7 ${invFin}
8 Cost of goods sold. Subtract line 7 from line 6 . . . . . . . . . . 8 712,533.
Schedule M-1 Reconciliation of Income (Loss) per Books With Income (Loss) per Return
1 Net income (loss) per books . . . . . . . . . . . . . . . . . . . . ${m1Books}
${"relleno para el largo minimo. ".repeat(20)}`;

test("el M-1 linea 1 tampoco es el resultado contable en una sociedad", () => {
  const finding = checkScheduleM1TiesToBooks(GASTRO_1065(), [LIBRO_GASTRO]);
  assert.ok(finding, "el cruce estaba atado al 1120 y no corria sobre un 1065");
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /-\$210,400\.00/);
  assert.match(finding.detail, /-\$203,470\.55/);
  assert.match(finding.detail, /-\$6,929\.45/);
});

test("si la linea 1 es el resultado contable, no hay nada que reconciliar", () => {
  assert.strictEqual(checkScheduleM1TiesToBooks(GASTRO_1065({ m1Books: "-203,471." }), [LIBRO_GASTRO]), null);
});

test("el inventario final quedo en blanco y los libros lo siguen teniendo", () => {
  const finding = checkClosingInventoryMissing(GASTRO_1065(), [LIBRO_GASTRO]);
  assert.ok(finding);
  assert.strictEqual(finding.severity, "MEDIUM");
  assert.match(finding.detail, /\$8,415\.00/);
  // Es la misma cifra que la declaracion reporta como inventario inicial, y eso se dice.
  assert.match(finding.detail, /opening inventory on line 1/);
  assert.match(finding.authority, /471/);
});

test("una linea 7 en blanco imprime su propio numero de casilla, no un importe", () => {
  // El mismo modo de fallar que la depreciacion: "7 Inventory at end of year ... 7".
  const finding = checkClosingInventoryMissing(GASTRO_1065({ invFin: "" }), [LIBRO_GASTRO]);
  assert.ok(finding, "leyo el 7 de la casilla como si fuera un inventario de siete dolares");
});

test("con el inventario final contado, el cruce se calla", () => {
  assert.strictEqual(checkClosingInventoryMissing(GASTRO_1065({ invFin: "8,415." }), [LIBRO_GASTRO]), null);
});

test("sin inventario en los libros no se reclama ninguno", () => {
  const sinInventario = { ...LIBRO_GASTRO, fullText: LIBRO_GASTRO.fullText.replace("Inventory Asset,8415\n", "") };
  assert.strictEqual(checkClosingInventoryMissing(GASTRO_1065(), [sinInventario]), null);
  assert.strictEqual(checkClosingInventoryMissing(GASTRO_1065(), []), null);
});

test("un saldo de inventario de redondeo no le interesa a nadie", () => {
  const migaja = { ...LIBRO_GASTRO, fullText: LIBRO_GASTRO.fullText.replace("Inventory Asset,8415", "Inventory Asset,180") };
  assert.strictEqual(checkClosingInventoryMissing(GASTRO_1065(), [migaja]), null);
});

test("sin Form 1125-A no hay inventario que mirar", () => {
  const sin1125 = GASTRO_1065().replace(/^.*Inventory at (?:beginning|end) of year.*$/gm, "");
  assert.strictEqual(checkClosingInventoryMissing(sin1125, [LIBRO_GASTRO]), null);
});
