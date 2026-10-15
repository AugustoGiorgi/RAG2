"use strict";
// El 1040-NR en la Review: que se reconozca como tal, que el tie-out use sus renglones y que
// corran los cruces del no residente (lib/nonresident-checks.js). Contribuyente, cifras y
// documentos ficticios; los rotulos son los del 1040-NR y el Schedule OI oficiales de 2025, con
// el formato que deja pdf.js en una declaracion impresa por el software ("1a 30,000.").
const { test } = require("node:test");
const assert = require("node:assert");
const { runNonresidentChecks, scheduleOILines, residenceCountry, visaType, daysPresent, treatyTotal } = require("../lib/nonresident-checks");
const { detectReturnTypeFromText, requiredTieOutsFor, canonicalLineKey, returnSideFromCode } = require("../lib/tie-out");
const { checkReturnTypeMatches } = require("../lib/package-checks");
const rf = require("../lib/return-facts");

function nrReturn({
  country = "GERMANY", visa = "H-1B", days = "2023 0 , 2024 120 , and 2025 200 .", line12 = "15,750.", line19 = "",
  line1k = "5,000.", oiTotal = "5,000.", extra = [], before = [],
} = {}) {
  return [
    ...before,
    "--- Page 1 ---",
    "Department of the Treasury—Internal Revenue Service",
    "Form 1040-NR U.S. Nonresident Alien Income Tax Return 2025 OMB No. 1545-0074",
    "For the year Jan. 1–Dec. 31, 2025, or other tax year beginning , 2025, ending , 20 See separate instructions.",
    "Your first name and middle initial Last name Your identifying number",
    "TEST TAXPAYER 900-70-0000",
    "Filing Status X Single Married filing separately (MFS) Qualifying surviving spouse (QSS) Estate Trust",
    "1a Total amount from Form(s) W-2, box 1 (see instructions) . . . . . . . . 1a 30,000.",
    "k Total income exempt by a treaty from Schedule OI (Form 1040-NR), item",
    `L, line 1(e) . . . . . . . . . . . . . 1k ${line1k}`,
    "z Add lines 1a through 1h . . . . . . . . . . . . . . . . 1z 30,000.",
    "2a Tax-exempt interest . . . 2a b Taxable interest . . . . . . 2b 200.",
    "3a Qualified dividends . . . 3a b Ordinary dividends . . . . . 3b",
    "7a Capital gain or (loss). Attach Schedule D if required . . . . . . . 7a",
    "8 Additional income from Schedule 1 (Form 1040), line 10 . . . . . . . 8",
    "9 Add lines 1z, 2b, 3b, 4b, 5b, 7a, and 8. This is your total effectively connected income . . . 9 30,200.",
    "10 Adjustments to income from Schedule 1 (Form 1040), line 26. These are your total adjustments to",
    "income . . . . . . . . . . . . . . . . . . . . . . 10",
    "11a Subtract line 10 from line 9. This is your adjusted gross income . . . . . . . 11a 30,200.",
    "Form 1040-NR (2025)",
    "--- Page 2 ---",
    "Form 1040-NR (2025) Page 2",
    "11b Amount from line 11a (adjusted gross income) . . . . . . . . . . 11b 30,200.",
    "12 Itemized deductions (from Schedule A (Form 1040-NR)) or, for certain residents of India, standard",
    `deduction (see instructions) . . . . . . . . . . . . . . . . 12 ${line12}`,
    "14 Add lines 12 through 13c . . . . . . . . . . . . . . . . 14 15,750.",
    "15 Subtract line 14 from line 11b. If zero or less, enter -0-. This is your taxable income . . . . 15 14,450.",
    `19 Child tax credit or credit for other dependents from Schedule 8812 (Form 1040) . . . . . 19 ${line19}`.trimEnd(),
    "23a Tax on income not effectively connected with a U.S. trade or business from",
    "Schedule NEC (Form 1040-NR), line 15 . . . . . . . . . . 23a 300.",
    "24 Add lines 22 and 23d. This is your total tax . . . . . . . . . . . . 24 1,900.",
    "d Add lines 25a through 25c . . . . . . . . . . . . . . . . . . 25d 2,500.",
    "g Form(s) 1042-S . . . . . . . . . . . . . . . . . . . . . . 25g 450.",
    "26 2025 estimated tax payments and amount applied from 2024 return . . . . . . 26",
    "33 Add lines 25d, 25e, 25f, 25g, 26, and 32. These are your total payments . . . . . . 33 2,950.",
    "--- Page 3 ---",
    "SCHEDULE OI Other Information",
    "(Form 1040-NR)",
    `A Of what country or countries were you a citizen or national during the tax year? ${country}`,
    `B In what country did you claim residence for tax purposes during the tax year? ${country}`,
    "E If you had a visa on the last day of the tax year, enter your visa type. If you didn’t have a visa, enter your U.S.",
    `immigration status on the last day of the tax year. ${visa}`,
    "H Give number of days (including vacation, nonworkdays, and partial days) you were present in the United States during:",
    days,
    `(e) Total. Enter this amount on Form 1040-NR, line 1k. Do not enter it anywhere else on line 1 . . ${oiTotal}`,
    ...extra,
  ].join("\n");
}

const filesOf = (text, more = []) => [{ name: "2025 return.pdf", reviewRole: "current_return", text }, ...more];
const titles = (findings) => findings.map((f) => `${f.severity} ${f.title}`);

test("el 1040-NR se reconoce como tal, tambien con el pedido de prorroga adelante", () => {
  assert.strictEqual(detectReturnTypeFromText(nrReturn()), "1040-NR");
  const extension = ["Form 4868 Application for Automatic Extension of Time To File U.S. Individual Income Tax Return 2025"];
  assert.strictEqual(detectReturnTypeFromText(nrReturn({ before: extension })), "1040-NR");
  // Un 1040 que nombra el 1040-NR en un rotulo ("Form 1040, 1040-SR, or 1040-NR, line 8") sigue siendo 1040.
  assert.strictEqual(detectReturnTypeFromText("Form 1040 U.S. Individual Income Tax Return 2025\nEnter here and on Form 1040, 1040-SR, or 1040-NR, line 8"), "1040");
  // La de status dual es un 1040 con el 1040-NR como anexo.
  assert.strictEqual(detectReturnTypeFromText(`Form 1040 U.S. Individual Income Tax Return 2025\nDual-Status Return\n${nrReturn()}`), "1040");
  assert.strictEqual(detectReturnTypeFromText("See the attached Form 1040-NR."), "1040-NR");
  assert.strictEqual(rf.isForm1040NR(nrReturn()), true);
});

test("revisado como 1040, un 1040-NR se avisa (y al reves)", () => {
  const nr = filesOf(nrReturn());
  assert.match(checkReturnTypeMatches(nr, { returnType: "1040" })[0].title, /reviewed as 1040, the return is a Form 1040-NR/);
  assert.deepStrictEqual(checkReturnTypeMatches(nr, { returnType: "1040-NR" }), []);
  const resident = filesOf(`Form 1040 U.S. Individual Income Tax Return 2025\nYour first name and middle initial\n${"x".repeat(600)}`);
  assert.match(checkReturnTypeMatches(resident, { returnType: "1040-NR" })[0].title, /reviewed as 1040-NR, the return is a Form 1040/);
});

test("el tie-out del 1040-NR usa sus renglones y los lee de la declaracion", () => {
  const rows = requiredTieOutsFor("1040-NR", []);
  const keys = rows.map((r) => r.key);
  for (const key of ["form1040-nrl1k", "form1040-nrl7a", "form1040-nrl9", "form1040-nrl11a", "form1040-nrl23a", "form1040-nrl25g", "form1040-nrl33"]) assert.ok(keys.includes(key), key);
  assert.ok(!keys.includes("form1040l7"), "no los renglones del 1040");
  assert.strictEqual(canonicalLineKey("Form 1040NR Line 11b (AGI)"), "form1040-nrl11a");
  assert.strictEqual(canonicalLineKey("Form 1040-NR line 1z — wages"), "form1040-nrl1a");
  const lines = rf.form1040NRLines(nrReturn());
  assert.deepStrictEqual({ w: lines["1a"], k: lines["1k"], i: lines["2b"], ag: lines["11a"], d: lines["12"], nec: lines["23a"], g: lines["25g"], p: lines["33"] },
    { w: 30000, k: 5000, i: 200, ag: 30200, d: 15750, nec: 300, g: 450, p: 2950 });
  const fromCode = returnSideFromCode([
    { lineItem: "Form 1040-NR Line 25g — Withholding on Forms 1042-S", returnAmount: "400", workpaperAmount: "450" },
    { lineItem: "Form 1040-NR Line 11a — Adjusted gross income", returnAmount: "30,200", workpaperAmount: "30,200" },
  ], "1040-NR", filesOf(nrReturn()));
  assert.strictEqual(fromCode.changed, 1);
  assert.strictEqual(fromCode.rows[0].returnAmount, 450);
});

test("lo que se lee del Schedule OI: pais, visa, dias y total del tratado", () => {
  const oi = scheduleOILines(nrReturn({ country: "KOREA, REPUBLIC OF", visa: "F-1" }));
  assert.strictEqual(residenceCountry(oi), "KOREA, REPUBLIC OF");
  assert.strictEqual(visaType(oi), "F");
  assert.deepStrictEqual(daysPresent(oi), { years: [2023, 2024, 2025], days: [0, 120, 200] });
  assert.strictEqual(treatyTotal(oi), 5000);
  // Sin respuesta no se adivina.
  const blank = scheduleOILines(nrReturn({ country: "", visa: "", days: "2023 , 2024 , and 2025 ." }));
  assert.strictEqual(residenceCountry(blank), "");
  assert.strictEqual(visaType(blank), "");
  assert.strictEqual(daysPresent(blank), null);
});

test("un residente de Alemania con 240 dias ponderados, deduccion estandar y credito por hijos", () => {
  const found = runNonresidentChecks(filesOf(nrReturn({ line19: "2,200." })), { taxYear: "2025" });
  assert.deepStrictEqual(titles(found), [
    "HIGH Schedule OI — the days reported meet the substantial presence test",
    "HIGH Form 1040-NR line 12 — standard deduction claimed by a resident of GERMANY",
    "HIGH Form 1040-NR line 19 — dependent credit claimed by a resident of GERMANY",
  ]);
  assert.match(found[0].detail, /240 weighted days/);
  for (const f of found) assert.ok(f.detail.length <= 320, `${f.title}: ${f.detail.length} caracteres`);
});

test("lo que no es error: India, Canada, pocos dias, el 8843 del estudiante, itemizadas", () => {
  assert.deepStrictEqual(titles(runNonresidentChecks(filesOf(nrReturn({ country: "INDIA", line19: "2,200.", days: "2023 0 , 2024 0 , and 2025 100 ." })), { taxYear: "2025" })), []);
  assert.deepStrictEqual(titles(runNonresidentChecks(filesOf(nrReturn({ country: "CANADA", line19: "2,200.", line12: "4,100.", days: "2023 0 , 2024 0 , and 2025 100 ." })), { taxYear: "2025" })), []);
  // Estudiante F-1 con el 8843: sus dias no cuentan.
  const student = nrReturn({ visa: "F-1", line12: "4,100.", extra: ["Form 8843 Statement for Exempt Individuals and Individuals With a Medical Condition 2025"] });
  assert.deepStrictEqual(titles(runNonresidentChecks(filesOf(student), { taxYear: "2025" })), []);
  // Sin el 8843: el test se cumple y falta el formulario que excluye los dias.
  assert.deepStrictEqual(titles(runNonresidentChecks(filesOf(nrReturn({ visa: "F-1", line12: "4,100." })), { taxYear: "2025" })), [
    "MEDIUM Schedule OI — substantial presence test met and no Form 8843 to exclude the days",
  ]);
});

test("tratado, creditos de educacion y seguridad social retenida al estudiante", () => {
  const short = { days: "2023 0 , 2024 0 , and 2025 100 .", line12: "4,100." };
  assert.deepStrictEqual(titles(runNonresidentChecks(filesOf(nrReturn({ ...short, oiTotal: "6,000." })), { taxYear: "2025" })), [
    "MEDIUM Form 1040-NR line 1k — treaty-exempt income does not match Schedule OI",
  ]);
  const education = nrReturn({ ...short, extra: ["Form 8863 Education Credits (American Opportunity and Lifetime Learning Credits) 2025"] });
  assert.deepStrictEqual(titles(runNonresidentChecks(filesOf(education), { taxYear: "2025" })), ["HIGH Form 8863 — education credit on a nonresident alien return"]);
  const w2 = {
    name: "W-2 campus job.pdf",
    text: [
      "Form W-2 Wage and Tax Statement 2025",
      "1 Wages, tips, other compensation 2 Federal income tax withheld",
      "12000.00 900.00",
      "3 Social security wages 4 Social security tax withheld 3 Social security wages 4 Social security tax withheld",
      "12000.00 744.00 12000.00 744.00",
    ].join("\n"),
  };
  const fica = runNonresidentChecks(filesOf(nrReturn({ ...short, visa: "J-1" }), [w2]), { taxYear: "2025" });
  assert.deepStrictEqual(titles(fica), ["MEDIUM Form W-2 — social security tax withheld from a nonresident on a J visa"]);
  assert.match(fica[0].detail, /\$744 of social security tax/);
  // Con otra visa la retencion es correcta.
  assert.deepStrictEqual(titles(runNonresidentChecks(filesOf(nrReturn({ ...short, visa: "H-1B" }), [w2]), { taxYear: "2025" })), []);
});

test("un 1040 con un 1042-S o un 8843 en el paquete pide confirmar la residencia", () => {
  const resident = `Form 1040 U.S. Individual Income Tax Return 2025\nYour first name and middle initial\n${"Line text for the return. ".repeat(40)}`;
  const s1042 = { name: "1042-S university.pdf", text: "Form 1042-S Foreign Person's U.S. Source Income Subject to Withholding 2025\n1 Income code 16" };
  const found = runNonresidentChecks(filesOf(resident, [s1042]), { taxYear: "2025" });
  assert.deepStrictEqual(titles(found), ["MEDIUM Form 1040 — the package carries papers of a nonresident alien"]);
  assert.deepStrictEqual(runNonresidentChecks(filesOf(resident), { taxYear: "2025" }), []);
  assert.deepStrictEqual(runNonresidentChecks([], {}), []);
});

/* --- Lo que la Review hace despues con los hallazgos de un 1040-NR ----------------------------- */
// Frases tal cual las escribio el modelo en la prueba del 1040-NR inventado (contribuyente y
// cifras ficticios).

test("una ausencia en la declaracion no la contradice que la cifra este en el workpaper", () => {
  const { verifyWorkpaperClaims, foldFindingsRepeatedBy } = require("../lib/review-guards");
  const support = [
    { name: "workpaper.xlsx", reviewRole: "supporting_document", text: "--- Sheet: Return summary ---\n,8,Schedule 1 - taxable state refund,310.00,1099-G\n,12,Itemized deductions (Schedule A (Form 1040-NR)),250.00,Sch A NR\n,25g,Withholding on Forms 1042-S,300.00,1042-S\n,26,2024 overpayment applied,600.00,2024 return\n".repeat(3) },
    { name: "docs.zip", reviewRole: "supporting_document", text: "--- ZIP ENTRY: W2.pdf ---\nc Employer's name\n600 CONGRESS AVE STE 1400\n--- ZIP ENTRY: 1042-S.pdf ---\n7a Federal tax withheld 300.00\n10 Total withholding credit 300.00\n--- ZIP ENTRY: 1099-G.pdf ---\n2 State or local income tax refunds, credits, or offsets $ 310.00" },
  ];
  const mk = (issueDescription, evidence) => ({ priority: "MEDIUM", formOrSchedule: "x", issueDescription, evidence, riskAnalysis: "", source: "model" });
  const review = { issues: [
    mk("Workpaper identifies a taxable $310 Illinois state refund (2024 Schedule A deduction) to be reported on Schedule 1 line 1, but the return's total ECI of $46,420 does not include it and no Schedule 1 is in the forms list.", "1099-G Box 2 $310.00; workpaper Line 8 $310.00; return forms list does not include Schedule 1; return Line 9 $46,420"),
    mk("Workpaper computes itemized deductions of $250 (cash gifts only, no Texas state tax) which should replace the disallowed $15,750 standard deduction flagged separately, but Schedule A (Form 1040-NR) is not included in the return's forms list.", "Workpaper itemized deductions $250.00; return forms list omits Schedule A (1040-NR); return Line 12 shows $15,750"),
    mk("1042-S Box 10 shows $300 of total withholding credit and the workpaper includes it in total payments, but return Line 25g is blank and total payments shown is only $5,400.", "1042-S Box 10 $300.00; workpaper Line 25g $300.00; return Line 25g blank, Line 33 $5,400"),
    mk("2024 return Line 36 shows $600 applied to 2025 estimated tax, and the workpaper includes it in total payments, but return Line 26 is blank.", "2024 return Line 36 $600.00; workpaper Line 26 $600.00; return Line 26 blank"),
    // El reclamo de siempre sobre los libros sigue bajando.
    mk("Rent of $24,000 on the return vs $12,000 in the workpaper: $12,000 difference unexplained.", ""),
  ] };
  support[0].text += "\nRent,12000\nRent - second office,12000\n";
  const out = verifyWorkpaperClaims(review, support);
  assert.deepStrictEqual(out.issues.map((i) => i.priority), ["MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM", "LOW"]);

  // El modelo repite el cruce del FICA con una cifra en comun y el mismo tema: baja a LOW.
  const [fica] = runNonresidentChecks(filesOf(nrReturn({ days: "2023 0 , 2024 0 , and 2025 100 .", line12: "4,100.", visa: "F-1" }), [{
    name: "W-2.pdf",
    text: "Form W-2 Wage and Tax Statement 2025\n1 Wages, tips, other compensation 2 Federal income tax withheld\n52000.00 5400.00\n3 Social security wages 4 Social security tax withheld\n52000.00 3224.00",
  }]), { taxYear: "2025" });
  assert.match(fica.title, /on an F visa/);
  const repeated = foldFindingsRepeatedBy([
    { priority: "HIGH", formOrSchedule: "Social Security withholding refund mechanism — Form 843 / Form 8316", issueDescription: "Per the automated finding, the $3,224 Social Security tax withheld on the F-1 visa W-2 is exempt; the workpaper notes the client should request a refund from the employer or file Form 843/8316.", evidence: "W-2 Box 4 $3,224.00", source: "W-2.pdf" },
    { priority: "HIGH", formOrSchedule: "Wages — Form 1040-NR Line 1a", issueDescription: "W-2 Box 1 shows $52,000 but return Line 1a shows $46,000 and workpaper computes $47,000 (wages less $5,000 treaty exemption).", evidence: "", source: "W-2.pdf" },
  ], [fica]);
  assert.deepStrictEqual(repeated.issues.map((i) => i.priority), ["LOW", "HIGH"]);
});

test("la fila del tie-out que repite una cuenta mal hecha que ya marco el codigo baja a LOW", () => {
  const { foldTieOutIssuesExplainedBy } = require("../lib/tie-out");
  const arithmetic = { title: "1040-NR line 24 — amount does not follow the form's own arithmetic", detail: "1040-NR line 24 prints $1,242 where its own instruction (\"add lines 22 and 23d\") gives $742." };
  const issues = [
    { priority: "MEDIUM", issueDescription: "The return reports $1,242 on this line and the supporting documents add to $742: the return is $500 higher than the support.", source: "Tie-out computed by RAG Tax AI" },
    { priority: "MEDIUM", issueDescription: "The return reports $5,400 on this line and the supporting documents add to $6,300: the return is $900 lower than the support.", source: "Tie-out computed by RAG Tax AI" },
  ];
  const out = foldTieOutIssuesExplainedBy(issues, [arithmetic]);
  assert.deepStrictEqual(out.issues.map((i) => i.priority), ["LOW", "MEDIUM"]);
});
