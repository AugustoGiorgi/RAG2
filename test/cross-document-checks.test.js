"use strict";
// Cruces que necesitan dos documentos a la vez. Nombres, direcciones y cifras ficticios; el
// formato de los renglones es el que imprime el extractor de la app sobre declaraciones reales.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  runCrossDocumentChecks, checkRentalSaleNotReported, checkRentalPropertyContinuity,
  checkLatePaymentExposure, checkK1WithoutSupport, checkEstimatedK1s, checkPartnerLiabilities,
  checkRentalExpensesOutOfProportion,
  scheduleEProperties, streetKey, monthsLate,
} = require("../lib/cross-document-checks");

const META = { taxYear: "2025", returnType: "1040" };
const SEPT = new Date(Date.UTC(2026, 8, 19));

/* --- Un 1040 ficticio, con las piezas que leen los cruces ----------------- */

function current1040({ letter = "September 16, 2026", owed = "40,000.", extension = true, forms4797 = false, deprLine = "18 700.", total23d = "23d 700.", k1Name = "EXAMPLE HOLDINGS LLC S 12-3456789 X" } = {}) {
  return [
    "--- Page 1 ---",
    "EXAMPLE CPA",
    letter,
    "JANE EXAMPLE",
    "--- Page 2 ---",
    `FEDERAL: 1040, SCH 1, SCH E${extension ? ", 4868" : ""}, 8582`,
    "Form 1040 U.S. Individual Income Tax Return 2025",
    "24 Add lines 22 and 23. This is your total tax . . . . . . . . . . . . 24 50,000.",
    "33 Add lines 25d, 26, and 32. These are your total payments . . . . . . . 33 10,000.",
    "Amount 37 Subtract line 33 from line 24. This is the amount you owe.",
    `For details on how to pay, go to www.irs.gov/Payments or see instructions . . . . . 37 ${owed}`,
    extension ? "10 Amount paid with request for extension to file (see instructions) . . . . . 10 5,000." : "10 Amount paid with request for extension to file (see instructions) . . . . . 10",
    "Name(s) shown on return Your social security number",
    "JANE EXAMPLE 000-00-0000",
    "1a Physical address of each property (street, city, state, ZIP code)",
    "A 100 MAPLE STREET, SPRINGFIELD, IL 62701",
    "B 200 OAK AVENUE, SPRINGFIELD, IL 62702",
    "C",
    "1b Type of Property 2 For each rental real estate property listed",
    "(from list below) Fair Rental Days Personal Use Days QJV",
    "A 1 personal use days. Check the QJV box A 365",
    "B 1 B 40",
    "Type of Property:",
    "3 Rents received . . . . . . . . . . 3 18,000. 2,000.",
    `18 Depreciation expense or depletion . . . . . . . . . . . ${deprLine}`,
    `d Total of all amounts reported on line 18 for all properties . . . . . . ${total23d}`,
    "28 (a) Name foreign identification any amount",
    k1Name ? `A ${k1Name}` : "A",
    "Passive Income and Loss Nonpassive Income and Loss",
    forms4797 ? "Form 4797 Sales of Business Property" : "",
    "Part VII Allocation of Unallowed Losses. See instructions.",
    "200 OAK AVENUE SCH E LN 22 9,000. 1.000000 8,000.",
    "Total . . . . . . . . . . 9,000. 1.00 8,000.",
  ].join("\n");
}

// Una declaracion real tiene decenas de paginas; splitReturns descarta textos de menos de 500
// caracteres, asi que el año anterior ficticio lleva relleno.
const PRIOR_1040 = [
  "Form 1040 U.S. Individual Income Tax Return 2024",
  "Filler page text ".repeat(30),
  "1a Physical address of each property (street, city, state, ZIP code)",
  "A 100 maple street springfield IL 62701",
  "B 200 oak avenue springfield IL 62702",
  "C 300 Pine Rd, Lakeview IL 60601",
  "1b Type of Property 2 For each rental real estate property listed Fair Rental Personal Use",
  "A 1 personal use days. Check the QJV box only 366 0",
  "B 1 B 366 0",
  "C 2 C 90 0",
  "Type of Property:",
  "18 Depreciation expense or depletion . . . . . . . 18 3,000. 4,000. 5,000.",
].join("\n");

const settlement = ({ seller = "JANE EXAMPLE", date = "3/1/2025", address = "200 OAK AVENUE" } = {}) => [
  "--- Page 1 ---",
  "American Land Title Association ALTA Settlement Statement - Combined",
  `Property Address: ${address}`,
  "SPRINGFIELD, IL 62702",
  "Borrower: EXAMPLE BUYER TRUST",
  `Seller: ${seller}`,
  `Settlement Date: ${date}`,
  "$250,000.00 Contract sales price $250,000.00",
].join("\n");

function pkg(currentText, extra = [], prior = PRIOR_1040) {
  return [
    { name: "Client 2025 return.pdf", reviewRole: "current_return", text: currentText },
    { name: "Client 2024 return.pdf", reviewRole: "prior_return", text: prior },
    ...extra,
  ];
}

/* --- Lectura del Schedule E ---------------------------------------------- */

test("el Schedule E se lee en los dos formatos de dias de alquiler", () => {
  const now = scheduleEProperties(current1040());
  assert.deepStrictEqual(now.properties.map((p) => [p.key, p.fairDays]), [["100 maple", 365], ["200 oak", 40]]);
  assert.strictEqual(now.depreciationByProperty, false, "un importe para dos propiedades no se asigna");
  assert.strictEqual(now.totalDepreciation, 700);
  const before = scheduleEProperties(PRIOR_1040);
  assert.deepStrictEqual(before.properties.map((p) => [p.key, p.fairDays, p.depreciation]), [["100 maple", 366, 3000], ["200 oak", 366, 4000], ["300 pine", 90, 5000]]);
});

test("la clave de una direccion es el numero y la primera palabra", () => {
  assert.strictEqual(streetKey("200 OAK AVENUE, SPRINGFIELD"), "200 oak");
  assert.strictEqual(streetKey("200 oak avenue springfield"), "200 oak");
  assert.strictEqual(streetKey("PO Box 12"), "");
  assert.strictEqual(streetKey("120 N 5th St"), "120 n 5th", "un punto cardinal va con la palabra siguiente");
});

/* --- 1. Venta sin Form 4797 ---------------------------------------------- */

test("una liquidacion de venta de una propiedad del Schedule E sin Form 4797 es un hallazgo alto", () => {
  const [f] = checkRentalSaleNotReported(pkg(current1040(), [{ name: "closing.pdf", reviewRole: "supporting_document", text: settlement() }]), META);
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /selling 200 OAK AVENUE on March 1, 2025 for a contract price of \$250,000/);
  assert.match(f.detail, /\$8,000 of this property's suspended passive losses/);
});

test("si la declaracion trae Form 4797, no se afirma que falte", () => {
  const files = pkg(current1040({ forms4797: true }), [{ name: "closing.pdf", reviewRole: "supporting_document", text: settlement() }]);
  assert.deepStrictEqual(checkRentalSaleNotReported(files, META), []);
});

test("una compra, o una venta de otro año, no disparan nada", () => {
  const compra = pkg(current1040(), [{ name: "closing.pdf", text: settlement({ seller: "ACME RESIDENTIAL HOLDINGS LLC" }) }]);
  assert.deepStrictEqual(checkRentalSaleNotReported(compra, META), [], "el contribuyente no es el vendedor");
  const otroAno = pkg(current1040(), [{ name: "closing.pdf", text: settlement({ date: "1/20/2026" }) }]);
  assert.deepStrictEqual(checkRentalSaleNotReported(otroAno, META), []);
});

test("la liquidacion adentro de un ZIP tambien cuenta", () => {
  const zip = { name: "Docs.zip", reviewRole: "supporting_document", text: `--- ZIP ENTRY: Docs/w2.pdf ---\nW-2 text\n\n--- ZIP ENTRY: Docs/closing.pdf ---\n${settlement()}` };
  const [f] = checkRentalSaleNotReported(pkg(current1040(), [zip]), META);
  assert.match(f.detail, /\(closing\.pdf\)/);
});

/* --- 2. Propiedades que desaparecen o dejan de depreciarse --------------- */

test("una propiedad del año pasado que no esta ni se vendio es un hallazgo", () => {
  const found = checkRentalPropertyContinuity(pkg(current1040()), META);
  const dropped = found.find((f) => /dropped from the return/.test(f.title));
  assert.match(dropped.detail, /300 Pine Rd/);
  assert.match(dropped.detail, /\$5,000 of depreciation/);
});

test("si hay liquidacion de la propiedad que falta, no se dice que desaparecio", () => {
  const files = pkg(current1040(), [{ name: "closing.pdf", text: settlement({ address: "300 Pine Rd" }) }]);
  assert.ok(!checkRentalPropertyContinuity(files, META).some((f) => /dropped from the return/.test(f.title)));
});

test("una propiedad alquilada todo el año cuya depreciacion cae se marca contra el total del 23d", () => {
  const found = checkRentalPropertyContinuity(pkg(current1040()), META);
  const depr = found.find((f) => /depreciation dropped/.test(f.title));
  assert.match(depr.detail, /100 MAPLE STREET.*rented 365 days this year and depreciated \$3,000 last year/);
  assert.match(depr.detail, /\$700 of depreciation this year \(line 23d\)/);
});

test("con un importe por propiedad se compara cada una, y la que sigue igual no se marca", () => {
  const files = pkg(current1040({ deprLine: "18 2,900. 700.", total23d: "23d 3,600." }));
  assert.ok(!checkRentalPropertyContinuity(files, META).some((f) => /depreciation dropped/.test(f.title)));
});

/* --- 2b. Gastos de año entero en una propiedad alquilada unas semanas ------ */

test("una propiedad alquilada pocos dias con gastos que multiplican las rentas es un hallazgo", () => {
  const text = current1040().replace("3 18,000. 2,000.", "3 18,000. 300.")
    + "\n20 Total expenses. Add lines 5 through 19 . . . . . . . 20 12,000. 9,500.";
  const [f] = checkRentalExpensesOutOfProportion(pkg(text), META);
  assert.match(f.detail, /200 OAK AVENUE.*rented 40 days and reports \$300 of rents against \$9,500 of expenses/);
  assert.doesNotMatch(f.detail, /100 MAPLE/, "la alquilada todo el año no se marca");
});

test("si los gastos no se pueden asignar por propiedad, no se adivina", () => {
  const text = current1040() + "\n20 Total expenses. Add lines 5 through 19 . . . . . . . 20 21,500.";
  assert.deepStrictEqual(checkRentalExpensesOutOfProportion(pkg(text), META), []);
});

/* --- 3. Saldo a pagar pagado tarde ---------------------------------------- */

test("un saldo que se paga despues del 15 de abril lleva recargo e intereses", () => {
  const [f] = checkLatePaymentExposure(pkg(current1040()), META, { now: SEPT });
  assert.strictEqual(f.severity, "MEDIUM", "con prorroga no hay recargo por presentacion tardia");
  assert.match(f.detail, /\$40,000 owed on \$50,000 of tax, with \$10,000 paid by April 15, 2026 \(20%\)/);
  assert.match(f.detail, /6 months past due/);
  assert.match(f.detail, /about \$1,200 of late-payment penalty/);
});

test("pagado a tiempo, nada", () => {
  assert.deepStrictEqual(checkLatePaymentExposure(pkg(current1040({ letter: "April 10, 2026" })), META, { now: SEPT }), []);
});

test("sin prorroga a la vista no se calcula el recargo por presentar tarde: se lo nombra", () => {
  // El 4868 se presenta aparte y muchas veces no queda impreso: no verlo no prueba que no exista.
  const [f] = checkLatePaymentExposure(pkg(current1040({ extension: false })), META, { now: SEPT });
  assert.strictEqual(f.severity, "MEDIUM");
  assert.match(f.detail, /if none was filed, the failure-to-file penalty/);
  assert.match(f.detail, /about \$1,200 of late-payment penalty/, "el de pago tardio corre igual");
  assert.match(f.action, /Confirm the extension was filed/);
});

test("con prorroga y el 90% pagado a tiempo, solo intereses", () => {
  const files = pkg(current1040({ owed: "4,000." }).replace("33 10,000.", "33 46,000."));
  const [f] = checkLatePaymentExposure(files, META, { now: SEPT });
  assert.match(f.detail, /does not apply because at least 90%/);
  assert.doesNotMatch(f.detail, /late-payment penalty \(/);
});

test("sin carta al cliente se usa la fecha de la revision", () => {
  const [f] = checkLatePaymentExposure(pkg(current1040({ letter: "" })), META, { now: SEPT });
  assert.match(f.detail, /As of this review \(September 19, 2026\)/);
});

test("los meses se cuentan como el §6651: una fraccion es un mes", () => {
  const due = new Date(Date.UTC(2026, 3, 15));
  assert.strictEqual(monthsLate(due, new Date(Date.UTC(2026, 4, 15))), 1);
  assert.strictEqual(monthsLate(due, new Date(Date.UTC(2026, 4, 16))), 2);
  assert.strictEqual(monthsLate(due, new Date(Date.UTC(2026, 8, 16))), 6);
});

/* --- 4. K-1 que falta ----------------------------------------------------- */

test("una entidad del Schedule E sin K-1 en el paquete es un hallazgo", () => {
  const [f] = checkK1WithoutSupport(pkg(current1040()), META);
  assert.match(f.detail, /EXAMPLE HOLDINGS LLC \(S corporation, EIN 12-3456789\)/);
});

test("con el K-1 en el paquete, por EIN o por nombre, nada", () => {
  const porEin = { name: "k1.pdf", text: "Schedule K-1 (Form 1120-S) Shareholder's Share of Income ... 123456789" };
  assert.deepStrictEqual(checkK1WithoutSupport(pkg(current1040(), [porEin]), META), []);
  const porNombre = { name: "holdings k1.pdf", text: "Schedule K-1 EXAMPLE HOLDINGS LLC" };
  assert.deepStrictEqual(checkK1WithoutSupport(pkg(current1040(), [porNombre]), META), []);
});

/* --- 5. K-1 estimados ------------------------------------------------------ */

const ESTIMADO = { name: "Fund estimate.pdf", reviewRole: "supporting_document", text: "--- Page 1 ---\nExample Income Fund - 2025 Estimated K-1\nBox 6A - Ordinary Dividends $ 50,000\nEnding Capital $ 900,000\nFinal K-1 No" };

test("un fondo que la declaracion reporta y cuyo unico K-1 es un estimado es un hallazgo", () => {
  const withFund = `${current1040()}\nA EXAMPLE INCOME FUND, LLC 98-7654321 PASSIVE`;
  const [f] = checkEstimatedK1s(pkg(withFund, [ESTIMADO]), META);
  assert.match(f.detail, /Example Income Fund \(Fund estimate\.pdf — "Box 6A - Ordinary Dividends \$ 50,000"\)/);
});

test("si hay un K-1 final del mismo fondo, el estimado quedo superado", () => {
  const withFund = `${current1040()}\nA EXAMPLE INCOME FUND, LLC 98-7654321 PASSIVE`;
  const final = { name: "Fund K-1.pdf", text: "Schedule K-1 (Form 1065) Part III Partner’s Share of Current Year Income\nEXAMPLE INCOME FUND, LLC" };
  assert.deepStrictEqual(checkEstimatedK1s(pkg(withFund, [ESTIMADO, final]), META), []);
});

test("un estimado de un fondo que la declaracion no menciona no se reporta", () => {
  assert.deepStrictEqual(checkEstimatedK1s(pkg(current1040(), [ESTIMADO]), META), []);
});

/* --- 6. Pasivos de los socios (1065) --------------------------------------- */

function k1Block(nrBegin, recBegin, nrEnd = "", recEnd = "") {
  return [
    "K1 Partner's share of liabilities: * STMT",
    "Beginning Ending 12 Section 179 deduction 21 Foreign taxes paid or accrued",
    `Nonrecourse . . . . . . $ ${nrBegin} $ ${nrEnd}`,
    "Qualified nonrecourse",
    "financing . . . . . . . . $ $ 13 Other deductions",
    `Recourse . . . . . . . . $ ${recBegin} $ ${recEnd}`,
  ].join("\n");
}

function return1065(blocks) {
  return [
    "Form 1065 U.S. Return of Partnership Income 2025",
    "Schedule L Balance Sheets per Books Beginning of tax year End of tax year",
    "15 Accounts payable . . . . . . . . . . . 1,000. 2,000.",
    "19 a Loans from partners (or persons related to partners) . . . . 99,000. 148,000.",
    "21 Partners' capital accounts . . . . . . . . . . 500,000. 550,000.",
    "22 Total liabilities and capital . . . . . . . . . . 600,000. 700,000.",
    ...blocks,
  ].join("\n");
}

test("item K con el saldo final en blanco y prestamos de socios como nonrecourse", () => {
  const files = [{ name: "LLC 2025 return.pdf", reviewRole: "current_return", text: return1065([k1Block("60,000.", ""), k1Block("40,000.", "")]) }];
  const [f] = checkPartnerLiabilities(files, { taxYear: "2025", returnType: "1065" });
  assert.match(f.detail, /blank on all 2 partner K-1s, while Schedule L ends the year with \$150,000 of liabilities, \$148,000 of them loans from partners/);
  assert.match(f.detail, /\$99,000 of loans from partners, but the K-1s carry only \$0 as recourse and \$100,000 as nonrecourse/);
});

test("el rotulo de la casilla siguiente no se lee como importe", () => {
  const files = [{ name: "LLC 2025 return.pdf", reviewRole: "current_return", text: return1065([k1Block("60,000.", "", "80,000.", "")]) }];
  const [f] = checkPartnerLiabilities(files, { taxYear: "2025" });
  assert.match(f.detail, /add to \$80,000, against \$150,000/, "el 13 de 'Other deductions' no suma");
});

test("prestamos asignados como recourse y totales que atan: nada", () => {
  const files = [{ name: "LLC 2025 return.pdf", reviewRole: "current_return", text: return1065([k1Block("1,000.", "99,000.", "2,000.", "148,000.")]) }];
  assert.deepStrictEqual(checkPartnerLiabilities(files, { taxYear: "2025" }), []);
});

/* --- Todo junto ------------------------------------------------------------- */

test("el conjunto no revienta con entradas vacias o raras", () => {
  assert.deepStrictEqual(runCrossDocumentChecks([], META), []);
  assert.deepStrictEqual(runCrossDocumentChecks([{ name: "x.pdf", text: "nada" }, null], META), []);
});
