"use strict";
// Cruces del 1040. Nombres, SSN, direcciones y cifras ficticios; el formato de los renglones es
// el que imprime pdf.js sobre declaraciones reales (importe despues del numero de linea repetido,
// la X delante de la casilla marcada, respuestas anotadas como [ANSWER: ...]).
const { test } = require("node:test");
const assert = require("node:assert");
const ic = require("../lib/individual-checks");
const rf = require("../lib/return-facts");

const PAD = "Statement filler text for a return of normal length. ".repeat(12);
const NOW = "2026-09-19T12:00:00Z";

/* --- Un 1040 ficticio: cada renglon se puede reemplazar ---------------------- */

function f1040(o = {}) {
  const v = {
    year: 2025, status: "X Married filing jointly", spouse: "JOHN EXAMPLE 000-11-2222", you: "JANE EXAMPLE 000-11-1111",
    deps: [], boxes: "d You: Were born before January 2, 1961 Are blind", dependent: "12a Someone can claim You as a dependent Your spouse as a dependent",
    l1a: "85,000.", l2a: "", l2b: "", l3a: "", l3b: "", l7: "", l11: "90,000.", l12: "31,500.", l13: "", l13b: "", l15: "58,500.", l16: "6,500.",
    l19: "", l22: "6,500.", l24: "6,500.", l25a: "9,000.", l25d: "9,000.", l26: "", l27: "", l28: "", l33: "9,000.", l34: "2,500.", l35a: "2,500.",
    l36: "", l37: "", l38: "", routing: "", account: "", extra: [],
    ...o,
  };
  return [
    "--- Page 1 ---",
    `Form 1040 U.S. Individual Income Tax Return ${v.year} OMB No. 1545-0074`,
    "Your first name and middle initial Last name Your social security number",
    v.you,
    "If joint return, spouse's first name and middle initial Last name Spouse's social security number",
    v.spouse,
    "Home address (number and street). If you have a P.O. box, see instructions. Apt. no.",
    "100 EXAMPLE ROAD",
    "City, town, or post office. State ZIP code",
    "SPRINGFIELD, IL 62701",
    `Filing Status ${v.status}`,
    "Dependents (see instructions):",
    ...v.deps.map((d) => `EXAMPLE CHILD ${d} Son`),
    `Income 1 a Total amount from Form(s) W-2, box 1 (see instructions) . . . . . 1a ${v.l1a}`,
    `Attach Sch. B 2a Tax-exempt interest . . . 2a ${v.l2a} b Taxable interest . . . . . 2b ${v.l2b}`,
    `3a Qualified dividends . . . 3a ${v.l3a} b Ordinary dividends . . . . . 3b ${v.l3b}`,
    `7 Capital gain or (loss). Attach Schedule D if required . . . . . . 7 ${v.l7}`,
    `11 Subtract line 10 from line 9. This is your adjusted gross income . . . . . 11 ${v.l11}`,
    v.dependent,
    v.boxes,
    `e Standard deduction or itemized deductions (from Schedule A) . . . . . . 12 ${v.l12}`,
    `13 a Qualified business income deduction from Form 8995 or Form 8995-A . . . . 13a ${v.l13}`,
    `b Additional deductions from Schedule 1-A, line 38 . . . . . . . 13b ${v.l13b}`,
    `15 Subtract line 14 from line 11. If zero or less, enter -0-. This is your taxable income . . . 15 ${v.l15}`,
    `16 Tax (see instructions). Check if any from Form(s): . . . . . . 16 ${v.l16}`,
    `19 Child tax credit or credit for other dependents from Schedule 8812 . . . . 19 ${v.l19}`,
    `22 Subtract line 21 from line 18. If zero or less, enter -0- . . . . . 22 ${v.l22}`,
    `24 Add lines 22 and 23. This is your total tax . . . . . . . . . 24 ${v.l24}`,
    `25 Federal income tax withheld from: a Form(s) W-2 . . . . . . . 25a ${v.l25a}`,
    `d Add lines 25a through 25c . . . . . . . . . . . . 25d ${v.l25d}`,
    `26 ${v.year} estimated tax payments and amount applied from ${v.year - 1} return . . . . . 26 ${v.l26}`,
    `27a Earned income credit (EIC) . . . . . . . . . . . 27a ${v.l27}`,
    `28 Additional child tax credit (ACTC) from Schedule 8812 . . . . . 28 ${v.l28}`,
    `33 Add lines 25d, 26, and 32. These are your total payments . . . . . . 33 ${v.l33}`,
    `34 If line 33 is more than line 24, subtract line 24 from line 33. This is the amount you overpaid . . 34 ${v.l34}`,
    `35a Amount of line 34 you want refunded to you. If Form 8888 is attached, check here . . 35a ${v.l35a}`,
    `b Routing number ${v.routing} c Type: Checking Savings`,
    `d Account number ${v.account}`,
    `36 Amount of line 34 you want applied to your ${v.year + 1} estimated tax . . 36 ${v.l36}`,
    `37 Subtract line 33 from line 24. This is the amount you owe . . . . . . 37 ${v.l37}`,
    `38 Estimated tax penalty (see instructions) . . . . . . . . . 38 ${v.l38}`,
    PAD,
    ...v.extra,
  ].join("\n");
}

function pkg(current, prior, extra = []) {
  return [
    { name: "Example 2025 return.pdf", reviewRole: "current_return", text: current },
    ...(prior ? [{ name: "Example 2024 return.pdf", reviewRole: "prior_return", text: prior }] : []),
    ...extra,
  ];
}

const META = { taxYear: "2025", now: NOW };
const run = (files, check, meta = META) => check(ic.context(files, meta));
const prior1040 = (o = {}) => f1040({ year: 2024, l12: "29,200.", ...o });

/* --- Lectura ---------------------------------------------------------------- */

test("el 1040 ficticio se lee: renglones, encabezado y casillas", () => {
  const text = f1040({ boxes: "d You: X Were born before January 2, 1961 Are blind", deps: ["000-33-4444"] });
  const L = rf.form1040Lines(text);
  assert.strictEqual(L["1a"], 85000);
  assert.strictEqual(L["11"], 90000);
  assert.strictEqual(L["12"], 31500);
  assert.strictEqual(L["25d"], 9000);
  const h = rf.header1040(text);
  assert.strictEqual(h.filingStatus, "mfj");
  assert.strictEqual(h.spouse.ssn, "000-11-2222");
  assert.deepStrictEqual(h.dependents, ["000-33-4444"]);
  assert.deepStrictEqual(rf.checkboxes1040(text), { anyX: true, over65: 1, blind: 0, dependentOfAnother: false });
});

/* --- Identidad y arrastres (modulo anterior) -------------------------------- */

test("un SSN del conyuge que cambia uno o dos digitos es un hallazgo alto", () => {
  const [f] = run(pkg(f1040({ spouse: "JOHN EXAMPLE 000-11-2229" }), prior1040()), ic.checkSpouseSsn);
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /ends in 2229; last year's return shows 2222, a difference of one or two digits/);
});

test("el sobrepago aplicado el año pasado tiene que estar en la linea 26", () => {
  const [f] = run(pkg(f1040(), prior1040({ l36: "3,000." })), ic.checkOverpaymentApplied);
  assert.match(f.detail, /applied \$3,000/);
  assert.deepStrictEqual(run(pkg(f1040({ l26: "3,000." }), prior1040({ l36: "3,000." })), ic.checkOverpaymentApplied), []);
});

test("perdida neta el año pasado sin perdida operativa este año", () => {
  const [f] = run(pkg(f1040(), prior1040({ l11: "-50,000." })), ic.checkNolCarryover);
  assert.match(f.detail, /-\$50,000|\$50,000/);
  assert.deepStrictEqual(run(pkg(f1040(), prior1040()), ic.checkNolCarryover), []);
});

test("la perdida del QBI que el año pasado paso a este año no puede desaparecer", () => {
  const prior = prior1040({ extra: ["16 Total qualified business (loss) carryforward. Combine lines 2 and 3. If greater than zero, enter -0- . . 16 ( 12,000. )"] });
  const current = f1040({ extra: ["3 Qualified business net (loss) carryforward from the prior year . . . . . . 3 ( )"] });
  const [f] = run(pkg(current, prior), ic.checkQbiLossCarryover);
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /carried \$12,000 of qualified business net loss to this year, and this return brings in nothing/);
  const brought = f1040({ extra: ["3 Qualified business net (loss) carryforward from the prior year . . . . . . 3 ( 12,000. )"] });
  assert.deepStrictEqual(run(pkg(brought, prior), ic.checkQbiLossCarryover), []);
});

test("los intereses de inversion no deducidos pasan al Form 4952 del año siguiente", () => {
  const prior = prior1040({ extra: ["7 Disallowed investment interest expense to be carried forward to 2025. Subtract line 6 from line 3. If zero or", "less, enter -0- . . . . . . . . . . 7 3,000."] });
  const current = f1040({ extra: ["2 Disallowed investment interest expense from 2024 Form 4952, line 7 . . . . . . 2"] });
  const [f] = run(pkg(current, prior), ic.checkInvestmentInterestCarryover);
  assert.match(f.detail, /carried \$3,000 of disallowed investment interest/);
});

/* --- Pagos ------------------------------------------------------------------- */

test("anticipos por debajo del safe harbor sin Form 2210 ni linea 38", () => {
  const current = f1040({ l24: "50,000.", l25a: "10,000.", l25d: "10,000.", l33: "10,000.", l34: "", l35a: "", l37: "40,000." });
  const prior = prior1040({ l24: "30,000.", l11: "120,000." });
  const [f] = run(pkg(current, prior), ic.checkEstimatedTaxPenalty);
  assert.match(f.detail, /add to \$10,000; the safe harbor was the smaller of 90% of this year's tax \(\$45,000\) and 100% of last year's tax \(\$30,000\), so at least \$20,000 was underpaid/);
  const safe = prior1040({ l24: "9,000.", l11: "120,000." });
  assert.deepStrictEqual(run(pkg(current, safe), ic.checkEstimatedTaxPenalty), [], "con el 100% del año anterior pagado no hay multa");
  const withPenalty = f1040({ l24: "50,000.", l25a: "10,000.", l25d: "10,000.", l37: "40,500.", l38: "500." });
  assert.deepStrictEqual(run(pkg(withPenalty, prior), ic.checkEstimatedTaxPenalty), [], "la multa ya esta calculada");
});

test("cuotas del 1040-ES con vencimiento anterior a la revision", () => {
  const vouchers = [1, 2, 3, 4].map((n, i) => [`Form 1040-ES Payment Voucher ${n}`, `Due ${["4/15/2026", "6/15/2026", "9/15/2026", "1/15/2027"][i]}`, "Amount of estimated tax you are paying by check or money order . . 5,000."]).flat();
  const [f] = run(pkg(f1040({ extra: vouchers })), ic.checkVouchersPastDue);
  assert.match(f.detail, /3 of the 4 estimate vouchers printed with this return \(\$15,000\) were due on 4\/15\/2026, 6\/15\/2026, 9\/15\/2026/);
  assert.deepStrictEqual(run(pkg(f1040({ extra: vouchers })), ic.checkVouchersPastDue, { taxYear: "2025", now: "2026-03-01T00:00:00Z" }), []);
});

test("un debito pedido para una fecha que ya paso", () => {
  const [f] = run(pkg(f1040({ extra: ["Requested Payment Date 04/15/2026"] })), ic.checkDebitDatesPast);
  assert.match(f.detail, /04\/15\/2026/);
});

test("la cuenta del reintegro cambia de un año al otro", () => {
  const [f] = run(pkg(f1040({ routing: "0 1 1 0 0 0 0 1 5", account: "1 2 3 4 5 6 7 8" }), prior1040({ routing: "0 1 1 0 0 0 0 1 5", account: "9 9 9 9 5 6 7 1" })), ic.checkRefundAccountChanged);
  assert.strictEqual(f.severity, "LOW");
  assert.match(f.detail, /ends in 5678; last year's ended in 5671/);
});

test("California: el sobrepago aplicado el año pasado tiene que estar en los pagos de este año", () => {
  const prior = prior1040({ extra: ["98 Amount of line 97 you want applied to your 2025 estimated tax . . . . @ 98 10,500."] });
  const [f] = run(pkg(f1040({ extra: ["72 2025 California estimated tax and other payments. See instructions . . . @ 72 5,000."] }), prior), ic.checkCaliforniaOverpaymentApplied);
  assert.match(f.detail, /applied \$10,500 .* shows \$5,000/);
  assert.deepStrictEqual(run(pkg(f1040({ extra: ["72 2025 California estimated tax and other payments. See instructions . . . @ 72 15,100."] }), prior), ic.checkCaliforniaOverpaymentApplied), []);
});

/* --- Deducciones y creditos -------------------------------------------------- */

test("la deduccion estandar que no corresponde al estado civil", () => {
  const [f] = run(pkg(f1040({ l12: "29,200." })), ic.checkStandardDeduction);
  assert.match(f.detail, /Line 12 is \$29,200; the 2025 standard deduction for Married filing jointly is \$31,500/);
  const senior = f1040({ boxes: "d You: X Were born before January 2, 1961 Are blind", l12: "33,100." });
  assert.deepStrictEqual(run(pkg(senior), ic.checkStandardDeduction), [], "31,500 + 1,600 por la casilla de edad");
  const noMarks = f1040({ status: "Married filing jointly", l12: "29,200." });
  assert.deepStrictEqual(run(pkg(noMarks), ic.checkStandardDeduction), [], "un PDF sin X no permite saber el estado civil");
});

const scheduleA = (d, e, total = "45,000.") => [
  "SCHEDULE A Itemized Deductions OMB No. 1545-0074",
  "(Form 1040)",
  "Go to www.irs.gov/ScheduleA for instructions and the latest information.",
  "d Add lines 5a through 5c . . . . . . . . 5d " + d,
  "e Enter the smaller of line 5d or $40,000 ($20,000 if married filing separately). If",
  "Puerto Rico, see instructions. . . . . . . . 5e " + e,
  "be limited. See Form 1098. See instructions if limited . . . . . 8a 12,000.",
  "Form 1040 or 1040-SR, line 12e. . . . . . . . . . 17 " + total,
];

test("SALT: por encima del tope es alto; por debajo del tope de 2025 es medio", () => {
  const over = f1040({ l11: "300,000.", l12: "45,000.", extra: scheduleA("45,000.", "42,000.") });
  const [a] = run(pkg(over), ic.checkSaltAndItemized);
  assert.strictEqual(a.severity, "HIGH");
  assert.match(a.detail, /limit for Married filing jointly is \$40,000/);
  const under = f1040({ l11: "300,000.", l12: "45,000.", extra: scheduleA("45,000.", "10,000.") });
  const [b] = run(pkg(under), ic.checkSaltAndItemized);
  assert.match(b.title, /below the allowed cap/);
  const rich = f1040({ l11: "700,000.", l12: "45,000.", extra: scheduleA("45,000.", "10,000.") });
  assert.deepStrictEqual(run(pkg(rich), ic.checkSaltAndItemized), [], "con $700,000 de ingreso el tope baja a $10,000");
});

test("el tope de SALT de 2025 baja 30% por encima de $500,000 y nunca debajo de $10,000", () => {
  assert.strictEqual(ic.saltCap(2025, "mfj", 400000), 40000);
  assert.strictEqual(ic.saltCap(2025, "mfj", 550000), 25000);
  assert.strictEqual(ic.saltCap(2025, "mfj", 900000), 10000);
  assert.strictEqual(ic.saltCap(2025, "mfs", 300000), 5000);
  assert.strictEqual(ic.saltCap(2024, "single", 100000), 10000);
});

test("itemizar por debajo de la deduccion estandar", () => {
  const [f] = run(pkg(f1040({ l12: "20,000.", extra: scheduleA("5,000.", "5,000.", "20,000.") })), ic.checkSaltAndItemized);
  assert.match(f.title, /itemized deductions below the standard deduction/);
});

test("credito por ingreso del trabajo con ingresos de inversion por encima del limite", () => {
  const [f] = run(pkg(f1040({ l27: "600.", l2b: "12,500." })), ic.checkEicInvestmentIncome);
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /limit is \$11,950/);
});

test("un dependiente con ingresos de inversion y sin Form 8615", () => {
  const text = f1040({ status: "X Single", spouse: "", dependent: "12a Someone can claim X You as a dependent Your spouse as a dependent", l3b: "4,000.", l2b: "" });
  const [f] = run(pkg(text), ic.checkKiddieTax);
  assert.match(f.detail, /\$4,000 of interest, dividends and capital gains \(over \$2,700\)/);
});

test("ganancia de Schedule C sin Schedule SE ni deduccion QBI", () => {
  const s1 = ["SCHEDULE 1 Additional Income and Adjustments to Income", "3 Business income or (loss). Attach Schedule C . . . . . 3 30,000."];
  const files = pkg(f1040({ extra: s1 }));
  assert.match(run(files, ic.checkSelfEmploymentTax)[0].title, /Schedule SE/);
  assert.match(run(files, ic.checkQbiDeduction)[0].title, /Form 8995/);
  const withForms = pkg(f1040({ l13: "6,000.", extra: [...s1, "SCHEDULE SE (Form 1040)", "Qualified Business Income Deduction Simplified Computation"] }));
  assert.deepStrictEqual(run(withForms, ic.checkSelfEmploymentTax), []);
  assert.deepStrictEqual(run(withForms, ic.checkQbiDeduction), []);
});

test("mayor de 65 sin la deduccion para seniors del Schedule 1-A", () => {
  const text = f1040({ boxes: "d You: X Were born before January 2, 1961 Are blind", l12: "33,100.", l11: "120,000." });
  const [f] = run(pkg(text), ic.checkSeniorDeduction);
  assert.match(f.detail, /worth about \$6,000/);
  const high = f1040({ boxes: "d You: X Were born before January 2, 1961 Are blind", l11: "260,000." });
  assert.deepStrictEqual(run(pkg(high), ic.checkSeniorDeduction), [], "por encima de $250,000 en conjunta ya no hay deduccion");
  assert.deepStrictEqual(run(pkg(text), ic.checkSeniorDeduction, { taxYear: "2024", now: NOW }), [], "no existe antes de 2025");
});

test("credito por hijos sin Schedule 8812, y dependientes sin credito", () => {
  const [a] = run(pkg(f1040({ l19: "4,400." })), ic.checkChildCredits);
  assert.match(a.title, /without the schedule/);
  const [b] = run(pkg(f1040({ deps: ["000-33-4444", "000-33-5555"] })), ic.checkChildCredits);
  assert.match(b.detail, /lists 2 dependents/);
  assert.deepStrictEqual(run(pkg(f1040({ l19: "4,400.", extra: ["Go to www.irs.gov/Schedule8812 for instructions"] })), ic.checkChildCredits), []);
});

/* --- Documentos del paquete ---------------------------------------------------- */

const doc = (name, text) => ({ name, reviewRole: "supporting_document", text });

test("1099-S y 1099-B sin Schedule D ni Form 8949", () => {
  const files = pkg(f1040(), null, [
    doc("closing 1099-S.pdf", "Form 1099-S 2025 Proceeds From Real Estate Transactions\n2 Gross proceeds 450,000.00"),
    doc("broker 1099.pdf", "2025 Form 1099-B Proceeds From Broker and Barter Exchange Transactions\n1d Proceeds 12,000.00"),
  ]);
  const found = run(files, ic.moreDocumentChecks);
  assert.ok(found.some((f) => /1099-S — real estate sale not reported/.test(f.title)));
  assert.ok(found.some((f) => /1099-B — sales with no Schedule D/.test(f.title)));
});

test("W-2 con codigo W sin Form 8889", () => {
  const w2 = doc("w2.pdf", "2025 W-2 Wage and Tax Statement\n1 Wages, tips, other comp. 85,000.00\n12a W 3,000.00");
  const found = run(pkg(f1040(), null, [w2]), ic.moreDocumentChecks);
  assert.ok(found.some((f) => /code W/.test(f.title)));
});

test("una liquidacion de un canje 1031 sin Form 8824", () => {
  const settlement = doc("closing.pdf", "ALTA Settlement Statement\nSeller: JANE EXAMPLE\nSettlement Date: 3/1/2025\nFunds to Example Exchange Co., qualified intermediary, IRC 1031");
  const found = run(pkg(f1040(), null, [settlement]), ic.moreDocumentChecks);
  assert.ok(found.some((f) => /Form 8824/.test(f.title)));
});

test("mas de $1,500 de intereses sin Schedule B", () => {
  const found = run(pkg(f1040({ l2b: "2,000." })), ic.moreDocumentChecks);
  assert.ok(found.some((f) => /Schedule B — required/.test(f.title)));
});

test("la direccion pasa a otro estado de un año al otro", () => {
  const prior = prior1040().replace("SPRINGFIELD, IL 62701", "LAKEVIEW, MI 49001");
  const [f] = run(pkg(f1040(), prior), ic.checkStateMove);
  assert.match(f.detail, /gave a MI address \(LAKEVIEW\); this year's gives IL \(SPRINGFIELD\)/);
  assert.deepStrictEqual(run(pkg(f1040(), prior1040()), ic.checkStateMove), []);
});

test("los 1099 del paquete suman mas intereses y dividendos que la declaracion", () => {
  const broker = doc("broker.pdf", "Form 1099-INT 2025 Interest Income\n1. INTEREST INCOME $3,500.00\nForm 1099-DIV 2025 Dividends and Distributions\n1a. TOTAL ORDINARY DIVIDENDS $2,000.00");
  const copy = doc("broker copy.pdf", broker.text);
  const bank = doc("bank.pdf", "Form 1099-INT 2025\n1 Interest Income . . . . . . . . . 1,200.00 10 Market Discount . . . 0.00");
  const found = run(pkg(f1040({ l2b: "3,500.", l3b: "2,000." }), null, [broker, copy, bank]), ic.documentAmountChecks);
  assert.strictEqual(found.length, 1, "la copia repetida no se cuenta dos veces; los dividendos cierran");
  assert.match(found[0].detail, /add to at least \$4,700 \(broker\.pdf; bank\.pdf\), and line 2b \(taxable interest\) reports \$3,500/);
  assert.deepStrictEqual(run(pkg(f1040({ l2b: "4,700.", l3b: "2,000." }), null, [broker, bank]), ic.documentAmountChecks), []);
});

test("si la declaracion reporta mas que los documentos no se dice nada", () => {
  const broker = doc("broker.pdf", "Form 1099-INT 2025 Interest Income\n1. INTEREST INCOME $3,500.00");
  assert.deepStrictEqual(run(pkg(f1040({ l2b: "9,000." }), null, [broker]), ic.documentAmountChecks), []);
});

test("un 1040 limpio contra un año anterior limpio no dice nada", () => {
  assert.deepStrictEqual(ic.runIndividualChecks(pkg(f1040(), prior1040()), META), []);
});
