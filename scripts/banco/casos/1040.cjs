"use strict";

/**
 * Caso del banco: 1040 de un matrimonio de Florida (sin declaracion estatal) con una hija.
 * Contribuyentes, empleadores y cifras inventados. La 2025 trae doce errores plantados; la 2024
 * esta bien y deja arrastres (sobrepago aplicado y perdida de capital).
 */

const ExcelJS = require("exceljs");
const { Form, buildPdf, m, summaryPages, simpleDoc, w2 } = require("../comun.cjs");

const TAXPAYER = "DANIEL R ORTEGA";
const SSN = "000-23-4561";
const SPOUSE = "MARIA L ORTEGA";
const SPOUSE_SSN = "000-23-4572";
const SPOUSE_SSN_TYPO = "000-23-4527"; // E5: dos digitos cambiados en 2025
const CHILD_SSN = "000-23-4583";

function form1040(year, v) {
  const f = new Form(`Form 1040 (${year})`);
  f.line("Department of the Treasury - Internal Revenue Service", { size: 7 });
  f.title(`Form 1040 U.S. Individual Income Tax Return ${year} OMB No. 1545-0074 IRS Use Only`);
  f.line(`For the year Jan. 1-Dec. 31, ${year}, or other tax year beginning , ${year}, ending , 20 See separate instructions.`, { size: 7 });
  f.line("Your first name and middle initial Last name Your social security number", { size: 7 });
  f.line(`${TAXPAYER} ${SSN}`, { bold: true });
  f.line("If joint return, spouse's first name and middle initial Last name Spouse's social security number", { size: 7 });
  f.line(`${SPOUSE} ${v.spouseSsn}`, { bold: true });
  f.line("Home address (number and street). If you have a P.O. box, see instructions. Apt. no.", { size: 7 });
  f.line("1450 OAK HOLLOW DR", { bold: true });
  f.line("City, town, or post office. If you have a foreign address, also complete spaces below. State ZIP code", { size: 7 });
  f.line("TAMPA, FL 33602", { bold: true });
  f.line("Filing Status Single Head of household (HOH)");
  f.line("Check only X Married filing jointly (even if only one had income) Qualifying surviving spouse (QSS)");
  f.line(`At any time during ${year}, did you: (a) receive (as a reward, award, or payment for property or services); or (b) sell,`, { size: 7 });
  f.line("Digital Assets exchange, or otherwise dispose of a digital asset (or a financial interest in a digital asset)? (See instructions.) . . Yes X No", { size: 7 });
  f.line("Dependents (see instructions) (1) First name (2) Last name (3) SSN (4) Relationship (7) Credits", { size: 7 });
  f.line(`SOFIA ORTEGA ${CHILD_SSN} DAUGHTER ${v.ctcBox ? "X Child tax credit" : "Child tax credit"}`);
  f.rule();
  f.row("1a", "Total amount from Form(s) W-2, box 1 (see instructions)", "1a", m(v.l1a));
  for (const [l, label] of [["b", "Household employee wages not reported on Form(s) W-2"], ["c", "Tip income not reported on line 1a (see instructions)"], ["d", "Medicaid waiver payments not reported on Form(s) W-2 (see instructions)"], ["e", "Taxable dependent care benefits from Form 2441, line 26"], ["f", "Employer-provided adoption benefits from Form 8839, line 31"], ["g", "Wages from Form 8919, line 6"], ["h", "Other earned income (see instructions). Enter type and amount:"]]) f.row(l, label, `1${l}`);
  f.row("z", "Add lines 1a through 1h", "1z", m(v.l1a));
  f.pair("2a", "Tax-exempt interest", "2a", "", "b", "Taxable interest", "2b", m(v.l2b));
  f.pair("3a", "Qualified dividends", "3a", "", "b", "Ordinary dividends", "3b", "");
  f.pair("4a", "IRA distributions", "4a", "", "b", "Taxable amount", "4b", "");
  f.pair("5a", "Pensions and annuities", "5a", "", "b", "Taxable amount", "5b", "");
  f.pair("6a", "Social security benefits", "6a", "", "b", "Taxable amount", "6b", "");
  const cg = year >= 2025 ? "7a" : "7";
  f.row(cg, "Capital gain or (loss). Attach Schedule D if required", cg, m(v.l7));
  f.row("8", "Additional income from Schedule 1, line 10", "8", m(v.l8));
  f.row("9", `Add lines 1z, 2b, 3b, 4b, 5b, 6b, ${cg}, and 8. This is your total income`, "9", m(v.l9));
  f.row("10", "Adjustments to income from Schedule 1, line 26", "10");
  const agi = year >= 2025 ? "11a" : "11";
  f.row(agi, "Subtract line 10 from line 9. This is your adjusted gross income", agi, m(v.l9));
  f.newPage();
  f.line(`Form 1040 (${year}) ${TAXPAYER} ${SSN} Page 2`, { bold: true });
  if (year >= 2025) f.row("11b", "Amount from line 11a (adjusted gross income)", "11b", m(v.l9));
  const sd = year >= 2025 ? "12e" : "12";
  f.row(sd, "Standard deduction or itemized deductions (from Schedule A)", sd, m(v.l12));
  f.row("13a", "Qualified business income deduction from Form 8995 or Form 8995-A", "13a");
  if (year >= 2025) {
    f.row("b", "Additional deductions from Schedule 1-A, line 38", "13b");
    f.row("14", "Add lines 12e, 13a, and 13b", "14", m(v.l12));
    f.row("15", "Subtract line 14 from line 11b. If zero or less, enter -0-. This is your taxable income", "15", m(v.l15));
  } else {
    f.row("14", "Add lines 12 and 13", "14", m(v.l12));
    f.row("15", "Subtract line 14 from line 11. If zero or less, enter -0-. This is your taxable income", "15", m(v.l15));
  }
  f.row("16", "16 Tax (see instructions). Check if any from Form(s): 1 8814 2 4972 3", "16", m(v.l16));
  f.row("17", "Amount from Schedule 2, line 3", "17");
  f.row("18", "Add lines 16 and 17", "18", m(v.l16));
  f.row("19", "Child tax credit or credit for other dependents from Schedule 8812", "19", m(v.l19));
  f.row("20", "Amount from Schedule 3, line 8", "20");
  f.row("21", "Add lines 19 and 20", "21", m(v.l19));
  f.row("22", "Subtract line 21 from line 18. If zero or less, enter -0-", "22", m(v.l22));
  f.row("23", "Other taxes, including self-employment tax, from Schedule 2, line 21", "23");
  f.row("24", "Add lines 22 and 23. This is your total tax", "24", m(v.l22));
  f.line("25 Federal income tax withheld from:", { bold: true });
  f.row("a", "Form(s) W-2", "25a", m(v.l25a));
  f.row("b", "Form(s) 1099", "25b");
  f.row("c", "Other forms (see instructions)", "25c");
  f.row("d", "Add lines 25a through 25c", "25d", m(v.l25a));
  f.row("26", `${year} estimated tax payments and amount applied from ${year - 1} return`, "26", m(v.l26));
  f.row("27a", "Earned income credit (EIC)", "27a");
  f.row("28", "Additional child tax credit (ACTC) from Schedule 8812", "28");
  f.row("29", "American opportunity credit from Form 8863, line 8", "29");
  f.row("31", "Amount from Schedule 3, line 15", "31");
  f.row("32", "Add lines 27a, 28, 29, 30, and 31. These are your total other payments and refundable credits", "32");
  f.row("33", "Add lines 25d, 26, and 32. These are your total payments", "33", m(v.l33));
  f.row("34", "If line 33 is more than line 24, subtract line 24 from line 33. This is the amount you overpaid", "34", m(v.l34));
  f.row("35a", "Amount of line 34 you want refunded to you. If Form 8888 is attached, check here", "35a", m(v.l35a));
  f.row("36", `Amount of line 34 you want applied to your ${year + 1} estimated tax`, "36", m(v.l36));
  f.row("37", "Subtract line 33 from line 24. This is the amount you owe.", "37");
  f.row("38", "Estimated tax penalty (see instructions)", "38");
  f.line("Paid Preparer Use Only Preparer's name RAG TAX AI TEST PREPARER PTIN P00000000 Firm's name TEST FIRM FOR SOFTWARE TESTING", { size: 7 });
  return f.done();
}

function schedule3(year) {
  const f = new Form(`Schedule 3 (Form 1040) ${year}`);
  f.title(`SCHEDULE 3 (Form 1040) Additional Credits and Payments ${year}`);
  f.line(`Name(s) shown on Form 1040 ${TAXPAYER} & ${SPOUSE} Your social security number ${SSN}`, { size: 7 }).rule();
  f.line("Part I Nonrefundable Credits", { bold: true });
  f.row("1", "Foreign tax credit. Attach Form 1116 if required", "1");
  f.row("8", "Add lines 1 through 4, 5a, 5b, and 7. Enter here and on Form 1040, 1040-SR, or 1040-NR, line 20", "8");
  f.line("Part II Other Payments and Refundable Credits", { bold: true });
  f.row("9", "Net premium tax credit. Attach Form 8962", "9");
  f.row("10", "Amount paid with request for extension to file (see instructions)", "10");
  f.row("15", "Add lines 9 through 12 and 14. Enter here and on Form 1040, 1040-SR, or 1040-NR, line 31", "15");
  return f.done();
}

function form4868(year) {
  const f = new Form(`Form 4868 (${year})`);
  f.title(`Form 4868 Application for Automatic Extension of Time To File U.S. Individual Income Tax Return ${year}`);
  f.line("Part I Identification", { bold: true });
  f.line(`1 Your name(s) (see instructions) ${TAXPAYER} & ${SPOUSE}`);
  f.line(`2 Your social security number ${SSN} 3 Spouse's social security number ${SPOUSE_SSN}`);
  f.line("Part II Individual Income Tax", { bold: true });
  f.row("4", `Estimate of total tax liability for ${year}`, "4", m(9000));
  f.row("5", `Total ${year} payments`, "5", m(7000));
  f.row("6", "Balance due. Subtract line 5 from line 4 (see instructions)", "6", m(2000));
  f.row("7", "Amount you're paying (see instructions)", "7", m(2000));
  return f.done();
}

function scheduleD2024() {
  const f = new Form("Schedule D (Form 1040) 2024");
  f.title("SCHEDULE D (Form 1040) Capital Gains and Losses 2024");
  f.line(`Name(s) shown on return ${TAXPAYER} & ${SPOUSE} Your social security number ${SSN}`, { size: 7 }).rule();
  f.line("Part I Short-Term Capital Gains and Losses - Generally Assets Held One Year or Less", { bold: true });
  f.row("1b", "Totals for all transactions reported on Form(s) 8949 with Box A checked", "1b", "(8,000.)");
  f.row("6", "Short-term capital loss carryover. Enter the amount, if any, from line 8 of your Capital Loss Carryover Worksheet in the instructions", "6");
  f.row("7", "Net short-term capital gain or (loss). Combine lines 1a through 6 in column (h)", "7", "(8,000.)");
  f.line("Part II Long-Term Capital Gains and Losses - Generally Assets Held More Than One Year", { bold: true });
  f.row("14", "Long-term capital loss carryover. Enter the amount, if any, from line 13 of your Capital Loss Carryover Worksheet in the instructions", "14");
  f.row("15", "Net long-term capital gain or (loss). Combine lines 8a through 14 in column (h)", "15");
  f.line("Part III Summary", { bold: true });
  f.row("16", "16 Combine lines 7 and 15 and enter the result", "16", "(8,000.)");
  f.row("21", "If line 16 is a loss, enter here and on Form 1040, 1040-SR, or 1040-NR, line 7, the smaller of the loss on line 16 or ($3,000), or if married filing separately, ($1,500)", "21", "(3,000.)");
  return f.done();
}

const y25 = { spouseSsn: SPOUSE_SSN_TYPO, ctcBox: true, l1a: 80000, l2b: 400, l7: "", l8: "", l9: 81400, l12: 15750, l15: 65650, l16: 7401, l19: "", l22: 7401, l25a: 8000, l26: "", l33: 8000, l34: 599, l35a: 599, l36: "" };
const y24 = { spouseSsn: SPOUSE_SSN, ctcBox: true, l1a: 82000, l2b: 350, l7: -3000, l8: "", l9: 79350, l12: 29200, l15: 50150, l16: 5554, l19: 2000, l22: 3554, l25a: 5054, l26: "", l33: 5054, l34: 1500, l35a: "", l36: 1500 };

const header = `${TAXPAYER} & ${SPOUSE} ${SSN}`;
const current = () => [
  ...summaryPages(2025, header, [["WAGES, SALARIES, TIPS", "80,000"], ["TAXABLE INTEREST", "400"], ["TOTAL INCOME", "81,400"], ["ADJUSTED GROSS INCOME", "81,400"], ["STANDARD DEDUCTION", "15,750"], ["TAXABLE INCOME", "65,650"], ["TOTAL TAX", "7,401"], ["FEDERAL INCOME TAX WITHHELD", "8,000"], ["AMOUNT OVERPAID", "599"], ["AMOUNT REFUNDED TO YOU", "599"]], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 1040, SCH 3, 4868, 8879",
    "TAX RATES",
    "MARGINAL EFFECTIVE",
    "FEDERAL 12.0% 9.1%",
  ]),
  ...form1040(2025, y25),
  ...schedule3(2025),
  ...form4868(2025),
];
const prior = () => [
  ...summaryPages(2024, header, [["WAGES, SALARIES, TIPS", "82,000"], ["TAXABLE INTEREST", "350"], ["CAPITAL GAIN OR (LOSS)", "(3,000)"], ["TOTAL INCOME", "79,350"], ["STANDARD DEDUCTION", "29,200"], ["TAXABLE INCOME", "50,150"], ["CHILD TAX CREDIT", "2,000"], ["TOTAL TAX", "3,554"], ["FEDERAL INCOME TAX WITHHELD", "5,054"], ["AMOUNT OVERPAID", "1,500"], ["OVERPAYMENT APPLIED TO NEXT YEAR", "1,500"]], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 1040, SCH B, SCH D, SCH 8812, 8949, 8879",
    "CARRYOVERS TO 2025",
    "FEDERAL CARRYOVERS",
    "SHORT-TERM CAPITAL LOSS 5,000.",
    "",
    "ESTIMATES",
    "FEDERAL ESTIMATES",
    "ESTIMATE OVERPAYMENT BALANCE",
    "4/15/25 1,500. 1,500. 0.",
    "TOTAL $ 1,500. $ 1,500. $ 0.",
  ]),
  ...form1040(2024, y24),
  ...scheduleD2024(),
];

const docs = () => ({
  "W2_Gulfline_Logistics_2025.pdf": w2({ year: 2025, ssn: SSN, ein: "98-1234561", employer: "GULFLINE LOGISTICS LLC", address: ["4100 W KENNEDY BLVD", "TAMPA FL 33609"], employee: TAXPAYER, box1: 62000, box2: 6100, box4: 3844, box6: 899, state: "FL" }),
  "W2_Bayside_Pediatric_Group_2025.pdf": w2({ year: 2025, ssn: SPOUSE_SSN, ein: "98-1234562", employer: "BAYSIDE PEDIATRIC GROUP PA", address: ["220 BAYSHORE BLVD", "TAMPA FL 33606"], employee: SPOUSE, box1: 23000, box2: 1900, box4: 1426, box6: 333.5, extra: ["10 Dependent care benefits 5000.00", "12a W 3000.00"], state: "FL" }),
  "1099-INT_Suncoast_Federal_Credit_Union_2025.pdf": simpleDoc([
    ["Form 1099-INT Interest Income 2025", { bold: true, size: 11 }],
    ["PAYER'S name: SUNCOAST FEDERAL CREDIT UNION, TAMPA FL 33610"],
    [`RECIPIENT'S TIN ${SSN}`], [`RECIPIENT'S name ${TAXPAYER}`],
    ["1 Interest income $ 2,400.00"], ["4 Federal income tax withheld $ 0.00"],
  ]),
  "1099-G_Florida_Reemployment_2025.pdf": simpleDoc([
    ["Form 1099-G Certain Government Payments 2025", { bold: true, size: 11 }],
    ["PAYER'S name: FLORIDA DEPARTMENT OF COMMERCE - REEMPLOYMENT ASSISTANCE"],
    [`RECIPIENT'S TIN ${SSN}`], [`RECIPIENT'S name ${TAXPAYER}`],
    ["1 Unemployment compensation $ 3,000.00"], ["4 Federal income tax withheld $ 0.00"],
  ]),
});

async function workpaper() {
  const wb = new ExcelJS.Workbook();
  const money = "#,##0.00;(#,##0.00)";
  const head = (ws, title) => { ws.addRow(["Daniel & Maria Ortega"]).font = { bold: true, size: 12 }; ws.addRow([title]).font = { bold: true }; ws.addRow(["Tax year 2025"]); ws.addRow([]); };
  const su = wb.addWorksheet("Return summary");
  head(su, "Form 1040 - amounts per workpaper");
  su.addRow(["Line", "Description", "Amount", "Source"]).font = { bold: true };
  for (const r of [
    ["1a", "Wages (W-2 box 1, both spouses)", 85000, "W-2s"],
    ["2b", "Taxable interest", 2400, "1099-INT"],
    ["7a", "Capital loss carryover (2024 Sch D: 8,000 loss less 3,000 allowed)", -3000, "2024 return"],
    ["8", "Schedule 1 - unemployment compensation", 3000, "1099-G"],
    ["9", "Total income", 87400, ""],
    ["12e", "Standard deduction (MFJ)", 31500, ""],
    ["15", "Taxable income", 55900, ""],
    ["19", "Child tax credit (1 child)", 2200, "Sofia, SSN on file"],
    ["25a", "Federal withholding W-2", 8000, "W-2s"],
    ["26", "2024 overpayment applied", 1500, "2024 return line 36"],
    ["31", "Extension payment (Form 4868)", 2000, "Paid 4/15/26"],
  ]) su.addRow(r).getCell(3).numFmt = money;
  const inc = wb.addWorksheet("Income documents");
  head(inc, "Documents received");
  inc.addRow(["Document", "Payer", "Amount", "Note"]).font = { bold: true };
  for (const r of [
    ["W-2 box 1", "Gulfline Logistics LLC", 62000, ""],
    ["W-2 box 1", "Bayside Pediatric Group PA", 23000, "Box 10 dependent care 5,000 - Form 2441; box 12 W 3,000 HSA - Form 8889"],
    ["1099-INT box 1", "Suncoast Federal Credit Union", 2400, ""],
    ["1099-G box 1", "Florida Reemployment Assistance", 3000, "Unemployment - Sch 1 line 7"],
  ]) inc.addRow(r).getCell(3).numFmt = money;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = {
  id: "1040",
  titulo: "1040 — matrimonio de Florida con una hija (MFJ)",
  returnType: "1040",
  taxYear: "2025",
  async archivos() {
    return [
      { name: "ORTEGA, DANIEL & MARIA TY 2025 return.pdf", role: "current_return", pdf: buildPdf(current()) },
      { name: "Daniel & Maria Ortega - 2024 Tax Returns.pdf", role: "prior_return", pdf: buildPdf(prior()) },
      { name: "Documents-2026_10_16.zip", role: "supporting_document", zip: Object.fromEntries(Object.entries(docs()).map(([n, b]) => [`Documents/${n}`, b])) },
      { name: "Ortega - 2025 1040 workpaper.xlsx", role: "supporting_document", xlsx: await workpaper() },
    ];
  },
  esperado: { estadoCivil: "Married filing jointly", tasaMarginal: 0.12 },
  clave: [
    { id: "E1", error: "Sueldos: los W-2 suman 85,000 y el renglon 1a dice 80,000", codigo: /line 1a — W-2 wages in the package exceed the return/i, tieout: "form1040l1a" },
    { id: "E2", error: "Interes: el 1099-INT dice 2,400 y el 2b 400", codigo: /line 2b — interest on the 1099s exceeds the return/i },
    { id: "E3", error: "Falta el sobrepago de 2024 aplicado (1,500) en el 26", codigo: /line 26 — last year's overpayment not applied/i },
    { id: "E4", error: "Falta la perdida de capital arrastrada (5,000)", codigo: /capital loss carryover not brought forward/i },
    { id: "E5", error: "SSN de la conyuge con dos digitos cambiados contra 2024", codigo: /spouse's SSN differs from last year/i },
    { id: "E6", error: "Deduccion estandar de soltero (15,750) en un MFJ", codigo: /standard deduction does not match the filing status/i },
    { id: "E7", error: "Renglon 9 mal sumado (81,400 en vez de 80,400)", codigo: /line 9 — amount does not follow/i },
    { id: "E8", error: "Desempleo del 1099-G (3,000) sin Schedule 1", codigo: /Form 1099-G not reflected/i },
    { id: "E9", error: "Pago de la prorroga (2,000) no reclamado en Schedule 3 linea 10", codigo: /extension payment not claimed/i },
    { id: "E10", error: "Hija con credito marcado y renglon 19 vacio", codigo: /dependents with no child tax credit/i },
    { id: "E11", error: "W-2 casilla 12 W (HSA 3,000) sin Form 8889", codigo: /W-2 code W \(employer HSA contributions\) with no Form 8889/i },
    { id: "E12", error: "W-2 casilla 10 (5,000 de cuidado de dependientes) sin Form 2441", codigo: null },
  ],
  tolerados: [
    // Consecuencias del mismo SSN mal cargado: el W-2 de la conyuge no coincide con la declaracion.
    /SSN|identif/i,
  ],
};
