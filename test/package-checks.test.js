"use strict";
// Integridad del paquete. Nombres, numeros y cifras ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const pc = require("../lib/package-checks");
const pd = require("../lib/package-docs");
const to = require("../lib/tie-out");

const PAD = "Statement filler text for a return of normal length. ".repeat(12);

const f1040 = ({ letter = "", owed = "40,000.", extra = [] } = {}) => [
  letter,
  "Form 1040 U.S. Individual Income Tax Return 2025",
  "Your first name and middle initial Last name Your social security number",
  "JANE EXAMPLE 000-11-1111",
  "Filing Status X Single",
  "1 a Total amount from Form(s) W-2, box 1 (see instructions) . . . . 1a 85,000.",
  "11 Subtract line 10 from line 9. This is your adjusted gross income . . . 11 90,000.",
  "24 Add lines 22 and 23. This is your total tax . . . . . . 24 50,000.",
  "33 Add lines 25d, 26, and 32. These are your total payments . . . 33 10,000.",
  `37 Subtract line 33 from line 24. This is the amount you owe . . . . 37 ${owed}`,
  PAD,
  ...extra,
].join("\n");

const f1065 = (extra = []) => [
  "Form 1065 U.S. Return of Partnership Income 2025",
  "Name of partnership",
  "EXAMPLE PARTNERS LLC 12-3456789",
  PAD,
  ...extra,
].join("\n");

const pkg = (current, extra = []) => [{ name: "Example 2025 return.pdf", reviewRole: "current_return", text: current }, ...extra];
const META = { taxYear: "2025", returnType: "1040" };

const k1Doc = ({ ein = "98-7654321", to = "000-11-1111", name = "Fund K-1.pdf", year = 2025 } = {}) => ({
  name, reviewRole: "supporting_document",
  text: [
    "Final K-1 Amended K-1 OMB No. 1545-0123",
    "Schedule K-1",
    `(Form 1065) ${year}`,
    "Partner's Share of Income, Deductions, Credits, etc.",
    `For calendar year ${year}`,
    "A Partnership's employer identification number",
    ein,
    "E Partner's SSN or TIN (Do not use TIN of a disregarded entity. See instructions.)",
    to,
    "Current year net income (loss) . . . $ 5,000",
  ].join("\n"),
});

test("el tipo elegido contra el que dice la declaracion", () => {
  const [f] = pc.checkReturnTypeMatches(pkg(f1065()), { ...META, returnType: "1040" });
  assert.match(f.title, /reviewed as 1040, the return is a Form 1065/);
  assert.deepStrictEqual(pc.checkReturnTypeMatches(pkg(f1040()), META), []);
});

test("archivos que no se pudieron abrir, y la clave en el nombre se tapa", () => {
  const zip = { name: "Docs.zip", reviewRole: "supporting_document", text: "--- ZIP ENTRY: Docs/000111234 to open K-1.pdf ---\nUnable to parse this entry: No password given" };
  const locked = { name: "statement.pdf", reviewRole: "supporting_document", text: "", encoding: "metadata-only", mediaType: "application/pdf" };
  const [f] = pc.checkUnreadableFiles(pkg(f1040(), [zip, locked]), META);
  assert.strictEqual(f.severity, "HIGH", "un K-1 ilegible es importante");
  assert.match(f.detail, /XXXXX1234 to open K-1\.pdf \(password-protected\)/);
  assert.doesNotMatch(f.detail, /000111234/);
  assert.match(f.detail, /statement\.pdf/);
});

test("documentos de otro año fiscal", () => {
  const w2 = { name: "old w2.pdf", reviewRole: "supporting_document", text: "2024 Form W-2 Wage and Tax Statement\n1 Wages, tips, other comp. 80,000.00" };
  const [f] = pc.checkOtherYearDocuments(pkg(f1040(), [w2]), META);
  assert.match(f.detail, /old w2\.pdf \(W2 for 2024\)/);
});

test("dos versiones de un mismo K-1", () => {
  const a = k1Doc({ name: "Fund K-1.pdf" });
  const b = { ...k1Doc({ name: "Fund K-1 (Amended).pdf" }), text: k1Doc().text.replace("5,000", "5,500") };
  const [f] = pc.checkDocumentVersions(pkg(f1040(), [a, b]), META);
  assert.match(f.detail, /Fund K-1\.pdf and Fund K-1 \(Amended\)\.pdf have different content/);
});

test("la carta dice un saldo distinto al de la declaracion", () => {
  const letter = "Your 2025 Federal Individual Income Tax return shows a balance due of $38,500. Please pay by April 15.";
  const [f] = pc.checkLetterMatchesReturn(pkg(f1040({ letter })), META);
  assert.match(f.detail, /\$38,500; line 37 of the return is \$40,000/);
});

test("un K-1 del paquete cuyo EIN no aparece en el 1040", () => {
  const [f] = pc.checkReceivedK1sReflected(pkg(f1040(), [k1Doc()]), META);
  assert.strictEqual(f.severity, "HIGH");
  assert.match(f.detail, /Fund K-1\.pdf \(EIN ending 4321\)/);
  const listed = f1040({ extra: ["28 (a) Name (b) Enter P for partnership (d) Employer identification number", "A EXAMPLE FUND LP P 98-7654321"] });
  assert.deepStrictEqual(pc.checkReceivedK1sReflected(pkg(listed, [k1Doc()]), META), []);
  const [other] = pc.checkReceivedK1sReflected(pkg(f1040(), [k1Doc({ to: "000-99-8888" })]), META);
  assert.strictEqual(other.severity, "MEDIUM", "un K-1 a nombre de otra persona se pregunta, no se afirma");
});

test("una entidad que no imprime los EIN de lo que recibe no dispara nada", () => {
  assert.deepStrictEqual(pc.checkReceivedK1sReflected(pkg(f1065(), [k1Doc({ to: "12-3456789" })]), { taxYear: "2025", returnType: "1065" }), []);
});

test("el tipo de cada documento exige numero y frase del cuerpo", () => {
  assert.deepStrictEqual(pd.docTypes("brokerage.pdf", "Forms 1099-R, 1099-Q, 5498, Schedule K-1 are sent individually"), []);
  assert.deepStrictEqual(pd.docTypes("r.pdf", "2025 Form 1099-R Distributions From Pensions\n1 Gross distribution 10,000.00"), ["1099-r"]);
  assert.strictEqual(pd.docYear("Form 1099-B (Rev. 1-2022)\nFor calendar year 2025"), 2025);
});

test("tie-out: el lado de la declaracion lo lee el codigo", () => {
  const rows = [
    { lineItem: "Form 1040 Line 1a — Wages", returnAmount: "84,000", workpaperAmount: "85,000", status: "OUT_OF_BALANCE" },
    { lineItem: "Form 1040 Line 11 — Adjusted gross income", returnAmount: "90,000", workpaperAmount: "90,000", status: "TIE" },
  ];
  const { rows: out, changed } = to.returnSideFromCode(rows, "1040", pkg(f1040()));
  assert.strictEqual(changed, 1);
  assert.strictEqual(out[0].returnAmount, 85000);
  assert.match(out[0].note, /read from the return by code \(the review had 84000\.00\)/);
  const { rows: verdicts } = to.enforceTieOutVerdicts(out);
  assert.strictEqual(verdicts[0].status, "TIE", "con el importe correcto de la declaracion, cierra");
  const { review, returnSideFromCode } = to.enforceNumericVerdicts({ tieOutResults: rows }, "1040", pkg(f1040()));
  assert.strictEqual(returnSideFromCode, 1);
  assert.strictEqual(review.tieOutResults[0].returnAmount, 85000);
});
