"use strict";
// Cruces deterministas para declaraciones de entidad (1065, 1120-S, 1120, 1041).
//
// Salen de un 1065 real de alquiler revisado a mano contra sus documentos. Dos errores no se
// veían desde adentro del propio return: los K-1 repartían las contribuciones y los retiros
// del año mitad y mitad cuando los libros los atribuían íntegramente a un socio — los totales
// cerraban, así que Schedule M-2 cuadraba y nada parecía fuera de lugar —, y una propiedad de
// alquiler cargaba depreciación sin haber generado un peso de renta ni ningún otro gasto.
// Entidades, socios y montos ficticios; el layout del texto es el que produce pdf.js en
// producción, incluidos los números de línea que el formulario imprime dos veces.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  runEntityReturnChecks, checkBalanceSheetContinuity, checkAccumulatedDepreciationRollforward,
  checkCapitalRollforward, checkK1sFootToReturn, checkOwnerAllocationAgainstBooks,
  checkDistributionSplitAgainstBooks, drawAccountsFromWorkpaper, checkNettedEquityAccount,
  checkRentalWithOnlyDepreciation, scheduleM2, k1CapitalAccounts, k1OwnerNames, amountsOn,
} = require("../lib/entity-return-checks");

const scheduleL = ({ assetsBegin, assetsEnd, capBegin, capEnd, accumBegin, accumEnd }) => `
9 a Buildings and other depreciable assets . . . . . . 500,000. 500,000.
b Less accumulated depreciation . . . . . . . . . . . . . ${accumBegin}. ${400000 - accumBegin}. ${accumEnd}. ${400000 - accumEnd}.
14 Total assets . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . ${assetsBegin}. ${assetsEnd}.
21 Partners' capital accounts . . . . . . . . . . . . . . . . . . ${capBegin}. ${capEnd}.
22 Total liabilities and capital . . . . . . . . . . . . . . . . . . ${assetsBegin}. ${assetsEnd}.
`;

const scheduleM2Text = ({ begin, contributed, income, distributions, end }) => `
Schedule M-2 Analysis of Partners' Capital Accounts
1 Balance at beginning of year . . . . . . . . . . . . ${begin}. 6 Distributions: a Cash . . . . . . . . . . . . . . . . . . . . ${distributions}.
2 Capital contributed: a Cash . . . . . . . . . . . . . ${contributed}. b Property . . . . . . . . . . . . . . . . .
3 Net income (loss) (see instructions) . . . . . . ${income}.
5 Add lines 1 through 4 . . . . . . . . . . . . . . . . . . . 99,999. 9 Balance at end of year. Subtract line 8 from line 5 . . . . ${end}.
`;

const k1 = ({ name, begin, contributed, income, withdrawals, end }) => `
F Name, address, city, state, and ZIP code for partner entered in E. See instructions.
${name}
L Partner's Capital Account Analysis
Beginning capital account . . . . . . . . . . . . . $ ${begin}.
Capital contributed during the year . . . . . $ ${contributed}. 23 More than one activity for passive activity purposes*
Current year net income (loss) . . . . . . . . . $ ${income}.
Withdrawals and distributions . . . . . . . . . . . $ ( ${withdrawals}. )
Ending capital account . . . . . . . . . . . . . . . . $ ${end}.
`;

/** Form 8825 with two properties; the second earns nothing and only carries depreciation. */
const form8825 = `
2a Gross rents . . . . . . . . . . . . . . . . . . . . . . . . . . . 2a 60,000.
14 Depreciation (see instructions) . . . . . . . . 14 4,000. 9,200.
18 Total rental real estate expenses for each
property. Add lines 3 through 17 . . . . . . . . . . . . . 18 52,000. 9,200.
19 Income or (loss) from each rental real estate
property. Subtract line 18 from line 2c . . . . . . . . . 19 8,000. -9,200.
`;

const RETURN_1065 = `U.S. Return of Partnership Income 2025
${scheduleL({ assetsBegin: 300000, assetsEnd: 290000, capBegin: 1000, capEnd: -4000, accumBegin: 50000, accumEnd: 63200 })}
${scheduleM2Text({ begin: 1000, contributed: 9000, income: -1200, distributions: 12800, end: -4000 })}
${form8825}
${k1({ name: "ALEX MERIDIAN", begin: 500, contributed: 4500, income: -600, withdrawals: 6400, end: -2000 })}
${k1({ name: "BRENDA COLTRANE", begin: 500, contributed: 4500, income: -600, withdrawals: 6400, end: -2000 })}
${"2025 filler line for length. ".repeat(30)}`;

const PRIOR_1065 = `U.S. Return of Partnership Income 2024
${scheduleL({ assetsBegin: 310000, assetsEnd: 300000, capBegin: 2000, capEnd: 1000, accumBegin: 37000, accumEnd: 50000 })}
${"2024 filler line for length. ".repeat(30)}`;

/** Comparative equity columns as SheetJS renders the workbook: current, prior. */
const WORKPAPER = {
  name: "workpaper.xlsx",
  reviewRole: "supporting_document",
  fullText: `--- Sheet: Balance sheet ---
Partner-Alex Contributions,20000,20000
Partner-Alex Distributions,-31000,-31000
Partner-Brenda Contributions,29000,20000
Partner-Brenda Distributions,-43800,-31000`,
};

const filesFor = (current, prior, extra = []) => [
  { name: "Client 1065 2025.pdf", reviewRole: "current_return", fullText: current },
  ...(prior ? [{ name: "Client 1065 2024.pdf", reviewRole: "prior_return", fullText: prior }] : []),
  ...extra,
];

test("amountsOn ignora los números de línea que el formulario imprime dos veces", () => {
  // "14 Depreciation ... 14 3,058. 10,544." — contarlos convertia $13,602 en $13,630.
  assert.deepStrictEqual(amountsOn("14 Depreciation (see instructions) . . . . 14 3,058. 10,544."), [3058, 10544]);
  // Y una etiqueta que cita otra linea en prosa desplazaba las columnas una posicion.
  assert.deepStrictEqual(amountsOn("property. Subtract line 18 from line 2c . . . . 19 5,154. -10,544.", { leader: "last" }), [5154, -10544]);
});

test("lee Schedule M-2 pese a que las dos columnas comparten renglón", () => {
  const m2 = scheduleM2(RETURN_1065);
  // additions es la línea 5 y reductions la línea 8: los subtotales que el propio formulario
  // calcula, y que ya contienen lo itemizado en las líneas 4 y 7. Esta plantilla no imprime
  // la línea 8, así que reductions queda en null y el cheque cae al camino por componentes.
  assert.deepStrictEqual(m2, { beginning: 1000, contributed: 9000, income: -1200, distributions: 12800, additions: 99999, reductions: null, ending: -4000 });
});

test("lee las cuentas de capital y los nombres de cada K-1", () => {
  assert.deepStrictEqual(k1CapitalAccounts(RETURN_1065), [
    { beginning: 500, contributed: 4500, income: -600, withdrawals: 6400, ending: -2000 },
    { beginning: 500, contributed: 4500, income: -600, withdrawals: 6400, ending: -2000 },
  ]);
  assert.deepStrictEqual(k1OwnerNames(RETURN_1065), ["ALEX MERIDIAN", "BRENDA COLTRANE"]);
});

test("reparto de aportes y retiros que no coincide con los libros", () => {
  const finding = checkOwnerAllocationAgainstBooks(RETURN_1065, [WORKPAPER]);
  assert.ok(finding, "los libros mueven solo a Brenda y los K-1 reparten mitad y mitad");
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /ALEX MERIDIAN/);
  assert.match(finding.detail, /BRENDA COLTRANE/);
  assert.match(finding.detail, /\$9,000\.00/);
  // Sin workpaper no hay con qué comparar, y no se inventa nada.
  assert.strictEqual(checkOwnerAllocationAgainstBooks(RETURN_1065, []), null);
});

test("si los libros coinciden con los K-1, se calla", () => {
  const parejo = { ...WORKPAPER, fullText: `--- Sheet: Balance sheet ---
Partner-Alex Contributions,24500,20000
Partner-Alex Distributions,-37400,-31000
Partner-Brenda Contributions,24500,20000
Partner-Brenda Distributions,-37400,-31000` };
  assert.strictEqual(checkOwnerAllocationAgainstBooks(RETURN_1065, [parejo]), null);
});

test("propiedad de alquiler cuyo único gasto es la depreciación", () => {
  const finding = checkRentalWithOnlyDepreciation(RETURN_1065);
  assert.ok(finding);
  assert.match(finding.detail, /Property B/);
  assert.match(finding.detail, /\$9,200\.00/);
  // La propiedad A tiene rentas y otros gastos: no debe aparecer.
  assert.doesNotMatch(finding.detail, /Property A/);
});

test("Schedule M-2 que no cierra", () => {
  assert.strictEqual(checkCapitalRollforward(RETURN_1065), null, "el caso base cierra");
  const roto = RETURN_1065.replace("9 Balance at end of year. Subtract line 8 from line 5 . . . . -4000.",
                                   "9 Balance at end of year. Subtract line 8 from line 5 . . . . -9000.");
  const finding = checkCapitalRollforward(roto);
  assert.ok(finding);
  assert.match(finding.detail, /\$-?5,000\.00|\(\$5,000\.00\)/);
});

test("K-1 que no suman a la declaración", () => {
  assert.strictEqual(checkK1sFootToReturn(RETURN_1065), null, "el caso base suma");
  const roto = RETURN_1065.replace("Capital contributed during the year . . . . . $ 4500. 23", "Capital contributed during the year . . . . . $ 7000. 23");
  const finding = checkK1sFootToReturn(roto);
  assert.ok(finding);
  assert.match(finding.detail, /capital contributed/);
});

test("Schedule L que no abre donde cerró el año anterior", () => {
  assert.deepStrictEqual(checkBalanceSheetContinuity(RETURN_1065, PRIOR_1065, "2024"), [], "el caso base es continuo");
  const roto = RETURN_1065.replace("14 Total assets . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 300000. 290000.",
                                   "14 Total assets . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 288000. 290000.");
  const findings = checkBalanceSheetContinuity(roto, PRIOR_1065, "2024");
  assert.strictEqual(findings.length, 1);
  assert.match(findings[0].detail, /\$12,000\.00|\(\$12,000\.00\)/);
});

test("la depreciación acumulada tiene que moverse por la depreciación deducida", () => {
  // 63,200 - 50,000 = 13,200 = 4,000 + 9,200 del 8825.
  assert.strictEqual(checkAccumulatedDepreciationRollforward(RETURN_1065), null);
  const roto = RETURN_1065.replace("14 Depreciation (see instructions) . . . . . . . . 14 4,000. 9,200.",
                                   "14 Depreciation (see instructions) . . . . . . . . 14 4,000. 2,000.");
  const finding = checkAccumulatedDepreciationRollforward(roto);
  assert.ok(finding);
  assert.match(finding.detail, /\$6,000\.00|\(\$6,000\.00\)/);
});

test("runEntityReturnChecks: encadena, y no pisa a los cheques del 1040", () => {
  const found = runEntityReturnChecks(filesFor(RETURN_1065, PRIOR_1065, [WORKPAPER]), { taxYear: "2025", returnType: "1065" });
  assert.strictEqual(found.length, 2, "reparto de K-1 y propiedad sin renta");
  assert.ok(found.every((f) => f.severity === "HIGH" && f.action && f.authority));

  // Un 1040 no entra aca: lo dice el encabezado de la declaracion, no la etiqueta. Gatear por
  // el desplegable permitia que una eleccion equivocada apagara el modulo entero en silencio.
  for (const tipo of ["1065", "Other", "", "1040"]) {
    assert.strictEqual(
      runEntityReturnChecks(filesFor(RETURN_1065, PRIOR_1065, [WORKPAPER]), { taxYear: "2025", returnType: tipo }).length, 2,
      `se apago con returnType=${tipo}`,
    );
  }
  const individual = `U.S. Individual Income Tax Return 2025\n${RETURN_1065}`;
  assert.strictEqual(runEntityReturnChecks(filesFor(individual, null), {}).length, 0);

  // 1120-S comparte la forma de K-1 y M-2.
  const scorp = RETURN_1065.replace("U.S. Return of Partnership Income", "Income Tax Return for an S Corporation");
  assert.ok(runEntityReturnChecks(filesFor(scorp, null, [WORKPAPER]), { returnType: "1120S" }).length >= 1);

  // 1120 y 1041 quedan cubiertos por los cheques que leen Schedule L, sin inventar el resto.
  for (const tipo of ["1120", "1041"]) {
    assert.doesNotThrow(() => runEntityReturnChecks(filesFor(RETURN_1065, PRIOR_1065), { returnType: tipo }));
  }

  // Falla cerrado: sin nada, nada.
  assert.strictEqual(runEntityReturnChecks([], {}).length, 0);
  assert.strictEqual(runEntityReturnChecks(null, {}).length, 0);
  assert.strictEqual(runEntityReturnChecks([{ name: "x.pdf", reviewRole: "current_return", fullText: "corto" }], {}).length, 0);
});

// Una corrida real marcó en ALTO que el M-2 no cerraba, por exactamente los $178 de comidas
// no deducibles que la propia declaración itemizaba en la línea 7. El renglón "4 Other
// increases" y el renglón "7 Other decreases" imprimen la etiqueta en una columna y la cifra
// en la otra, así que la cifra cae en una línea de texto vecina y no se puede atribuir a una
// u otra. Las líneas 5 y 8 son los subtotales que el formulario ya calculó: ahí no hay nada
// que adivinar.
const M2_CON_OTROS = ({ decreases = "400", end = "49,600" } = {}) => `
Schedule M-2 Analysis of Partners' Capital Accounts
1 Balance at beginning of year . . . . . . . . 0. 6 Distributions: a Cash . . . . . . . . 250,000.
2 Capital contributed: a Cash . . . . . . . . b Property . . . . . . . .
 b Property . . . . . . . . 7 Other decreases (itemize):
3 Net income (loss) (see instructions). . . . . . . . 300,000.
4 Other increases (itemize): STATEMENT 8 ${decreases}.
 8 Add lines 6 and 7. . . . . . . . 250,${decreases}.
5 Add lines 1 through 4 . . . . . . . 300,000. 9 Balance at end of year. Subtract line 8 from line 5 . . . . ${end}.
`;

test("M-2 con otras disminuciones itemizadas: no es un quiebre", () => {
  // 300,000 - 250,400 = 49,600. Sumar los componentes sin la línea 7 daría 50,000 y un
  // hallazgo fantasma de $400 en ALTO sobre una declaración que cierra perfecto.
  assert.strictEqual(checkCapitalRollforward(M2_CON_OTROS()), null);
});

test("M-2 que de verdad no cierra se marca por los subtotales", () => {
  const finding = checkCapitalRollforward(M2_CON_OTROS({ end: "48,000" }));
  assert.ok(finding);
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /line 5 \(total additions\)/);
  assert.match(finding.detail, /\$300,000\.00/);
  assert.match(finding.detail, /\$250,400\.00/);
});

test("sin subtotales legibles y con itemización, se calla", () => {
  // Fail-closed: antes que un hallazgo inventado, ninguno.
  const sinLinea8 = M2_CON_OTROS().replace(/ 8 Add lines 6 and 7[^\n]*\n/, "");
  assert.strictEqual(checkCapitalRollforward(sinLinea8), null);
});

// El mismo error de asignacion, en un libro que no nombra a sus duenos.
//
// checkOwnerAllocationAgainstBooks necesita filas tipo "Partner-Gerard Distributions" con dos
// columnas comparativas. El otro modo de armar estos libros no nombra nada: dos cuentas de
// retiros genericas, una sola columna. Nadie las puede mapear a socios leyendolas, asi que el
// cheque no lo intenta: solo mira si los totales coinciden (lo que las vuelve las
// distribuciones) y las partes no (lo que las vuelve equivocadas).
const K1S_CON_RETIROS = ({ uno = "463,888", dos = "4,686" } = {}) => `
${k1({ name: "SOCIO UNO LLC", begin: 0, contributed: 0, income: "477,594", withdrawals: uno, end: "13,530" })}
${k1({ name: "SOCIO DOS LLC", begin: 0, contributed: 0, income: "4,825", withdrawals: dos, end: "137" })}
`;

const LIBRO_SIN_NOMBRES = ({ uno = "435765.51", dos = "32808.73" } = {}) => `--- Sheet: Balance sheet ---
Liabilities and Equity
Equity
Member Draws/Contributions,-${uno}
Member Draws- Partner Payout,-${dos}
Total for Member Draws/Contributions,-468574.24,Distribution
Retained Earnings
Net Income,482239.32`;

test("los retiros se repartieron por porcentaje y no por quien los cobro", () => {
  const finding = checkDistributionSplitAgainstBooks(K1S_CON_RETIROS(), [{ name: "wp.xlsx", fullText: LIBRO_SIN_NOMBRES() }]);
  assert.ok(finding);
  assert.strictEqual(finding.severity, "MEDIUM");
  assert.match(finding.detail, /\$463,888\.00/);
  assert.match(finding.detail, /Member Draws- Partner Payout/);
  // El subtotal "Total for ..." es la suma de las dos de arriba, no una cuenta mas.
  assert.doesNotMatch(finding.detail, /"Total for/);
});

test("si los K-1 ya siguen a las cuentas de retiros, no hay hallazgo", () => {
  const alineado = K1S_CON_RETIROS({ uno: "435,766", dos: "32,809" });
  assert.strictEqual(checkDistributionSplitAgainstBooks(alineado, [{ name: "wp.xlsx", fullText: LIBRO_SIN_NOMBRES() }]), null);
});

test("si las cuentas no suman las distribuciones de la declaracion, no se compara nada", () => {
  // Sin esa coincidencia no son las distribuciones y no hay nada que decir.
  const otroLibro = LIBRO_SIN_NOMBRES({ uno: "100000", dos: "20000" });
  assert.strictEqual(checkDistributionSplitAgainstBooks(K1S_CON_RETIROS(), [{ name: "wp.xlsx", fullText: otroLibro }]), null);
});

test("sin planilla, o con una sola cuenta de retiros, se calla", () => {
  assert.strictEqual(checkDistributionSplitAgainstBooks(K1S_CON_RETIROS(), []), null);
  const unaSola = `--- Sheet: Balance sheet ---
Equity
Member Draws/Contributions,-468574.24`;
  assert.strictEqual(checkDistributionSplitAgainstBooks(K1S_CON_RETIROS(), [{ name: "wp.xlsx", fullText: unaSola }]), null);
});

test("drawAccountsFromWorkpaper ignora subtotales y hojas que no son planilla", () => {
  assert.deepStrictEqual(
    drawAccountsFromWorkpaper([{ name: "wp.xlsx", fullText: LIBRO_SIN_NOMBRES() }]).map((a) => a.label),
    ["Member Draws/Contributions", "Member Draws- Partner Payout"],
  );
  assert.deepStrictEqual(drawAccountsFromWorkpaper([{ name: "return.pdf", fullText: "Withdrawals and distributions 5,000." }]), []);
});

test("lee las cuentas de retiros aunque las celdas traigan separador de miles", () => {
  // SheetJS exporta una celda formateada como "-435,765.51", entre comillas porque lleva
  // coma. Separar celdas reemplazando toda coma por espacio partia esa cifra en 435 y 765.51,
  // el cheque no encontraba ninguna cuenta y se quedaba callado sobre la declaracion para la
  // que fue escrito -- mientras la propia review citaba el numero bien.
  const formateado = `--- Sheet: Balance sheet ---
Member Draws/Contributions,"-435,765.51"
Member Draws- Partner Payout,"-32,808.73"
Total for Member Draws/Contributions,"-468,574.24",Distribution`;
  assert.deepStrictEqual(
    drawAccountsFromWorkpaper([{ name: "wp.xlsx", fullText: formateado }]).map((a) => a.amount),
    [435765.51, 32808.73],
  );
  assert.ok(checkDistributionSplitAgainstBooks(K1S_CON_RETIROS(), [{ name: "wp.xlsx", fullText: formateado }]));
});

test("y con la sangria y las columnas vacias que deja el export", () => {
  const sangrado = `--- Sheet: Balance sheet ---
,,,Member Draws/Contributions,"-435,765.51",,
,,,Member Draws- Partner Payout,"-32,808.73",,`;
  assert.ok(checkDistributionSplitAgainstBooks(K1S_CON_RETIROS(), [{ name: "wp.xlsx", fullText: sangrado }]));
});

// El item L comparte renglon con la casilla de al lado, asi que un campo VACIO deja
// "Capital contributed during the year . . . $ 23 More than one activity for passive activity
// purposes" y leer el primer numero del renglon toma 23 como el aporte. Los dos K-1 de un
// paquete real reportaban $23 de capital aportado, suficiente para que un cheque que se
// apoya en "cero aportes" se quedara callado. La cifra de verdad sigue al signo peso y trae
// coma o punto final: un cero real se imprime "0.".
test("un item L vacio no se lee como un aporte de 23", () => {
  const vacio = RETURN_1065.replace(
    /Capital contributed during the year \. \. \. \. \. \$ 4500\. 23 More than one activity for passive activity purposes\*/g,
    "Capital contributed during the year . . . . . $ 23 More than one activity for passive activity purposes*",
  );
  for (const account of k1CapitalAccounts(vacio)) {
    assert.strictEqual(account.contributed, undefined, "el numero de item de la casilla vecina no es un aporte");
  }
  // Y un cero de verdad, que se imprime con punto, si se lee.
  const cero = RETURN_1065.replace(/\$ 4500\./g, "$ 0.");
  assert.strictEqual(k1CapitalAccounts(cero)[0].contributed, 0);
});

const LIBRO_NETEADO = {
  name: "workpaper.xlsx",
  reviewRole: "supporting_document",
  fullText: `--- Sheet: Balance sheet ---
Liabilities and Equity
Equity
Member Draws/Contributions,-435765.51
Retained Earnings
Net Income,482239.32`,
};

/** El mismo 1065 pero sin un peso de aportes: ni en el M-2 linea 2 ni en el item L. */
const SIN_APORTES = `U.S. Return of Partnership Income 2025
${scheduleM2Text({ begin: 1000, contributed: "", income: -1200, distributions: 12800, end: -4000 })}
${k1({ name: "ALEX MERIDIAN", begin: 500, contributed: "", income: -600, withdrawals: 6400, end: -2000 })}
${k1({ name: "BRENDA COLTRANE", begin: 500, contributed: "", income: -600, withdrawals: 6400, end: -2000 })}
${"2025 filler line for length. ".repeat(30)}`;

test("una cuenta de patrimonio que netea aportes contra retiros", () => {
  // El nombre la delata: una cuenta que titula los dos movimientos no puede contestar un
  // formulario que los pide por separado.
  const finding = checkNettedEquityAccount(SIN_APORTES, [LIBRO_NETEADO]);
  assert.ok(finding);
  assert.strictEqual(finding.severity, "MEDIUM");
  assert.match(finding.detail, /Member Draws\/Contributions/);
});

test("si la declaracion si reporta aportes, el neteo fue solo contable", () => {
  // RETURN_1065 trae 4,500 de aportes en cada K-1: nada se perdio.
  assert.strictEqual(checkNettedEquityAccount(RETURN_1065, [LIBRO_NETEADO]), null);
});

test("una cuenta que nombra un solo movimiento no aplica", () => {
  const soloRetiros = { ...LIBRO_NETEADO, fullText: LIBRO_NETEADO.fullText.replace("Member Draws/Contributions", "Member Draws") };
  assert.strictEqual(checkNettedEquityAccount(SIN_APORTES, [soloRetiros]), null);
  assert.strictEqual(checkNettedEquityAccount(SIN_APORTES, []), null);
});
