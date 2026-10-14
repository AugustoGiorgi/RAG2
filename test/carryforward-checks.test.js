"use strict";
// Lo que la declaracion del año pasado dejo para este y este año no aparece
// (lib/carryforward-checks.js). Empresas, cifras y fechas ficticias; el formato es el de las
// paginas de resumen del programa del estudio ("GENERAL INFORMATION", "CARRYOVERS TO",
// "ESTIMATES", los resumenes estatales) tal como las deja pdf.js.
const { test } = require("node:test");
const assert = require("node:assert");
const cf = require("../lib/carryforward-checks");

const PAD = "Filler text so the return clears the minimum length. ".repeat(12);

const generalInfo = ({ year, forms, carryovers = [], estimates = [] }) => [
  "--- Page 8 ---",
  `${year} GENERAL INFORMATION PAGE 1`,
  "EXAMPLE TECH CORP 00-0000000",
  "FORMS NEEDED FOR THIS RETURN",
  `FEDERAL: ${forms}`,
  "NEW YORK: CT-3, CT-3.4, CT-3-M, NYC-2",
  `CARRYOVERS TO ${year + 1}`,
  "FEDERAL CARRYOVERS",
  ...carryovers,
  "NEW YORK CARRYOVERS",
  "NET OPERATING LOSS 400,000.",
  ...(estimates.length ? ["ESTIMATES", ...estimates] : []),
  "",
].join("\n");

const otherDeductions = (amortization) => ["STATEMENT 2", "FORM 1120, LINE 26", "OTHER DEDUCTIONS", "ACCOUNTING . . . . . . . . . . $ 9,000.", `AMORTIZATION . . . . . . . . . . ${amortization}.`, "TRAVEL . . . . . . . . . . 4,000.", "TOTAL $ 99,000."].join("\n");
const m1Line8 = (amortization) => ["STATEMENT 8", "FORM 1120, SCHEDULE M-1, LINE 8", "DEDUCTIONS NOT ON BOOKS", `AMORTIZATION . . . . . . . . . . $ ${amortization}.`, `TOTAL $ ${amortization}.`].join("\n");

const prior = ({ forms = "1120, SCH G, 3800, 5471, 6765, 7004", credit = true, amortization = "40,000", estimates = true } = {}) => [
  "U.S. Corporation Income Tax Return 2024",
  generalInfo({
    year: 2024,
    forms,
    carryovers: [...(credit ? ["GENERAL BUSINESS CREDITS 18,500."] : []), "NET OPERATING LOSS 500,000."],
    estimates: estimates ? ["NEW YORK CITY ESTIMATES", "ESTIMATE OVERPAYMENT BALANCE", "3/17/25 300. 0. 300. PAID", "6/16/25 0. 0. 0.", "TOTAL $ 300. $ 0. $ 300."] : [],
  }),
  otherDeductions(amortization),
  m1Line8(amortization),
  PAD,
].join("\n");

const current = ({ forms = "1120, SCH G, 5471, 7004", carryovers = ["NET OPERATING LOSS 900,000."], amortization = "900", nycPrepaid = "", ct3Prepaid = "", mfi = true } = {}) => [
  "U.S. Corporation Income Tax Return 2025",
  "--- Page 5 ---",
  "2025 NEW YORK INCOME TAX SUMMARY PAGE 1",
  "2025 2024 DIFF",
  "NEW YORK STATE SUMMARY",
  "STATE TAX COMPUTATION",
  "TOTAL TAX DUE . . . . . . . . . . 1,200 500 700",
  ...(mfi ? ["FORM CT-300 MANDATORY FIRST INSTALLMENT . . 0 300 -300", "MTA TAX SURCHARGE", "MTA SURCHARGE . . . . . . . . 360 150 210", "FORM CT-300 MANDATORY FIRST INSTALLMENT . . 0 90 -90"] : []),
  "NEW YORK CITY SUMMARY",
  ...(mfi ? ["FORM NYC-300 MANDATORY FIRST INSTALLMENT 0 300 -300"] : []),
  generalInfo({ year: 2025, forms, carryovers }),
  otherDeductions(amortization),
  "--- Page 37 ---",
  "Prepayments",
  "11 Mandatory first installment (MFI) from Form CT-300 (see instr.) . . . . . . 11",
  `18 Total prepayments (add lines 11 through 17; see instructions) . . . . . . . . . . ? 18 ${ct3Prepaid}`.trimEnd(),
  "--- Page 60 ---",
  "7 Total prepayments from line 92 . . . . . . . . . . . . . . . . 7",
  "--- Page 64 ---",
  `13 Total prepayments (from Composition of Prepayments Schedule, page 2, line G or H) (See Instructions) . . 13. ${nycPrepaid}`.trimEnd(),
  PAD,
].join("\n");

const run = (cur, pri, meta = { taxYear: "2025" }) => cf.runCarryforwardChecks([
  { name: "2025.pdf", reviewRole: "current_return", text: cur },
  { name: "2024.pdf", reviewRole: "prior_return", text: pri },
], meta);

test("los arrastres se leen por seccion, aunque el bloque siga en la pagina siguiente", () => {
  const text = ["CARRYOVERS TO 2026", "FEDERAL CARRYOVERS", "GEN BUS CREDIT: FORM 8846 1,200.", "CONTRIBUTIONS (60%) 71.", "", "--- Page 9 ---", "2025 GENERAL INFORMATION PAGE 2", "CARRYOVERS TO 2026 (CONTINUED)", "SHORT-TERM CAPITAL LOSS 5,000.", "NEW YORK CARRYOVERS", "NET OPERATING LOSS 9,000.", "ESTIMATES"].join("\n");
  assert.deepStrictEqual(cf.carryoverItems(text), [
    { section: "FEDERAL", label: "GEN BUS CREDIT: FORM 8846", amount: 1200 },
    { section: "FEDERAL", label: "CONTRIBUTIONS (60%)", amount: 71 },
    { section: "FEDERAL", label: "SHORT-TERM CAPITAL LOSS", amount: 5000 },
    { section: "NEW YORK", label: "NET OPERATING LOSS", amount: 9000 },
  ]);
});

test("un credito arrastrado que desaparece, con los formularios que lo generaban", () => {
  const found = run(current(), prior());
  const [f] = found.filter((x) => /general business credit/.test(x.title));
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /^Last year's return carried \$18,500 of general business credit to 2025 and filed Forms 3800 and 6765; this return files none of them, uses no credit and carries nothing to 2026\. If the research continued, this year's research credit was not computed either\.$/);
  assert.ok(f.detail.length <= 320);
  // Sigue en la lista, o se uso este año (hay un 3800): nada.
  assert.ok(!run(current({ carryovers: ["GEN BUS CREDIT: FORM 6765 18,500.", "NET OPERATING LOSS 900,000."] }), prior()).some((x) => /^Form 3800/.test(x.title)));
  assert.ok(!run(current({ forms: "1120, SCH G, 3800, 5471, 6765, 7004" }), prior()).some((x) => /^Form 3800/.test(x.title)));
});

test("un formulario de informacion extranjera que estaba y ya no esta", () => {
  const [f] = run(current({ forms: "1120, SCH G, 7004" }), prior({ credit: false, forms: "1120, SCH G, 5471, 7004" })).filter((x) => /missing this year/.test(x.title));
  assert.strictEqual(f.severity, "MEDIUM");
  assert.match(f.detail, /^Last year's return included Form 5471 \(foreign corporation information return\); this year's does not\. .*\$10,000 penalty per form\.$/);
  assert.deepStrictEqual(run(current(), prior({ credit: false, forms: "1120, SCH G, 5471, 7004" })).filter((x) => /missing this year/.test(x.title)), [], "si sigue, nada");
});

test("una amortizacion fuera de los libros que se cae de un año al otro", () => {
  const [f] = run(current(), prior()).filter((x) => /amortization/.test(x.title));
  assert.strictEqual(f.title, "Other deductions — amortization fell from $40,000 to $900");
  assert.match(f.detail, /a deduction that is not on the books \(Schedule M-1 line 8\); this year's deducts \$900\. If it was research costs capitalized under section 174 in 2022-2024, the balance not yet amortized can be deducted/);
  assert.deepStrictEqual(run(current({ amortization: "40,000" }), prior()).filter((x) => /amortization/.test(x.title)), [], "la misma amortizacion, nada");
  assert.deepStrictEqual(run(current(), prior({ amortization: "4,000" })).filter((x) => /amortization/.test(x.title)), [], "por debajo de 10.000 no se dice");
  // Antes de 2025 no se habla de la transicion de la seccion 174.
  const [old] = cf.checkAmortizationDropped(current(), prior(), 2024);
  assert.match(old.detail, /Find out what was being amortized and why it stopped\.$/);
});

test("pagos hechos para este año que esta declaracion no acredita", () => {
  const [f] = run(current(), prior()).filter((x) => /Prepayments/.test(x.title));
  assert.strictEqual(f.severity, "MEDIUM");
  assert.match(f.detail, /^The 2024 return records \$300 paid on 3\/17\/25 toward New York City, a first installment of \$300 for New York State and a first installment of \$90 for the MTA surcharge for 2025; NYC-2 line 13, CT-3 line 18 and CT-3-M line 7 credit nothing\.$/);
  // Acreditados, no se dice nada de esa jurisdiccion.
  const credited = run(current({ nycPrepaid: "300", ct3Prepaid: "300" }), prior()).find((x) => /Prepayments/.test(x.title));
  assert.match(credited.detail, /\$90 for the MTA surcharge/);
  assert.doesNotMatch(credited.detail, /New York City|New York State/);
  // Sin pagos ni primeras cuotas, nada.
  assert.ok(!run(current({ mfi: false }), prior({ estimates: false })).some((x) => /Prepayments/.test(x.title)));
});

test("sin la declaracion del año anterior, o con textos cortos, no se dice nada", () => {
  assert.deepStrictEqual(cf.runCarryforwardChecks([{ reviewRole: "current_return", text: current() }], { taxYear: "2025" }), []);
  assert.deepStrictEqual(run("corto", prior()), []);
  assert.deepStrictEqual(cf.runCarryforwardChecks([], {}), []);
});
