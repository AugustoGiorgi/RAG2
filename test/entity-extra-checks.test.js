"use strict";
// Cruces de entidades socio por socio. Nombres, numeros y cifras ficticios; el formato de los
// renglones es el que imprime pdf.js sobre declaraciones reales (la X delante de la casilla
// marcada, las respuestas anotadas como [ANSWER: ...], el importe despues del numero de linea).
const { test } = require("node:test");
const assert = require("node:assert");
const ee = require("../lib/entity-extra-checks");
const ef = require("../lib/entity-facts");

const META = { taxYear: "2025", returnType: "1065" };
const PAD = "Statement filler text for a return of normal length. ".repeat(12);

/* --- K-1 emitido ficticio -------------------------------------------------- */

function k1({ tin = "000-00-1111", name = "JOHN EXAMPLE", type = "INDIVIDUAL", final = false, pct = [60, 60], begin = "60,000", income = "78,000", end = "90,000", form = "1065" } = {}) {
  const who = form === "1065" ? "Partner" : "Shareholder";
  return [
    `${final ? "X " : ""}Final K-1 Amended K-1 OMB No. 1545-0123`,
    "Schedule K-1",
    `(Form ${form}) 2025`,
    "Part II Information About the Partner",
    form === "1065" ? `E ${who}'s SSN or TIN (Do not use TIN of a disregarded entity. See instructions.)` : `E ${who}'s identifying number`,
    tin,
    form === "1065" ? "F Name, address, city, state, and ZIP code for partner entered in E. See instructions." : `F ${who}'s name, address, city, state, and ZIP code`,
    name,
    "100 EXAMPLE ROAD",
    "SPRINGFIELD, IL 62701",
    `I1 What type of entity is this partner? ${type}`,
    `Profit ${pct[0]} % ${pct[1]} %`,
    `Loss ${pct[0]} % ${pct[1]} %`,
    `Capital ${pct[0]} % ${pct[1]} %`,
    `Beginning capital account . . . . . . . . $ ${begin}`,
    "Capital contributed during the year . . . $",
    `Current year net income (loss) . . . . . . $ ${income}`,
    "Withdrawals and distributions . . . . . . $ ( )",
    `Ending capital account . . . . . . . . . . $ ${end}`,
  ].join("\n");
}

/* --- 1065 ficticio ------------------------------------------------------- */

function f1065({
  year = 2025, boxes = "(1) Initial return (2) Final return (3) Name change (4) Address change (5) Amended return",
  gp1 = "50,000.", gpK = "50,000.", q2a = "No", q2b = "No", q3b = "No", b1 = "", k1s = [k1()],
  analysis = "130,000.", m1 = "130,000.", capital = "100,000. 150,000.", m2Begin = "100,000.", m2End = "150,000.",
  extra = "",
} = {}) {
  return [
    `Form 1065 U.S. Return of Partnership Income ${year}`,
    "Name of partnership",
    "EXAMPLE PARTNERS LLC 12-3456789",
    `G Check applicable boxes: ${boxes}`,
    "H Check accounting method: (1) X Cash (2) Accrual",
    `10 Guaranteed payments to partners . . . . . . . . . . . . 10 ${gp1}`,
    "23 Ordinary business income (loss). Subtract line 22 from line 8 . . . . . . 23 80,000.",
    PAD,
    "Schedule B Other Information",
    "2 At the end of the tax year:",
    "a Did any foreign or domestic corporation, partnership (including any entity treated as a partnership), trust, or tax-exempt",
    "organization, or any foreign government own, directly or indirectly, an interest of 50% or more in the profit, loss, or capital of",
    "the partnership? For rules of constructive ownership, see instructions. If \"Yes,\" attach Schedule B-1, Information on Partners",
    `Owning 50% or More of the Partnership . . . . . . . . . . . X [ANSWER: ${q2a}]`,
    "b Did any individual or estate own, directly or indirectly, an interest of 50% or more in the profit, loss, or capital of the",
    `partnership? For rules of constructive ownership, see instructions. If "Yes," attach Schedule B-1 . . . . X [ANSWER: ${q2b}]`,
    "3 At the end of the tax year, did the partnership:",
    "b Own directly an interest of 20% or more, or own, directly or indirectly, an interest of 50% or more in the profit, loss, or capital",
    `in any foreign or domestic partnership (including an entity treated as a partnership) or in the beneficial interest of a trust? . . X [ANSWER: ${q3b}]`,
    "Schedule K Partners' Distributive Share Items Total amount",
    `c Total guaranteed payments . . . . . . . . . . . . . . . . 4c ${gpK}`,
    "Analysis of Net Income (Loss) per Return",
    "1 Net income (loss). Combine Schedule K, lines 1 through 11. From the result, subtract the sum of",
    `Schedule K, lines 12 through 13e, and 21 . . . . . . . . . . . . . 1 ${analysis}`,
    "Schedule L Balance Sheets per Books Beginning of tax year End of tax year",
    "14 Total assets . . . . . . . . . . 400,000. 450,000.",
    `21 Partners' capital accounts . . . . . . . . . ${capital}`,
    "Schedule M-1 Reconciliation of Income (Loss) per Books With Analysis of Net Income (Loss) per Return",
    "9 Income (loss) (Analysis of Net Income (Loss)",
    `5 Add lines 1 through 4 . . . . . . . 130,000. per Return , line 1).Subtract line 8 from line 5 . . . . . . ${m1}`,
    "Schedule M-2 Analysis of Partners' Capital Accounts",
    `1 Balance at beginning of year . . . . . . . ${m2Begin} 6 Distributions: a Cash . . . . . . 60,000.`,
    `5 Add lines 1 through 4 . . . . . . . 210,000. 9 Balance at end of year. Subtract line 8 from line 5 . . . ${m2End}`,
    b1,
    ...k1s,
    extra,
  ].join("\n");
}

function pkg(current, prior, extra = []) {
  return [
    { name: "Example 2025 return.pdf", reviewRole: "current_return", text: current },
    ...(prior ? [{ name: "Example 2024 return.pdf", reviewRole: "prior_return", text: prior }] : []),
    ...extra,
  ];
}

const run = (files, check, meta = META) => check(ee.context(files, meta));

/* --- Lectura --------------------------------------------------------------- */

test("el K-1 se lee con numero, nombre, tipo de socio, porcentajes y capital", () => {
  const [k] = ef.issuedK1s(f1065());
  assert.strictEqual(k.tin, "000-00-1111");
  assert.strictEqual(k.name, "JOHN EXAMPLE");
  assert.strictEqual(k.ownerKind, "individual");
  assert.deepStrictEqual(k.profit, [60, 60]);
  assert.deepStrictEqual(k.capital, { beginning: 60000, contributed: null, income: 78000, withdrawals: null, ending: 90000 });
});

test("sin tipo de socio impreso, un EIN es una entidad y un SSN una persona", () => {
  const text = f1065({ k1s: [k1({ tin: "98-7654321", type: "" }), k1({ tin: "000-00-2222", type: "", name: "ANN EXAMPLE" })] });
  assert.deepStrictEqual(ef.issuedK1s(text).map((k) => k.ownerKind), ["entity", "individual"]);
});

test("el nombre que el K-1 no deja separar sale del anexo que lo imprime junto al numero", () => {
  const block = k1({ name: "6c Dividend equivalents A 4." }).replace("100 EXAMPLE ROAD", "12 ELM ST 7 Royalties");
  const text = f1065({ k1s: [block], extra: "PARTNER 1: MARY SAMPLE 000-00-1111 PTPL1102 09/06/24" });
  assert.strictEqual(ef.issuedK1s(text)[0].name, "MARY SAMPLE");
});

test("la respuesta de una pregunta se busca hasta que empieza la siguiente", () => {
  const lines = f1065({ q2a: "Yes", q2b: "No" }).split("\n");
  assert.strictEqual(ef.answerAfter(lines, /Did any foreign or domestic corporation, partnership \(including/i), "Yes");
  assert.strictEqual(ef.answerAfter(lines, /Did any individual or estate own/i), "No");
});

test("los apellidos ignoran TRUSTEE y parten los compuestos", () => {
  assert.deepStrictEqual(ee.surnames("PAT EXAMPLE, TRUSTEE"), ["EXAMPLE"]);
  assert.deepStrictEqual(ee.surnames("LEE EXAMPLE-SAMPLE, TRUSTEE"), ["EXAMPLE", "SAMPLE"]);
  assert.deepStrictEqual(ee.surnames("JO AND AL EXAMPLE"), ["EXAMPLE"]);
});

/* --- Socio por socio contra el año anterior -------------------------------- */

test("un capital que no abre donde cerro el año anterior es un hallazgo", () => {
  const prior = f1065({ year: 2024, k1s: [k1({ end: "55,000" })] });
  const [f] = run(pkg(f1065(), prior), ee.checkOwnerCapitalContinuity);
  assert.match(f.detail, /JOHN EXAMPLE \(…1111\) opens at \$60,000 and closed last year at \$55,000/);
  assert.deepStrictEqual(run(pkg(f1065(), f1065({ year: 2024, k1s: [k1({ end: "60,000" })] })), ee.checkOwnerCapitalContinuity), []);
});

test("un socio del año pasado sin K-1 ni K-1 final es un hallazgo alto", () => {
  const prior = f1065({ year: 2024, k1s: [k1(), k1({ tin: "000-00-3333", name: "ANN SAMPLE", pct: [40, 40] })] });
  const found = run(pkg(f1065(), prior), ee.checkOwnersInAndOut);
  const gone = found.find((f) => /no K-1 this year/.test(f.title));
  assert.strictEqual(gone.severity, "HIGH");
  assert.match(gone.detail, /ANN SAMPLE \(…3333\)/);
  const finalBefore = f1065({ year: 2024, k1s: [k1(), k1({ tin: "000-00-3333", name: "ANN SAMPLE", final: true })] });
  assert.ok(!run(pkg(f1065(), finalBefore), ee.checkOwnersInAndOut).some((f) => /no K-1 this year/.test(f.title)));
});

test("un socio en 0% sin K-1 final, y un porcentaje que no abre donde cerro", () => {
  const prior = f1065({ year: 2024, k1s: [k1({ pct: [50, 50] })] });
  const current = f1065({ k1s: [k1({ pct: [60, 0] })] });
  const found = run(pkg(current, prior), ee.checkOwnersInAndOut);
  assert.ok(found.some((f) => /0% at year end without a final K-1/.test(f.title)));
  assert.ok(found.some((f) => /begins this year at 60% of profit and ended last year at 50%/.test(f.detail)));
});

test("una nota del papel de trabajo con la salida de un socio contra su K-1 no final", () => {
  const wp = { name: "Example workpapers 2025.xlsx", reviewRole: "current_workpaper", text: "--- Sheet: Notes ---\n,,Note to Next Year: John Example bought out on 6/30/2025,," };
  const [f] = run(pkg(f1065(), null, [wp]), ee.checkOwnerExitNotes);
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /John Example left the partnership on 6\/30\/2025/);
  assert.match(f.detail, /still shows 60% at year end/);
  assert.deepStrictEqual(run(pkg(f1065({ k1s: [k1({ final: true })] }), null, [wp]), ee.checkOwnerExitNotes), [], "con K-1 final esta bien");
  const later = { ...wp, text: wp.text.replace("6/30/2025", "2/1/2026") };
  assert.deepStrictEqual(run(pkg(f1065(), null, [later]), ee.checkOwnerExitNotes), [], "una salida del año siguiente no es de esta declaracion");
});

test("dos socios con el mismo numero se avisan", () => {
  const [f] = run(pkg(f1065({ k1s: [k1(), k1({ name: "JOHN EXAMPLE, TRUSTEE", pct: [5, 5], begin: "5,000", end: "6,000" })] })), ee.checkDuplicateOwnerTins);
  assert.match(f.detail, /2 K-1s use the number ending 1111/);
});

/* --- Schedule B ------------------------------------------------------------ */

test("una persona con 60% y la pregunta 2b en No es un hallazgo alto", () => {
  const [f] = run(pkg(f1065()), ee.checkFiftyPercentOwner);
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.title, /question 2b/);
});

test("una sociedad con 64% y la 2a en Si, con B-1 que la lista, esta bien", () => {
  const owner = k1({ tin: "98-7654321", name: "EXAMPLE HOLDINGS INC", type: "CORPORATION", pct: [64, 64] });
  const b1 = "SCHEDULE B-1 Information on Partners Owning 50% or\n(Form 1065)\nPart I Entities Owning 50% or More\nEXAMPLE HOLDINGS INC 98-7654321 S Corp. U.S. 64.000\nSchedule B-1 (Form 1065) (Rev. 8-2019)";
  assert.deepStrictEqual(run(pkg(f1065({ q2a: "Yes", b1, k1s: [owner] })), ee.checkFiftyPercentOwner), []);
  const [missing] = run(pkg(f1065({ q2a: "Yes", k1s: [owner] })), ee.checkFiftyPercentOwner);
  assert.match(missing.title, /Schedule B-1 — required/);
  const other = b1.replace(/EXAMPLE HOLDINGS INC 98-7654321/, "OTHER CO 11-1111111");
  const [unlisted] = run(pkg(f1065({ q2a: "Yes", b1: other, k1s: [owner] })), ee.checkFiftyPercentOwner);
  assert.match(unlisted.title, /does not list the 50% owner/);
});

test("una familia que junta mas del 50% con la 2b en No se pregunta", () => {
  const k1s = [
    k1({ tin: "000-00-1111", name: "PAT AND LEE EXAMPLE", pct: [30, 30] }),
    k1({ tin: "000-00-2222", name: "SAM EXAMPLE, TRUSTEE", pct: [25, 25] }),
    k1({ tin: "000-00-3333", name: "ANN SAMPLE", pct: [45, 45] }),
  ];
  const [f] = run(pkg(f1065({ k1s })), ee.checkFiftyPercentOwner);
  assert.strictEqual(f.severity, "MEDIUM");
  assert.match(f.detail, /2 owners with the surname EXAMPLE hold 55% together/);
});

test("un K-1 recibido con 30% de otra sociedad y la pregunta 3b en No", () => {
  const received = { name: "Investee K-1.pdf", reviewRole: "supporting_document", text: k1({ tin: "12-3456789", name: "EXAMPLE PARTNERS LLC", type: "PARTNERSHIP", pct: [30, 30] }).replace("Schedule K-1", "Schedule K-1\nPartner's Share of Income, Deductions, Credits, etc.") };
  const [f] = run(pkg(f1065(), null, [received]), ee.checkInvesteeOwnership);
  assert.match(f.title, /question 3b/);
  assert.match(f.detail, /Investee K-1\.pdf shows 30%/);
  assert.deepStrictEqual(run(pkg(f1065({ q3b: "Yes" }), null, [received]), ee.checkInvesteeOwnership), []);
});

/* --- Dentro de la declaracion ---------------------------------------------- */

test("pagos garantizados distintos en la pagina 1 y el Schedule K", () => {
  const [f] = run(pkg(f1065({ gpK: "45,000." })), ee.checkGuaranteedPayments);
  assert.match(f.detail, /\$50,000 .*\$45,000/);
  assert.deepStrictEqual(run(pkg(f1065()), ee.checkGuaranteedPayments), []);
});

test("el M-2 contra el capital del balance y contra el cierre del año anterior", () => {
  const [bs] = run(pkg(f1065({ capital: "100,000. 140,000." })), ee.checkM2AgainstBalanceSheet);
  assert.match(bs.detail, /\$150,000 .*\$140,000/);
  const [cont] = run(pkg(f1065(), f1065({ year: 2024, m2End: "95,000." })), ee.checkM2Continuity);
  assert.match(cont.detail, /opens partners' capital at \$100,000; last year's return closed it at \$95,000/);
});

test("el M-1 que no cierra contra el analisis del ingreso", () => {
  const [f] = run(pkg(f1065({ m1: "128,000." })), ee.checkM1Closes);
  assert.match(f.detail, /\$128,000, but Analysis of Net Income \(Loss\) line 1 is \$130,000/);
  assert.deepStrictEqual(run(pkg(f1065()), ee.checkM1Closes), []);
});

test("declaracion final con K-1 no finales, y todos finales sin declaracion final", () => {
  const finalBox = "(1) Initial return (2) X Final return (3) Name change (4) Address change (5) Amended return";
  const [a] = run(pkg(f1065({ boxes: finalBox })), ee.checkReturnBoxes);
  assert.match(a.title, /Final return checked, but not every K-1 is final/);
  const [b] = run(pkg(f1065({ k1s: [k1({ final: true })] })), ee.checkReturnBoxes);
  assert.match(b.title, /Every K-1 is final, but the return is not marked final/);
  const initial = "(1) X Initial return (2) Final return (3) Name change";
  const [c] = run(pkg(f1065({ boxes: initial }), f1065({ year: 2024 })), ee.checkReturnBoxes);
  assert.match(c.title, /Initial return checked, but the entity filed last year/);
});

/* --- 1120-S ---------------------------------------------------------------- */

function f1120s({ year = 2025, comp = "", dist = "40,000.", m2 = {} } = {}) {
  const m = { begin: "10,000.", combined: "100,000.", dist: "40,000.", end: "60,000.", ...m2 };
  return [
    `Form 1120-S U.S. Income Tax Return for an S Corporation ${year}`,
    "Name",
    "EXAMPLE CORP 12-3456780",
    "H Check if: (1) Final return (2) Name change (3) Address change",
    "(4) Amended return (5) S election termination",
    `7 Compensation of officers (see instructions - attach Form 1125-E) . . . . . . 7 ${comp}`,
    "22 Ordinary business income (loss). Subtract line 21 from line 6 . . . . . . 22 90,000.",
    PAD,
    "Schedule K Shareholders' Pro Rata Share Items Total amount",
    `d Distributions (attach stmt if required) (see instrs) . . . . . . . 16d ${dist}`,
    "Recon- 18 Income (loss) reconciliation. Combine the total amounts on lines 1 through 10. From the result,",
    "ciliation subtract the sum of the amounts on lines 11 through 12e and 16f . . . . . . . . 18",
    "90,000.",
    "Schedule M-1 Reconciliation of Income (Loss) per Books With Income (Loss) per Return",
    "4 Add lines 1 through 3 . . . . . . . 90,000. 8 Income (loss) (Schedule K, line 18). Subtract line 7 from line 4 . . . . . 90,000.",
    "Schedule M-2 Analysis of Accumulated Adjustments Account, Shareholders' Undistributed Taxable Income",
    `1 Balance at beginning of tax year . . . . . . . . . ${m.begin}`,
    "2 Ordinary income from page 1, line 22 . . . . . . . . 90,000.",
    `6 Combine lines 1 through 5 . . . . . . . . . . . ${m.combined}`,
    `7 Distributions . . . . . . . . . . . . . . . . . ${m.dist}`,
    `8 Balance at end of tax year. Subtract line 7 from line 6 . . . . . . . ${m.end}`,
    k1({ form: "1120-S", pct: [100, 100], begin: "", income: "", end: "" }),
  ].join("\n");
}

test("1120-S: distribuciones sin sueldo de funcionarios", () => {
  const [f] = run(pkg(f1120s()), ee.checkReasonableCompensation, { taxYear: "2025" });
  assert.match(f.title, /distributions with no officer compensation/);
  assert.deepStrictEqual(run(pkg(f1120s({ comp: "60,000." })), ee.checkReasonableCompensation, { taxYear: "2025" }), []);
});

test("1120-S: el sueldo de funcionarios que cae a cero se pregunta aunque no haya distribuciones", () => {
  const prior = f1120s({ year: 2024, comp: "75,000." });
  const [f] = run(pkg(f1120s({ dist: "" }), prior), ee.checkReasonableCompensation, { taxYear: "2025" });
  assert.match(f.title, /dropped to zero/);
  assert.match(f.detail, /\$75,000/);
});

test("1120-S: el AAA que abre distinto y las distribuciones que lo dejan negativo", () => {
  const prior = f1120s({ year: 2024, m2: { end: "12,000." } });
  const [cont] = run(pkg(f1120s(), prior), ee.checkM2Continuity, { taxYear: "2025" });
  assert.match(cont.detail, /accumulated adjustments account \(column a\) at \$10,000; last year's return closed it at \$12,000/);
  const [neg] = run(pkg(f1120s({ m2: { dist: "130,000.", end: "(30,000.)" } })), ee.checkAaaDistributions, { taxYear: "2025" });
  assert.match(neg.detail, /\$100,000 before distributions and \$130,000 of distributions, closing at -\$30,000/);
  assert.deepStrictEqual(run(pkg(f1120s()), ee.checkAaaDistributions, { taxYear: "2025" }), []);
});

test("1120-S: el M-1 cierra contra la linea 18 del Schedule K", () => {
  assert.deepStrictEqual(run(pkg(f1120s()), ee.checkM1Closes, { taxYear: "2025" }), []);
  const text = f1120s().replace("Subtract line 7 from line 4 . . . . . 90,000.", "Subtract line 7 from line 4 . . . . . 85,000.");
  const [f] = run(pkg(text), ee.checkM1Closes, { taxYear: "2025" });
  assert.match(f.detail, /\$85,000, but Schedule K line 18 is \$90,000/);
});

/* --- 1120 ------------------------------------------------------------------ */

function f1120({ year = 2025, before = "-500,000.", taxable = "-500,000.", nolUsed = "0.", available = "1,000,000.", credited = "", preceding = "" } = {}) {
  return [
    `Form 1120 U.S. Corporation Income Tax Return ${year}`,
    "Name",
    "EXAMPLE TECH INC 12-3456781",
    "E Check if: (1) Initial return (2) Final return (3) Name change (4) Address change",
    `28 Taxable income before net operating loss deduction and special deductions. Subtract line 27 from line 11 . . . . 28 ${before}`,
    `29 a Net operating loss deduction (see instructions) . . . . . . . . . . . . . . 29 a ${nolUsed}`,
    `30 Taxable income. Subtract line 29c from line 28. See instructions . . . . . . 30 ${taxable}`,
    credited ? `36 Enter amount from line 35 you want: Credited to ${year + 1} estimated tax ${credited} Refunded 36` : "",
    PAD,
    "Schedule J Tax Computation and Payment (see instructions)",
    taxable.startsWith("-") ? "2 Income tax. See instructions . . . . . . . . . . . . 2 0." : `2 Income tax. See instructions . . . . . . . . . . . . 2 ${Math.round(Number(taxable.replace(/[,.]/g, "")) / 100 * 0.21 * 100).toLocaleString("en-US")}.`,
    `13 Preceding year's overpayment credited to the current year . . . . . . . 13 ${preceding}`,
    `12 Enter the available NOL carryover from prior tax years (do not reduce it by any deduction reported on page 1, line 29a) . . . . $ ${available}`,
    "10 Income (page 1, line 28) ' line 6 less line 9 . . . . . . " + before,
  ].join("\n");
}

test("1120: la perdida operativa disponible se arrastra con la del año", () => {
  const prior = f1120({ year: 2024, before: "-300,000.", taxable: "-300,000.", available: "700,000." });
  assert.deepStrictEqual(run(pkg(f1120(), prior), ee.checkCorporateNol, { taxYear: "2025" }), []);
  const short = f1120({ available: "900,000." });
  const [f] = run(pkg(short, prior), ee.checkCorporateNol, { taxYear: "2025" });
  assert.match(f.detail, /\$700,000 available, \$300,000 of new loss and \$0 used, which leaves \$1,000,000; this return reports \$900,000 available \(less by \$100,000\)/);
});

test("1120: el sobrepago acreditado el año pasado tiene que aparecer en el Schedule J", () => {
  const prior = f1120({ year: 2024, before: "100,000.", taxable: "100,000.", credited: "5,000." });
  const [f] = run(pkg(f1120({ before: "200,000.", taxable: "200,000." }), prior), ee.checkCorporateOverpaymentCredited, { taxYear: "2025" });
  assert.match(f.detail, /credited \$5,000/);
  assert.deepStrictEqual(run(pkg(f1120({ before: "200,000.", taxable: "200,000.", preceding: "5,000." }), prior), ee.checkCorporateOverpaymentCredited, { taxYear: "2025" }), []);
});

test("1120: el impuesto del Schedule J es el 21%", () => {
  assert.deepStrictEqual(run(pkg(f1120({ before: "200,000.", taxable: "200,000." })), ee.checkCorporateTaxRate, { taxYear: "2025" }), []);
  const wrong = f1120({ before: "200,000.", taxable: "200,000." }).replace("2 42,000.", "2 40,000.");
  const [f] = run(pkg(wrong), ee.checkCorporateTaxRate, { taxYear: "2025" });
  assert.match(f.detail, /\$42,000; Schedule J shows \$40,000/);
});

test("1120: la perdida de capital del año pasado pasa a la linea 6 del Schedule D", () => {
  const schedD = (st, lt, carry = "") => [
    "SCHEDULE D Capital Gains and Losses",
    "(Form 1120) Attach to Form 1120, 1120-C, 1120-F",
    `6 Unused capital loss carryover (attach computation) . . . . . . 6 ${carry}`,
    `7 Net short-term capital gain or (loss). Combine lines 1a through 6 in column h . . . 7 ${st}`,
    `14 Net long-term capital gain or (loss). Combine lines 8a through 13 in column h . . . 14 ${lt}`,
  ];
  const prior = f1120({ year: 2024, before: "100,000.", taxable: "100,000." }) + "\n" + schedD("(2,000.)", "(8,000.)").join("\n");
  const current = f1120({ before: "100,000.", taxable: "100,000." }) + "\n" + schedD("", "5,000.").join("\n");
  const [f] = run(pkg(current, prior), ee.checkCorporateCapitalLoss, { taxYear: "2025" });
  assert.match(f.detail, /net capital loss of \$10,000/);
  const brought = f1120({ before: "100,000.", taxable: "100,000." }) + "\n" + schedD("(10,000.)", "5,000.", "(10,000.)").join("\n");
  assert.deepStrictEqual(run(pkg(brought, prior), ee.checkCorporateCapitalLoss, { taxYear: "2025" }), []);
});

test("1120: dividendos de la pagina 1 contra el Schedule C", () => {
  const text = f1120({ before: "100,000.", taxable: "100,000." })
    + "\n4 Dividends and inclusions (Schedule C, line 23) . . . . . . 4 12,000."
    + "\n23 Total dividends and inclusions. Add column (a), lines 9 through 20. Enter here and on page 1, line 4 . . . 23 10,000.";
  const ctx = ee.context(pkg(text), { taxYear: "2025" });
  // El renglon 4 va en la pagina 1; el ficticio lo trae al final, asi que se fija a mano.
  ctx.lines.dividendsPage1 = 12000;
  const [f] = ee.checkDividendsSchedule(ctx);
  assert.match(f.detail, /\$12,000 .* \$10,000/);
});

/* --- Papel de trabajo ------------------------------------------------------ */

const receivedK1 = ({ income = "(1,500)" } = {}) => ({
  name: "Example Growth Fund K-1.pdf",
  reviewRole: "supporting_document",
  text: [
    "Final K-1 Amended K-1 OMB No. 1545-0123",
    "Schedule K-1",
    "(Form 1065) 2025",
    "Partner's Share of Income, Deductions, Credits, etc.",
    "A Partnership's employer identification number",
    "98-1234567",
    "B Partnership's name, address, city, state, and ZIP code",
    "EXAMPLE GROWTH FUND LP",
    "E Partner's SSN or TIN (Do not use TIN of a disregarded entity. See instructions.)",
    "12-3456789",
    "Profit 2 % 2 %",
    "Beginning capital account . . . $ 250,000",
    `Current year net income (loss) . . . $ ${income}`,
    "Ending capital account . . . $ 248,500",
  ].join("\n"),
});

const leadSheet = (row) => ({
  name: "Example 2025 workpapers.xlsx",
  reviewRole: "current_workpaper",
  text: [
    "--- Sheet: K1 Lead Sheet ---",
    "Entity,,Opening Balance,Ordinary Income,Interest,LT gain (loss),Distr,End Balance,Per QBO",
    row,
    "Other Fund LLC,,\"10,000\",,50,,,\"10,050\",\"10,050\"",
  ].join("\n"),
});

test("un K-1 del paquete que la hoja de K-1 no cargo es un hallazgo alto", () => {
  const files = pkg(f1065(), null, [receivedK1(), leadSheet("Example Growth Fund LP,,\"250,000\",,,,,\"250,000\",\"250,000\"")]);
  const [f] = run(files, ee.checkK1LeadSheet);
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /Example Growth Fund LP: the lead sheet carries no 2025 activity \(opening and ending \$250,000\), but the K-1 in the package \(Example Growth Fund K-1\.pdf\) reports current-year loss of \$1,500/);
});

test("si la hoja trae movimiento del año, o el K-1 no tiene movimiento, nada", () => {
  const loaded = pkg(f1065(), null, [receivedK1(), leadSheet("Example Growth Fund LP,,\"250,000\",,,\"(1,500)\",,\"248,500\",\"248,500\"")]);
  assert.deepStrictEqual(run(loaded, ee.checkK1LeadSheet), []);
  const quiet = pkg(f1065(), null, [receivedK1({ income: "0" }), leadSheet("Example Growth Fund LP,,\"250,000\",,,,,\"250,000\",\"250,000\"")]);
  assert.deepStrictEqual(run(quiet, ee.checkK1LeadSheet), []);
});

test("la hoja resumen del workpaper contra la declaracion", () => {
  const wp = { name: "Example 2025 workpapers.xlsx", reviewRole: "current_workpaper", text: "--- Sheet: Review Summary ---\nOrdinary business income,\"85,000\"\nTotal assets,\"450,000\"" };
  const [f] = run(pkg(f1065(), null, [wp]), ee.checkWorkpaperSummary);
  assert.match(f.detail, /ordinary business income: workpaper \$85,000, return \$80,000/);
  assert.doesNotMatch(f.detail, /total assets/);
});

test("Form 8594 sin Form 4797", () => {
  const text = f1065({ extra: "Form 8594 Asset Acquisition Statement\nUnder Section 1060" });
  const [f] = run(pkg(text), ee.checkSaleOfBusiness);
  assert.match(f.title, /Form 8594 filed with no Form 4797/);
});

test("todo junto sobre un 1065 limpio no dice nada", () => {
  const owner = k1({ tin: "98-7654321", name: "EXAMPLE HOLDINGS INC", type: "CORPORATION", pct: [60, 60] });
  const b1 = "SCHEDULE B-1 Information on Partners Owning 50% or\n(Form 1065)\nEXAMPLE HOLDINGS INC 98-7654321 S Corp. U.S. 60.000";
  const text = f1065({ q2a: "Yes", b1, k1s: [owner] });
  assert.deepStrictEqual(ee.runEntityExtraChecks(pkg(text, f1065({ year: 2024, q2a: "Yes", b1, k1s: [k1({ tin: "98-7654321", name: "EXAMPLE HOLDINGS INC", type: "CORPORATION", pct: [60, 60], end: "60,000" })], m2End: "100,000." })), META), []);
});
