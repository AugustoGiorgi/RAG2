"use strict";
// Cada K-1 recibido contra el renglon del 1040 donde cae (lib/k1-checks.js). Sociedades, nombres
// y cifras ficticios; el formato de los anexos es el de tres emisores distintos ("BOX 13, CODE
// ZZ - OTHER", "LINE 11, CODE ZZ - OTHER INCOME (LOSS)" y "BOX 11, CODE ZZ: OTHER").
const { test } = require("node:test");
const assert = require("node:assert");
const k1 = require("../lib/k1-checks");

const PAD = "Statement filler text for a return of normal length. ".repeat(12);
const META = { taxYear: "2025", returnType: "1040" };

/* --- Una declaracion ficticia: cada pieza se puede reemplazar ------------------ */

function f1040(o = {}) {
  const v = {
    loss6781: "10,000.", gain6781: "30,000.", net6781: "20,000.", line31: "150.",
    line16: ["INVESTMENT EXP. FROM K-1 4,300.", "16 4,300."], extra: [], ny: true,
    ...o,
  };
  return [
    "Form 1040 U.S. Individual Income Tax Return 2025 OMB No. 1545-0074",
    "Your first name and middle initial Last name Your social security number",
    "JANE EXAMPLE 000-11-1111",
    "Filing Status X Single",
    "SCHEDULE A Itemized Deductions",
    "Other 16 Other ' from list in instructions. List type and amount:",
    "Itemized",
    ...v.line16,
    "Total 17 Add the amounts in the far right column for lines 4 through 16.",
    "Schedule E (Form 1040) 2025 Page 2",
    "29 a Totals . . . . . . 500.",
    `31 Add columns (g), (i), and (j) of line 29b . . . . . . . . . . . 31 ( ${v.line31} )`,
    "Form 6781 Gains and Losses From Section 1256 Contracts and Straddles",
    "(a) Identification of account (b) (Loss) (c) Gain",
    "FROM K-1",
    `2 Add the amounts on line 1 in columns (b) and (c) . . . . . . 2 ( ${v.loss6781} ) ${v.gain6781}`,
    `3 Net gain or (loss). Combine line 2, columns (b) and (c) . . . . . . . 3 ${v.net6781}`,
    ...(v.ny ? ["IT-201 Resident Income Tax Return New York State", "71 Other refundable credits (Form IT-201-ATT, line 18) . . . . 71 .00"] : []),
    PAD,
    ...v.extra,
  ].join("\n");
}

const pkg = (current, docs = []) => [{ name: "Example 2025 return.pdf", reviewRole: "current_return", text: current }, ...docs];
const doc = (name, lines) => ({ name, reviewRole: "supporting_document", text: lines.join("\n") });

const face = (name) => [
  "Schedule K-1 2025",
  "(Form 1065) Part III Partner’s Share of Current Year Income, Deductions, Credits, and Other Items",
  "B Partnership’s name, address, city, state, and ZIP code",
  `${name} 4c Total guaranteed payments 17 Alternative minimum tax (AMT) items`,
  "1 Ordinary business income (loss) 14 Self-employment earnings (loss)",
];

// Un fondo que opera como trader, con los anexos al estilo del primer emisor.
const traderFund = (name = "EXAMPLE TRADING GP LLC", o = {}) => doc(`${name} K-1.pdf`, [
  ...face(name),
  `${name}`,
  "2025 SCHEDULE K-1 SUPPORTING STATEMENTS JANE EXAMPLE",
  `BOX 11, CODE C - SECTION 1256 CONTRACTS AND STRADDLES ${o.sec1256 || "(30,000)"}`,
  "BOX 11, CODE ZZ - OTHER",
  "NET SECTION 988 GAIN/(LOSS) (1,700)",
  "SWAP INCOME/(LOSS) 200",
  "TOTAL OTHER (1,500)",
  "BOX 13, CODE H - INVESTMENT INTEREST EXPENSE",
  "TOTAL INVESTMENT INTEREST EXPENSE 900",
  "BOX 13, CODE AE - DEDUCTIONS-PORTFOLIO INCOME",
  "OTHER PORTFOLIO DEDUCTIONS 300",
  "TOTAL DEDUCTIONS-PORTFOLIO INCOME 300",
  "BOX 13, CODE ZZ - OTHER",
  "INTEREST EXPENSE - BUSINESS 12,500",
  "PASS-THROUGH ENTITY TAX (PTET) 3,000",
  "TRADER DEDUCTIONS 6,000",
  "TOTAL OTHER 21,500",
  "SPLITHERE:@#1@#",
  "PART III, BOX 13 OTHER DEDUCTIONS, CODE ZZ - OTHER DEDUCTIONS:",
  "PROFESSIONAL FEES, MANAGEMENT FEES, AND OTHER DEDUCTIONS WHICH ARE RELATED TO THE PARTNERSHIP'S ACTIVITY AS A TRADER IN",
  "SECURITIES SHOULD BE ENTERED BY AN 'INDIVIDUAL' TAXPAYER ON SCHEDULE E, PART II AS NONPASSIVE.",
  "SECTION 1061 WORKSHEET A",
  "4 API ONE YEAR DISTRIBUTIVE SHARE AMOUNT 14,000",
  "7 API THREE YEAR DISTRIBUTIVE SHARE AMOUNT GAIN OR (LOSS) (2,000)",
  "IT-204-IP (2025) Page 5 of 5",
  "47a 653 3,000 47d",
  "47b B53 1,200 47e",
]);

// Otro emisor: "LINE ..., CODE ..." y el total con el nombre del renglon repetido.
const stakingFund = doc("staking fund K-1.pdf", [
  ...face("EXAMPLE STAKING GP LLC"),
  "LINE 11, CODE ZZ - OTHER INCOME (LOSS)",
  "INCOME FROM STAKING ACTIVITY - FROM FLOWTHROUGH 18,000",
  "TOTAL LINE 11, CODE ZZ - OTHER 18,000",
  "LINE 13, CODE AE - DEDUCTIONS - PORTFOLIO INCOME",
  "OTHER DEDUCTIONS - FROM FLOWTHROUGH 4,000",
  "TOTAL LINE 13, CODE AE - OTHER DEDUCTIONS 4,000",
  "LINE 4 API ONE YEAR DISTRIBUTIVE SHARE AMOUNT SUBTRACT THE SUM OF LINES 2 AND 3 FROM LINE 1 400,000",
  "LINE 7 API THREE YEAR DISTRIBUTIVE SHARE AMOUNT GAIN OR (LOSS)",
  "(SUBTRACT THE SUM OF LINES 5 AND 6 FROM LINE 4) 370,000",
]);

// Y el tercero: dos puntos despues del codigo, negativos con signo menos, "NONE".
const buyoutFund = doc("buyout fund K-1.pdf", [
  ...face("EXAMPLE BUYOUT CO-INVESTORS LLC"),
  "BOX 11, CODE A: OTHER PORTFOLIO INCOME (LOSS)",
  "OTHER PORTFOLIO INCOME/(LOSS) -215",
  "TOTAL OTHER INCOME (LOSS) - OTHER PORTFOLIO INCOME (LOSS) -215",
  "BOX 11, CODE ZZ: OTHER",
  "SECTION 751 GAIN - US 6,400",
  "TOTAL OTHER 6,400",
  "LINE 4: API ONE YEAR DISTRIBUTIVE SHARE AMOUNT (SUBTRACT THE SUM OF LINES 2 AND 3 FROM LINE 1) 19,000",
  "LINE 5: AMOUNTS INCLUDED IN LINE 4 THAT WOULD NOT BE TREATED AS LONG-TERM GAIN OR (LOSS) IF",
  "THREE YEARS IS SUBSTITUTED FOR ONE YEAR UNDER PARAGRAPHS (3) AND (4) OF SEC. 1222 NONE",
  "LINE 7: API THREE YEAR DISTRIBUTIVE SHARE AMOUNT GAIN OR (LOSS) (SUBTRACT THE SUM OF LINES 5 AND",
  "6 FROM LINE 4) 19,000",
]);

const read = (docs, current = f1040()) => k1.readK1s(require("../lib/package-docs").packageDocuments(pkg(current, docs).slice(1)), 2025);

/* --- Lectura --------------------------------------------------------------------- */

test("los anexos se leen por casilla y codigo en los tres formatos", () => {
  const a = k1.k1Statements(traderFund().text);
  assert.deepStrictEqual(a.map((s) => [s.box, s.code, s.total]), [["11", "C", -30000], ["11", "ZZ", -1500], ["13", "H", 900], ["13", "AE", 300], ["13", "ZZ", 21500]]);
  assert.deepStrictEqual(a[4].items.map((i) => [i.label, i.amount]), [["INTEREST EXPENSE - BUSINESS", 12500], ["PASS-THROUGH ENTITY TAX (PTET)", 3000], ["TRADER DEDUCTIONS", 6000]]);
  assert.strictEqual(a[0].label, "SECTION 1256 CONTRACTS AND STRADDLES", "el importe del encabezado no queda en el rotulo");
  const b = k1.k1Statements(stakingFund.text);
  assert.deepStrictEqual(b.map((s) => [s.box, s.code, s.label, s.total]), [["11", "ZZ", "OTHER INCOME (LOSS)", 18000], ["13", "AE", "DEDUCTIONS - PORTFOLIO INCOME", 4000]]);
  const c = k1.k1Statements(buyoutFund.text);
  assert.deepStrictEqual(c.map((s) => [s.box, s.code, s.total]), [["11", "A", -215], ["11", "ZZ", 6400]]);
  // La explicacion de una casilla ("PART III, BOX 13 ...") no es un anexo.
  assert.deepStrictEqual(k1.k1Statements("PART III, BOX 13 OTHER DEDUCTIONS, CODE ZZ - OTHER DEDUCTIONS:\nTHE AMOUNT IS YOUR SHARE 500"), []);
});

test("el nombre de la sociedad sale del item B, sin la casilla de al lado", () => {
  assert.strictEqual(k1.partnershipName(traderFund().text), "EXAMPLE TRADING GP LLC");
  assert.strictEqual(k1.partnershipName("sin caratula"), "");
});

test("Worksheet A de la seccion 1061: importe en el renglon o en el siguiente, y NONE", () => {
  assert.deepStrictEqual(k1.worksheetA(traderFund().text), { oneYear: 14000, threeYear: -2000 });
  assert.deepStrictEqual(k1.worksheetA(stakingFund.text), { oneYear: 400000, threeYear: 370000 });
  assert.deepStrictEqual(k1.worksheetA(buyoutFund.text), { oneYear: 19000, threeYear: 19000 });
  // Una hoja en blanco termina en "FROM LINE 1": eso es un numero de linea, no un importe.
  assert.strictEqual(k1.worksheetA("LINE 4 API ONE YEAR DISTRIBUTIVE SHARE AMOUNT SUBTRACT THE SUM OF LINES 2 AND 3 FROM LINE 1\nLINE 5 AMOUNTS INCLUDED IN LINE 4\nLINE 7 API THREE YEAR DISTRIBUTIVE SHARE AMOUNT GAIN OR (LOSS)\nTHE INFORMATION PROVIDED"), null);
});

/* --- Los cruces ------------------------------------------------------------------ */

test("una perdida de la seccion 1256 cargada como ganancia en el Form 6781", () => {
  const funds = [traderFund("EXAMPLE TRADING GP LLC"), traderFund("EXAMPLE SECOND FUND LP", { sec1256: "(10,000)" })];
  const f = k1.check1256(read(funds), f1040());
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /loss of \$30,000 from EXAMPLE TRADING GP LLC \(K-1 box 11, code C\) as a gain/);
  assert.match(f.detail, /net loss of \$40,000 and Form 6781 line 3 shows a net gain of \$20,000: capital gain is overstated by \$60,000/);
  // Bien cargado: las dos perdidas en su columna.
  assert.strictEqual(k1.check1256(read(funds), f1040({ loss6781: "40,000.", gain6781: "", net6781: "(40,000.)" })), null);
  // Una diferencia que no es un cambio de signo no se afirma: puede faltar un K-1 en el paquete.
  assert.strictEqual(k1.check1256(read(funds), f1040({ loss6781: "55,000.", gain6781: "", net6781: "(55,000.)" })), null);
  assert.strictEqual(k1.check1256(read(funds), "Form 1040 U.S. Individual Income Tax Return 2025"), null, "sin Form 6781 no hay cruce");
});

test("las deducciones 13ZZ de un fondo trader que el Schedule E no deduce", () => {
  const f = k1.checkOtherDeductions(read([traderFund()]), f1040());
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /1 K-1 from partnerships that trade securities report \$21,500 of box 13, code ZZ deductions/);
  assert.match(f.detail, /Schedule E line 31 deducts \$150 of partnership losses/);
  // La cifra, o uno de sus componentes, ya esta en la declaracion.
  assert.strictEqual(k1.checkOtherDeductions(read([traderFund()]), f1040({ extra: ["OTHER DEDUCTIONS P 12-3456789 21,500."] })), null);
  assert.strictEqual(k1.checkOtherDeductions(read([traderFund()]), f1040({ extra: ["INTEREST EXPENSE 12,500."] })), null);
  // El Schedule E ya deduce mas que eso: no se puede afirmar que falta.
  assert.strictEqual(k1.checkOtherDeductions(read([traderFund()]), f1040({ line31: "64,000." })), null);
  // Un K-1 que no dice que es no pasivo no entra.
  const investor = doc("investor K-1.pdf", traderFund().text.split("\n").filter((l) => !/NONPASSIVE/.test(l)));
  assert.strictEqual(k1.checkOtherDeductions(read([investor]), f1040()), null);
});

test("las deducciones de cartera de los K-1 deducidas en la linea 16 del Schedule A", () => {
  const f = k1.checkPortfolioDeductions(read([traderFund(), stakingFund]), f1040());
  assert.strictEqual(f.severity, "MEDIUM");
  assert.match(f.detail, /Schedule A line 16 deducts \$4,300 as "INVESTMENT EXP FROM K-1"\. That is the total of the K-1 box 13 portfolio deductions \(2 K-1s\)/);
  assert.strictEqual(k1.checkPortfolioDeductions(read([traderFund(), stakingFund]), f1040({ line16: ["GAMBLING LOSSES 2,000.", "16 2,000."] })), null, "otra cifra, otra deduccion");
  assert.strictEqual(k1.checkPortfolioDeductions(read([traderFund(), stakingFund]), f1040({ line16: ["16"] })), null);
});

test("el ingreso de la casilla 11ZZ que no esta en la declaracion", () => {
  const f = k1.checkOtherIncome(read([stakingFund, buyoutFund, traderFund()]), f1040());
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /EXAMPLE STAKING GP LLC \$18,000 \(income from staking activity\); EXAMPLE BUYOUT CO-INVESTORS LLC \$6,400 \(section 751 gain\); EXAMPLE TRADING GP LLC \(\$1,500\)/);
  assert.match(f.detail, /net \$22,900/);
  const reported = f1040({ extra: ["STAKING INCOME 18,000.", "SECTION 751 GAIN 6,400.", "SECTION 988 LOSS 1,700."] });
  assert.strictEqual(k1.checkOtherIncome(read([stakingFund, buyoutFund, traderFund()]), reported), null, "el total o un componente de mil o mas");
});

test("la recaracterizacion de la seccion 1061 que la declaracion no hace", () => {
  const f = k1.check1061(read([traderFund(), stakingFund, buyoutFund]), f1040());
  assert.strictEqual(f.severity, "HIGH");
  // 14,000 + 400,000 + 19,000 de un año; (2,000) + 370,000 + 19,000 de tres.
  assert.match(f.detail, /Worksheet A on 3 K-1s shows \$433,000 of long-term gain on applicable partnership interests, of which \$387,000 is from assets held more than three years: about \$46,000 is taxed as short-term/);
  assert.strictEqual(k1.check1061(read([traderFund(), stakingFund]), f1040({ extra: ["Form 8949 SECTION 1061 ADJUSTMENT 46,000."] })), null);
  assert.strictEqual(k1.check1061(read([buyoutFund]), f1040()), null, "todo de mas de tres años: nada que recaracterizar");
});

test("el credito PTET de Nueva York informado en los K-1 y sin reclamar", () => {
  const f = k1.checkNyPtetCredit(read([traderFund()]), f1040());
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /\$3,000 for the state \(code 653\) and \$1,200 for New York City \(code B53\)/);
  assert.strictEqual(k1.checkNyPtetCredit(read([traderFund()]), f1040({ extra: ["Form IT-653 Pass-Through Entity Tax Credit"] })), null);
  assert.strictEqual(k1.checkNyPtetCredit(read([traderFund()]), f1040({ ny: false })), null, "sin declaracion de Nueva York");
  assert.strictEqual(k1.checkNyPtetCredit(read([stakingFund]), f1040()), null, "un K-1 sin creditos");
});

test("todo junto: un archivo repetido cuenta una vez, y fuera de un 1040 no corre", () => {
  const found = k1.runK1Checks(pkg(f1040(), [traderFund(), { ...traderFund(), name: "EXAMPLE TRADING GP LLC K-1 (1).pdf" }, stakingFund, buyoutFund]), META);
  assert.deepStrictEqual(found.map((f) => f.title), [
    "Schedule E — K-1 box 13, code ZZ deductions of trading partnerships not deducted",
    "Schedule A line 16 — K-1 portfolio deductions deducted",
    "Schedule K-1 box 11, code ZZ — other income not found on the return",
    "Schedule D — section 1061 recharacterization of carried interest not made",
    "Form IT-653 — New York pass-through entity tax credit not claimed",
  ]);
  assert.match(found[0].detail, /1 K-1 from partnerships/, "el duplicado no suma");
  // El 1256 de un solo K-1 con la perdida en la columna de ganancias.
  const flipped = k1.runK1Checks(pkg(f1040({ loss6781: "", gain6781: "30,000.", net6781: "30,000." }), [traderFund()]), META);
  assert.ok(flipped.some((f) => /Form 6781/.test(f.title)));
  const partnership = "Form 1065 U.S. Return of Partnership Income 2025\nName of partnership\nEXAMPLE PARTNERS LLC 12-3456789\n" + PAD;
  assert.deepStrictEqual(k1.runK1Checks(pkg(partnership, [traderFund()]), META), []);
  assert.deepStrictEqual(k1.runK1Checks(pkg(f1040(), []), META), [], "sin K-1 no hay nada que cruzar");
});
