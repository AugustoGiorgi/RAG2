"use strict";

/**
 * Caso del banco: 1040-NR de un estudiante chino con visa F-1 que pasa a OPT en Texas.
 * Contribuyente, empresas y cifras inventados. La declaracion 2025 trae catorce errores
 * plantados (ver "clave" al final); la 2024 esta bien y es de donde salen los arrastres.
 */

const { Form, Page, buildPdf } = require("../comun.cjs");
const ExcelJS = require("exceljs");

const m = (n) => (n === null || n === undefined || n === "" ? "" : `${Number(n).toLocaleString("en-US")}.`);
const NAME = "JUN HAO LIN";
const SSN = "000-12-3456";
const CHILD_SSN = "000-12-3457";

/* ---------------------------------------------------------------------------
 * Paginas de resumen del software (como las que imprime el software del estudio)
 * ------------------------------------------------------------------------- */
function summaryPages(year, rows, general) {
  const s = new Form(`${year} TAX RETURN SUMMARY`);
  s.title(`${year} TAX RETURN SUMMARY PAGE 1`, 10).line(`${NAME} ${SSN}`).space().line("FEDERAL", { bold: true });
  for (const [label, amount] of rows) s.row("", label, "", amount);
  const g = new Form(`${year} GENERAL INFORMATION`);
  g.title(`${year} GENERAL INFORMATION PAGE 1`, 10).line(`${NAME} ${SSN}`).space();
  g.lines(general);
  return [...s.done("PAGE"), ...g.done("PAGE")];
}

/* ---------------------------------------------------------------------------
 * Form 1040-NR
 * ------------------------------------------------------------------------- */
function form1040NR(year, v) {
  const f = new Form(`Form 1040-NR (${year})`);
  const prior = year - 1;
  f.line("Department of the Treasury - Internal Revenue Service", { size: 7 });
  f.title(`Form 1040-NR U.S. Nonresident Alien Income Tax Return ${year} OMB No. 1545-0074`);
  f.line(`For the year Jan. 1-Dec. 31, ${year}, or other tax year beginning , ${year}, ending , 20 See separate instructions.`, { size: 7 });
  f.rule();
  f.line("Your first name and middle initial Last name Your identifying number", { size: 7 });
  f.line(`JUN HAO LIN ${SSN}`, { bold: true });
  f.line("Home address (number and street). If you have a P.O. box, see instructions. Apt. no.", { size: 7 });
  f.line(v.address1, { bold: true });
  f.line("City, town, or post office. If you have a foreign address, also complete spaces below. State ZIP code", { size: 7 });
  f.line(v.address2, { bold: true });
  f.line("Foreign country name Foreign province/state/county Foreign postal code", { size: 7 });
  f.line("CHINA ZHEJIANG 310000", { bold: true });
  f.line("Filing Status Single X Married filing separately (MFS) Qualifying surviving spouse (QSS) Estate Trust");
  f.line("If you checked the MFS box, enter the name of your spouse: MEI XU (NONRESIDENT ALIEN, NO SSN OR ITIN)", { size: 7 });
  f.line(`Digital Assets At any time during ${year}, did you: (a) receive (as a reward, award, or payment for property or services); or (b) sell,`, { size: 7 });
  f.line("exchange, or otherwise dispose of a digital asset (or a financial interest in a digital asset)? (See instructions.) . . Yes X No", { size: 7 });
  f.line(`Dependents (1) First name LUCAS (2) Last name LIN (3) Identifying number ${CHILD_SSN} (4) Relationship SON (5) X Yes (6) ${v.childCredit ? "X Child tax credit" : "Child tax credit"}`, { size: 7 });
  f.rule();
  f.row("1a", "Total amount from Form(s) W-2, box 1 (see instructions)", "1a", m(v.l1a));
  f.row("b", "Household employee wages not reported on Form(s) W-2", "1b");
  f.row("c", "Tip income not reported on line 1a (see instructions)", "1c");
  f.row("d", "Medicaid waiver payments not reported on Form(s) W-2 (see instructions)", "1d");
  f.row("e", "Taxable dependent care benefits from Form 2441, line 26", "1e");
  f.row("f", "Employer-provided adoption benefits from Form 8839, line 31", "1f");
  f.row("g", "Wages from Form 8919, line 6", "1g");
  f.row("h", "Other earned income (see instructions). Enter type and amount:", "1h");
  f.row("i", "Reserved for future use", "1i");
  f.row("j", "Reserved for future use", "1j");
  f.row("k", ["Total income exempt by a treaty from Schedule OI (Form 1040-NR), item", "L, line 1(e)"], "1k", m(v.l1k));
  f.row("z", "Add lines 1a through 1h", "1z", m(v.l1z));
  f.pair("2a", "Tax-exempt interest", "2a", "", "b", "Taxable interest", "2b", m(v.l2b));
  f.pair("3a", "Qualified dividends", "3a", "", "b", "Ordinary dividends", "3b", "");
  f.pair("4a", "IRA distributions", "4a", "", "b", "Taxable amount", "4b", "");
  f.pair("5a", "Pensions and annuities", "5a", "", "b", "Taxable amount", "5b", "");
  f.row("6", "Reserved for future use", "6");
  const cg = year >= 2025 ? "7a" : "7";
  f.row(cg, "Capital gain or (loss). Attach Schedule D if required", cg);
  f.row("8", "Additional income from Schedule 1 (Form 1040), line 10", "8", m(v.l8));
  f.row("9", `Add lines 1z, 2b, 3b, 4b, 5b, ${cg}, and 8. This is your total effectively connected income`, "9", m(v.l9));
  f.row("10", ["Adjustments to income from Schedule 1 (Form 1040), line 26. These are your total adjustments to", "income"], "10");
  const agi = year >= 2025 ? "11a" : "11";
  f.row(agi, "Subtract line 10 from line 9. This is your adjusted gross income", agi, m(v.l11));
  f.newPage();
  f.line(`Form 1040-NR (${year}) Page 2`, { bold: true });
  if (year >= 2025) f.row("11b", "Amount from line 11a (adjusted gross income)", "11b", m(v.l11));
  f.row("12", ["Itemized deductions (from Schedule A (Form 1040-NR)) or, for certain residents of India, standard", "deduction (see instructions)"], "12", m(v.l12));
  f.row("13a", "Qualified business income deduction from Form 8995 or Form 8995-A", "13a");
  f.row("b", "Exemptions for estates and trusts only (see instructions)", "13b");
  if (year >= 2025) {
    f.row("c", "Additional deductions from Schedule 1-A, line 38", "13c");
    f.row("14", "Add lines 12 through 13c", "14", m(v.l14));
    f.row("15", "Subtract line 14 from line 11b. If zero or less, enter -0-. This is your taxable income", "15", m(v.l15));
  } else {
    f.row("c", "Add lines 13a and 13b", "13c");
    f.row("14", "Add lines 12 and 13c", "14", m(v.l14));
    f.row("15", "Subtract line 14 from line 11. If zero or less, enter -0-. This is your taxable income", "15", m(v.l15));
  }
  f.row("16", "Tax (see instructions). Check if any from Form(s): 1 8814 2 4972 3", "16", m(v.l16));
  f.row("17", "Amount from Schedule 2 (Form 1040), line 3", "17");
  f.row("18", "Add lines 16 and 17", "18", m(v.l16));
  f.row("19", "Child tax credit or credit for other dependents from Schedule 8812 (Form 1040)", "19", m(v.l19));
  f.row("20", "Amount from Schedule 3 (Form 1040), line 8", "20", m(v.l20));
  f.row("21", "Add lines 19 and 20", "21", m(v.l21));
  f.row("22", "Subtract line 21 from line 18. If zero or less, enter -0-", "22", m(v.l22));
  f.row("23a", ["Tax on income not effectively connected with a U.S. trade or business from", "Schedule NEC (Form 1040-NR), line 15"], "23a", m(v.l23a));
  f.row("b", ["Other taxes, including self-employment tax, from Schedule 2 (Form 1040),", "line 21"], "23b");
  f.row("c", "Transportation tax (see instructions)", "23c");
  f.row("d", "Add lines 23a through 23c", "23d", m(v.l23a));
  f.row("24", "Add lines 22 and 23d. This is your total tax", "24", m(v.l24));
  f.line("25 Federal income tax withheld from:", { bold: true });
  f.row("a", "Form(s) W-2", "25a", m(v.l25a));
  f.row("b", "Form(s) 1099", "25b");
  f.row("c", "Other forms (see instructions)", "25c");
  f.row("d", "Add lines 25a through 25c", "25d", m(v.l25a));
  f.row("e", "Form(s) 8805", "25e");
  f.row("f", "Form(s) 8288-A", "25f");
  f.row("g", "Form(s) 1042-S", "25g", m(v.l25g));
  f.row("26", `${year} estimated tax payments and amount applied from ${prior} return`, "26", m(v.l26));
  f.row("27", "Reserved for future use", "27");
  f.row("28", ["Additional child tax credit (ACTC) from Schedule 8812 (Form 1040). If you", "do not want to claim the ACTC, check here"], "28");
  f.row("29", "Credit for amount paid with Form 1040-C", "29");
  f.row("30", "Refundable adoption credit from Form 8839, line 13", "30");
  f.row("31", "Amount from Schedule 3 (Form 1040), line 15", "31");
  f.row("32", "Add lines 28, 29, 30, and 31. These are your total other payments and refundable credits", "32");
  f.row("33", "Add lines 25d, 25e, 25f, 25g, 26, and 32. These are your total payments", "33", m(v.l33));
  f.row("34", "If line 33 is more than line 24, subtract line 24 from line 33. This is the amount you overpaid", "34", m(v.l34));
  f.row("35a", "Amount of line 34 you want refunded to you. If Form 8888 is attached, check here", "35a", m(v.l35a));
  f.row("36", `Amount of line 34 you want applied to your ${year + 1} estimated tax`, "36", m(v.l36));
  f.row("37", "Subtract line 33 from line 24. This is the amount you owe", "37");
  f.row("38", "Estimated tax penalty (see instructions)", "38");
  f.rule();
  f.line("Sign Here Your signature Date Your occupation", { size: 7 });
  f.line(`JUN HAO LIN ${year === 2025 ? "04/10/2026" : "04/08/2025"} ${v.occupation}`, { size: 7 });
  f.line("Paid Preparer Use Only Preparer's name Preparer's signature PTIN Firm's name", { size: 7 });
  f.line("RAG TAX AI TEST PREPARER P00000000 TEST FIRM FOR SOFTWARE TESTING", { size: 7 });
  return f.done();
}

/* ---------------------------------------------------------------------------
 * Schedule OI
 * ------------------------------------------------------------------------- */
function scheduleOI(year, v) {
  const f = new Form(`Schedule OI (Form 1040-NR) ${year}`);
  f.title("SCHEDULE OI Other Information OMB No. 1545-0074");
  f.line("(Form 1040-NR)").line(`${year}`).line("Attach to Form 1040-NR. Answer all questions.", { size: 7 });
  f.line("Name shown on Form 1040-NR Your identifying number", { size: 7 }).line(`${NAME} ${SSN}`, { bold: true }).rule();
  f.line("A Of what country or countries were you a citizen or national during the tax year? CHINA");
  f.line("B In what country did you claim residence for tax purposes during the tax year? CHINA");
  f.line("C Have you ever applied to be a green card holder (lawful permanent resident) of the United States? . . . . . Yes X No");
  f.line("D Were you ever:");
  f.line("1. A U.S. citizen? . . . . . . . . . . . . . . . . . . . . . . . . . . . . Yes X No");
  f.line("2. A green card holder (lawful permanent resident) of the United States? . . . . . . . . . . Yes X No");
  f.line("E If you had a visa on the last day of the tax year, enter your visa type. If you didn't have a visa, enter your U.S.");
  f.line("immigration status on the last day of the tax year. F-1");
  f.line("F Have you ever changed your visa type (nonimmigrant status) or U.S. immigration status? . . . . . . . . Yes X No");
  f.line(`G List all dates you entered and left the United States during ${year}. See instructions.`);
  f.line("Date entered United States Date departed United States Date entered United States Date departed United States", { size: 7 });
  f.line(v.dates);
  f.line("H Give number of days (including vacation, nonworkdays, and partial days) you were present in the United States during:");
  f.line(v.days);
  f.line(`I Did you file a U.S. income tax return for any prior year? . . . . . . . . . . . . . . . . . . . ${v.filedPrior ? "X Yes No" : "Yes X No"}`);
  f.line(`If "Yes," give the latest year and form number you filed: ${v.filedPrior || ""}`);
  f.line("J Are you filing a return for a trust? . . . . . . . . . . . . . . . . . . . . . . . . . . Yes X No");
  f.line("K Did you receive total compensation of $250,000 or more during the tax year? . . . . . . . . . . . . Yes X No");
  f.line("L Income Exempt From Tax-If you are claiming exemption from income tax under a U.S. income tax treaty with a foreign country,");
  f.line("complete (1) through (3) below. See Pub. 901 for more information on tax treaties.");
  f.line("1. Enter the name of the country, the applicable tax treaty article, the number of months in prior years you claimed the treaty benefit, and the", { size: 7 });
  f.line("amount of exempt income in the columns below. Attach Form 8833 if required. See instructions.", { size: 7 });
  f.line("(a) Country (b) Tax treaty article (c) Number of months claimed in prior tax years (d) Amount of exempt income in current tax year", { size: 7 });
  f.row("", `CHINA 20(c) ${v.treatyMonths}`, "", m(v.treatyAmount));
  f.row("", "(e) Total. Enter this amount on Form 1040-NR, line 1k. Do not enter it anywhere else on line 1", "", m(v.treatyAmount));
  f.line("2. Were you subject to tax in a foreign country on any of the income shown in 1(d) above? . . . . . . . . Yes X No");
  f.line("3. Are you claiming treaty benefits pursuant to a Competent Authority determination? . . . . . . . . . . Yes X No");
  f.line("M Check the applicable box if: (1) first-year section 871(d) election; (2) prior-year section 871(d) election not revoked. (none)");
  return f.done();
}

function scheduleNEC(year, dividends) {
  const f = new Form(`Schedule NEC (Form 1040-NR) ${year}`);
  f.title(`Schedule NEC (Form 1040-NR) Tax on Income Not Effectively Connected With a U.S. Trade or Business ${year}`, 10);
  f.line(`Name shown on Form 1040-NR ${NAME} Your identifying number ${SSN}`, { size: 7 }).rule();
  f.line("Nature of income Enter amount of income under the appropriate rate of tax (a) 10% (b) 15% (c) 30% (d) Other (specify) %", { size: 7 });
  f.row("1", "Dividends and dividend equivalents:");
  f.row("a", "Dividends paid by U.S. corporations", "1a", m(dividends));
  f.row("b", "Dividends paid by foreign corporations", "1b");
  f.row("c", "Dividend equivalent payments received with respect to section 871(m) transactions", "1c");
  f.row("2", "Interest: a Mortgage . . . b Paid by foreign corporations . . . c Other", "2c");
  f.row("3", "Industrial royalties (patents, trademarks, etc.)", "3");
  f.row("7", "Pensions and annuities", "7");
  f.row("8", "Social security benefits", "8");
  f.row("9", "Capital gain from line 18 below", "9");
  f.row("12", "Other (specify)", "12");
  f.row("13", "Add lines 1a through 12 in columns (a) through (d)", "13", m(dividends));
  f.row("14", "Multiply line 13 by rate of tax at top of each column", "14", m(dividends / 10));
  f.row("15", ["Tax on income not effectively connected with a U.S. trade or business. Add columns (a) through (d)", "of line 14. Enter the total here and on Form 1040-NR, line 23a"], "15", m(dividends / 10));
  return f.done();
}

/* ---------------------------------------------------------------------------
 * 2025: la declaracion bajo revision, con errores plantados
 * ------------------------------------------------------------------------- */
const y25 = {
  address1: "1800 LAVACA ST APT 1204", address2: "AUSTIN TX 78701", occupation: "DATA ANALYST (OPT)", childCredit: true,
  l1a: 46000, l1k: 6000, l1z: 46000, l2b: 420, l8: "", l9: 46420, l11: 46420, l12: 15750, l14: 15750, l15: 30670,
  l16: 3442, l19: 2200, l20: 800, l21: 3000, l22: 442, l23a: 300, l24: 1242, l25a: 5400, l25g: "", l26: "", l33: 5400,
  l34: 4158, l35a: 4158, l36: "",
};
const current = [
  ...summaryPages(2025, [
    ["WAGES, SALARIES, TIPS", "46,000"], ["TAXABLE INTEREST", "420"], ["TOTAL EFFECTIVELY CONNECTED INCOME", "46,420"],
    ["ADJUSTED GROSS INCOME", "46,420"], ["STANDARD DEDUCTION", "15,750"], ["TAXABLE INCOME", "30,670"], ["TAX", "3,442"],
    ["CHILD TAX CREDIT", "2,200"], ["EDUCATION CREDITS", "800"], ["TAX ON INCOME NOT EFFECTIVELY CONNECTED", "300"],
    ["TOTAL TAX", "1,242"], ["FEDERAL INCOME TAX WITHHELD", "5,400"], ["TOTAL PAYMENTS", "5,400"], ["AMOUNT OVERPAID", "4,158"],
    ["AMOUNT REFUNDED TO YOU", "4,158"],
  ], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 1040-NR, SCH 3, SCH NEC, SCH OI, 8812, 8863, 8879",
    "TAX RATES",
    "MARGINAL EFFECTIVE",
    "FEDERAL 12.0% 2.7%",
  ]),
  ...form1040NR(2025, y25),
];
// Schedule 3
{
  const f = new Form("Schedule 3 (Form 1040) 2025");
  f.title("SCHEDULE 3 (Form 1040) Additional Credits and Payments 2025");
  f.line("Attach to Form 1040, 1040-SR, or 1040-NR.", { size: 7 }).line(`Name(s) shown on Form 1040, 1040-SR, or 1040-NR ${NAME} Your social security number ${SSN}`, { size: 7 }).rule();
  f.line("Part I Nonrefundable Credits", { bold: true });
  f.row("1", "Foreign tax credit. Attach Form 1116 if required", "1");
  f.row("2", "Credit for child and dependent care expenses from Form 2441, line 11. Attach Form 2441", "2");
  f.row("3", "Education credits from Form 8863, line 19", "3", m(800));
  f.row("4", "Retirement savings contributions credit. Attach Form 8880", "4");
  f.row("5a", "Residential clean energy credit from Form 5695, line 15", "5a");
  f.row("b", "Energy efficient home improvement credit from Form 5695, line 32", "5b");
  f.row("7", "Total other nonrefundable credits. Add lines 6a through 6z", "7");
  f.row("8", "Add lines 1 through 4, 5a, 5b, and 7. Enter here and on Form 1040, 1040-SR, or 1040-NR, line 20", "8", m(800));
  current.push(...f.done());
}
// Schedule 8812
{
  const f = new Form("Schedule 8812 (Form 1040) 2025");
  f.title("SCHEDULE 8812 (Form 1040) Credits for Qualifying Children and Other Dependents 2025");
  f.line("Attach to Form 1040, 1040-SR, or 1040-NR.", { size: 7 }).line(`Name(s) shown on return ${NAME} Your social security number ${SSN}`, { size: 7 }).rule();
  f.line("Part I-A Child Tax Credit and Credit for Other Dependents", { bold: true });
  f.row("1", "Enter the amount from line 11 of your Form 1040, 1040-SR, or 1040-NR", "1", m(46420));
  f.row("2d", "Add lines 2a through 2c", "2d");
  f.row("3", "Add lines 1 and 2d", "3", m(46420));
  f.row("4", "Number of qualifying children under age 17 with the required social security number", "4", "1");
  f.row("5", "Multiply line 4 by $2,200", "5", m(2200));
  f.row("6", "Number of other dependents, including any qualifying children who are not under age 17", "6");
  f.row("7", "Multiply line 6 by $500", "7");
  f.row("8", "Add lines 5 and 7", "8", m(2200));
  f.row("9", "Enter the amount shown below for your filing status: Married filing jointly - $400,000; All other filing statuses - $200,000", "9", m(200000));
  f.row("10", "Subtract line 9 from line 3. If zero or less, enter -0-", "10", "0.");
  f.row("11", "Multiply line 10 by 5% (0.05)", "11", "0.");
  f.row("12", "Subtract line 11 from line 8", "12", m(2200));
  f.row("13", "Enter the amount from Credit Limit Worksheet A", "13", m(2642));
  f.row("14", "Enter the smaller of line 12 or line 13. This is your child tax credit and credit for other dependents", "14", m(2200));
  f.line("Enter this amount on Form 1040, 1040-SR, or 1040-NR, line 19.", { size: 7 });
  current.push(...f.done());
}
// Form 8863
{
  const f = new Form("Form 8863 (2025)");
  f.title("Form 8863 Education Credits (American Opportunity and Lifetime Learning Credits) 2025");
  f.line("Attach to Form 1040 or 1040-SR.", { size: 7 }).line(`Name(s) shown on return ${NAME} Your social security number ${SSN}`, { size: 7 }).rule();
  f.line("Part I Refundable American Opportunity Credit", { bold: true });
  f.row("1", "After completing Part III for each student, enter the total of all amounts from all Parts III, line 30", "1");
  f.row("8", "Refundable American opportunity credit. Multiply line 7 by 40% (0.40)", "8");
  f.line("Part II Nonrefundable Education Credits", { bold: true });
  f.row("9", "Subtract line 8 from line 7. Enter here and on line 2 of the Credit Limit Worksheet (see instructions)", "9");
  f.row("10", "After completing Part III for each student, enter the total of all amounts from all Parts III, line 31", "10", m(4000));
  f.row("11", "Enter the smaller of line 10 or $10,000", "11", m(4000));
  f.row("12", "Multiply line 11 by 20% (0.20)", "12", m(800));
  f.row("13", "Enter: $180,000 if married filing jointly; $90,000 if single, head of household, or qualifying surviving spouse", "13", m(90000));
  f.row("14", "Enter the amount from Form 1040 or 1040-SR, line 11", "14", m(46420));
  f.row("15", "Subtract line 14 from line 13. If zero or less, stop; you can't take any education credit", "15", m(43580));
  f.row("16", "Enter: $20,000 if married filing jointly; $10,000 if single, head of household, or qualifying surviving spouse", "16", m(10000));
  f.row("17", "If line 15 is equal to or more than line 16, enter 1.000 on line 17 and go to line 18", "17", "1.000");
  f.row("18", "Multiply line 12 by line 17. Enter here and on line 1 of the Credit Limit Worksheet (see instructions)", "18", m(800));
  f.row("19", ["Nonrefundable education credits. Enter the amount from line 7 of the Credit Limit Worksheet (see", "instructions) here and on Schedule 3 (Form 1040), line 3"], "19", m(800));
  f.line("Part III Student and Educational Institution Information", { bold: true });
  f.line(`20 Student name: ${NAME} 21 Student social security number: ${SSN}`);
  f.line("22 Educational institution: CENTRAL TEXAS INSTITUTE OF TECHNOLOGY, 2100 RED RIVER ST, AUSTIN, TX 78705");
  f.line("Did the student receive Form 1098-T from this institution for 2025? X Yes No");
  f.row("31", "Lifetime learning credit. Enter the qualified education expenses for this student", "31", m(4000));
  current.push(...f.done());
}
current.push(...scheduleNEC(2025, 3000));
current.push(...scheduleOI(2025, {
  dates: "01/08/25 07/05/25 07/20/25 12/18/25",
  days: "2023 345 , 2024 350 , and 2025 331 .",
  filedPrior: "", // ERROR: si presento 2024
  treatyMonths: "0", // ERROR: 41 meses
  treatyAmount: 5000,
}));

/* ---------------------------------------------------------------------------
 * 2024: la declaracion del año anterior, correcta
 * ------------------------------------------------------------------------- */
const y24 = {
  address1: "905 W NEVADA ST APT 2", address2: "URBANA IL 61801", occupation: "GRADUATE STUDENT", childCredit: false,
  l1a: 16000, l1k: 5000, l1z: 16000, l2b: "", l8: "", l9: 16000, l11: 16000, l12: 1750, l14: 1750, l15: 14250,
  l16: 1478, l19: "", l20: "", l21: "", l22: 1478, l23a: 100, l24: 1578, l25a: 2100, l25g: 100, l26: "", l33: 2200,
  l34: 622, l35a: 22, l36: 600,
};
const prior = [
  ...summaryPages(2024, [
    ["WAGES, SALARIES, TIPS", "16,000"], ["TOTAL EFFECTIVELY CONNECTED INCOME", "16,000"], ["ADJUSTED GROSS INCOME", "16,000"],
    ["ITEMIZED DEDUCTIONS", "1,750"], ["TAXABLE INCOME", "14,250"], ["TAX", "1,478"], ["TAX ON INCOME NOT EFFECTIVELY CONNECTED", "100"],
    ["TOTAL TAX", "1,578"], ["FEDERAL INCOME TAX WITHHELD", "2,200"], ["TOTAL PAYMENTS", "2,200"], ["AMOUNT OVERPAID", "622"],
    ["AMOUNT REFUNDED TO YOU", "22"], ["OVERPAYMENT APPLIED TO NEXT YEAR", "600"],
  ], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 1040-NR, SCH A (1040-NR), SCH NEC, SCH OI, 8843, 8879",
    "ILLINOIS: IL-1040, SCH NR",
    "TAX RATES",
    "MARGINAL EFFECTIVE",
    "FEDERAL 12.0% 9.9%",
    "ESTIMATES",
    "FEDERAL ESTIMATES",
    "ESTIMATE OVERPAYMENT BALANCE",
    "4/15/25 600. 600. 0.",
    "TOTAL $ 600. $ 600. $ 0.",
  ]),
  ...form1040NR(2024, y24),
];
{
  const f = new Form("Schedule A (Form 1040-NR) 2024");
  f.title("SCHEDULE A (Form 1040-NR) Itemized Deductions 2024");
  f.line("Attach to Form 1040-NR.", { size: 7 }).line(`Name shown on Form 1040-NR ${NAME} Your identifying number ${SSN}`, { size: 7 }).rule();
  f.line("Taxes You Paid", { bold: true });
  f.row("1a", "State and local income taxes", "1a", m(1450));
  f.row("b", "Enter the smaller of line 1a or $10,000 ($5,000 if married filing separately)", "1b", m(1450));
  f.line("Gifts to U.S. Charities", { bold: true });
  f.row("2", "Gifts by cash or check", "2", m(300));
  f.row("3", "Other than by cash or check", "3");
  f.row("4", "Carryover from prior year", "4");
  f.row("5", "Add lines 2 through 4", "5", m(300));
  f.row("6", "Casualty and theft loss(es) from a federally declared disaster", "6");
  f.row("7", "Other itemized deductions", "7");
  f.row("8", "Add the amounts on lines 1b, 5, 6, and 7. Also, enter this amount on Form 1040-NR, line 12", "8", m(1750));
  prior.push(...f.done());
}
prior.push(...scheduleNEC(2024, 1000));
prior.push(...scheduleOI(2024, {
  dates: "01/06/24 06/02/24 06/18/24 12/20/24",
  days: "2022 330 , 2023 345 , and 2024 350 .",
  filedPrior: "2023 FORM 1040-NR",
  treatyMonths: "29",
  treatyAmount: 5000,
}));
{
  const f = new Form("Form 8843 (2024)");
  f.title("Form 8843 Statement for Exempt Individuals and Individuals With a Medical Condition 2024");
  f.line("For use by alien individuals only.", { size: 7 }).rule();
  f.line("Your first name and initial Last name Your U.S. taxpayer identification number, if any", { size: 7 });
  f.line(`JUN HAO LIN ${SSN}`, { bold: true });
  f.line("Address in country of residence: ROOM 502, 18 WENHUA RD, HANGZHOU, ZHEJIANG 310000, CHINA");
  f.line("Address in the United States: 905 W NEVADA ST APT 2, URBANA, IL 61801");
  f.line("Part I General Information", { bold: true });
  f.line("1a Type of U.S. visa (for example, F, J, M, Q, etc.) and date you entered the United States: F-1 08/14/2021");
  f.line("b Current nonimmigrant status. If your status has changed, also enter date of change and previous status: F-1");
  f.line("2 Of what country or countries were you a citizen during the tax year? CHINA");
  f.line("3a What country or countries issued you a passport? CHINA");
  f.line("4a Enter the actual number of days you were present in the United States during: 2024 350 2023 345 2022 330");
  f.line("b Enter the number of days in 2024 you claim you can exclude for purposes of the substantial presence test: 350");
  f.line("Part III Students", { bold: true });
  f.line("9 Name, address, and telephone number of the academic institution you attended during 2024:");
  f.line("MIDWEST PRAIRIE UNIVERSITY, 601 E JOHN ST, URBANA, IL 61801");
  f.line("10 Director of the academic program: INTERNATIONAL STUDENT AND SCHOLAR SERVICES, MIDWEST PRAIRIE UNIVERSITY");
  f.line("11 Type of U.S. visa (F, J, M, or Q) you held during: 2018 2019 2020 2021 F 2022 F 2023 F");
  f.line("12 Were you present in the United States as a teacher, trainee, or student for any part of more than 5 calendar years? . . Yes X No");
  f.line("13 During 2024, did you apply for, or take other affirmative steps to apply for, lawful permanent resident status? . . Yes X No");
  prior.push(...f.done());
}

/* ---------------------------------------------------------------------------
 * Documentos de soporte (2025)
 * ------------------------------------------------------------------------- */
function simpleDocNR(lines) {
  const p = new Page();
  for (const [s, opts] of lines) { p.text(36, s, opts || {}); p.down(opts && opts.dy ? opts.dy : 13); }
  return buildPdf([p]);
}
const docs = {
  "W2_Bluebonnet_Data_Systems_2025.pdf": simpleDocNR([
    ["Form W-2 Wage and Tax Statement 2025", { bold: true, size: 11 }],
    ["Copy B - To Be Filed With Employee's FEDERAL Tax Return. Department of the Treasury - Internal Revenue Service", { size: 7 }],
    [`a Employee's social security number ${SSN}`],
    ["b Employer identification number (EIN) 99-1234567"],
    ["c Employer's name, address, and ZIP code"],
    ["BLUEBONNET DATA SYSTEMS LLC"], ["600 CONGRESS AVE STE 1400"], ["AUSTIN TX 78701"],
    ["e Employee's first name and initial Last name"], ["JUN HAO LIN"], ["1800 LAVACA ST APT 1204 AUSTIN TX 78701"],
    ["1 Wages, tips, other compensation 2 Federal income tax withheld"], ["52000.00 5400.00"],
    ["3 Social security wages 4 Social security tax withheld"], ["52000.00 3224.00"],
    ["5 Medicare wages and tips 6 Medicare tax withheld"], ["52000.00 754.00"],
    ["12a See instructions for box 12"],
    ["15 State Employer's state ID number 16 State wages, tips, etc. 17 State income tax"], ["TX"],
  ]),
  "1042-S_Harbor_Point_Securities_2025.pdf": simpleDocNR([
    ["Form 1042-S Foreign Person's U.S. Source Income Subject to Withholding 2025", { bold: true, size: 11 }],
    ["Copy B for Recipient", { size: 7 }],
    ["1 Income code 06"], ["2 Gross income 3,000.00"], ["3 Chapter indicator. Enter \"3\" or \"4\" 3"],
    ["3a Exemption code 00"], ["3b Tax rate 10.00"],
    ["7a Federal tax withheld 300.00"], ["8 Tax withheld by other agents 0.00"], ["10 Total withholding credit 300.00"],
    ["12a Withholding agent's EIN 99-2345678"], ["12d Withholding agent's name HARBOR POINT SECURITIES LLC"],
    ["13a Recipient's name JUN HAO LIN"], ["13b Recipient's country code CH"],
    ["13c Address 1800 LAVACA ST APT 1204, AUSTIN TX 78701"], ["13e Recipient's U.S. TIN, if any 000-12-3456"],
    ["13j LOB code 02"], ["13l Recipient's date of birth 03/22/1999"],
  ]),
  "1099-INT_Hill_Country_Savings_Bank_2025.pdf": simpleDocNR([
    ["Form 1099-INT Interest Income 2025", { bold: true, size: 11 }],
    ["PAYER'S name: HILL COUNTRY SAVINGS BANK, 300 W 6TH ST, AUSTIN TX 78701"],
    [`RECIPIENT'S TIN ${SSN}`], ["RECIPIENT'S name JUN HAO LIN"],
    ["1 Interest income $ 420.00"], ["4 Federal income tax withheld $ 0.00"], ["8 Tax-exempt interest $ 0.00"],
  ]),
  "1099-G_Illinois_Department_of_Revenue_2025.pdf": simpleDocNR([
    ["Form 1099-G Certain Government Payments 2025", { bold: true, size: 11 }],
    ["PAYER'S name: ILLINOIS DEPARTMENT OF REVENUE, SPRINGFIELD IL 62794"],
    [`RECIPIENT'S TIN ${SSN}`], ["RECIPIENT'S name JUN HAO LIN"],
    ["1 Unemployment compensation $ 0.00"],
    ["2 State or local income tax refunds, credits, or offsets $ 310.00"],
    ["3 Box 2 amount is for tax year 2024"],
  ]),
  "1098-T_Central_Texas_Institute_2025.pdf": simpleDocNR([
    ["Form 1098-T Tuition Statement 2025", { bold: true, size: 11 }],
    ["FILER'S name: CENTRAL TEXAS INSTITUTE OF TECHNOLOGY, 2100 RED RIVER ST, AUSTIN TX 78705"],
    [`STUDENT'S TIN ${SSN}`], ["STUDENT'S name JUN HAO LIN"],
    ["1 Payments received for qualified tuition and related expenses $ 4,000.00"],
    ["5 Scholarships or grants $ 0.00"],
    ["8 Check if at least half-time student"], ["9 Check if graduate student X"],
  ]),
};

/* ---------------------------------------------------------------------------
 * Workpaper (con las cifras correctas)
 * ------------------------------------------------------------------------- */
async function workpaper() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Test preparer";
  const money = "#,##0.00;(#,##0.00)";
  const header = (ws, title, period) => {
    ws.addRow(["Jun Hao Lin"]).font = { bold: true, size: 12 };
    ws.addRow([title]).font = { bold: true };
    ws.addRow([period]);
    ws.addRow([]);
  };
  // Detalle de documentos
  const inc = wb.addWorksheet("Income documents");
  header(inc, "Income documents received", "January-December, 2025");
  inc.addRow(["Document", "Payer", "Amount", "Treatment"]).font = { bold: true };
  const incomeRows = [
    ["W-2 box 1", "Bluebonnet Data Systems LLC", 52000, "ECI wages. Line 1a after the China treaty exemption (Sch OI L)."],
    ["W-2 box 2", "Bluebonnet Data Systems LLC", 5400, "Federal withholding - line 25a"],
    ["W-2 box 4", "Bluebonnet Data Systems LLC", 3224, "F-1 OPT: exempt from social security and Medicare - ask employer for refund (Form 843/8316)"],
    ["1042-S code 06 box 2", "Harbor Point Securities LLC", 3000, "U.S. dividends, FDAP - Schedule NEC at 10% (China treaty Art. 9)"],
    ["1042-S box 10", "Harbor Point Securities LLC", 300, "Withholding credit - line 25g"],
    ["1099-INT box 1", "Hill Country Savings Bank", 420, "Bank deposit interest: not taxable to a nonresident alien (IRC 871(i)(2)(A)) - not reported"],
    ["1099-G box 2", "Illinois Department of Revenue", 310, "2024 state refund; 2024 Sch A (1040-NR) deducted IL tax - taxable, Sch 1 line 1"],
    ["1098-T box 1", "Central Texas Institute of Technology", 4000, "No education credit: nonresident alien filing MFS"],
  ];
  for (const r of incomeRows) inc.addRow(r).getCell(3).numFmt = money;
  // Tratado
  const tr = wb.addWorksheet("Treaty");
  header(tr, "Income tax treaty - Schedule OI item L", "Tax year 2025");
  tr.addRow(["Country", "Article", "Months claimed in prior years", "Exempt amount"]).font = { bold: true };
  tr.addRow(["China", "20(c) - student/trainee personal services", 41, 5000]).getCell(4).numFmt = money;
  tr.addRow(["Note: first treaty year 08/2021; 5 + 12 + 12 + 12 = 41 months through 12/2024."]);
  // Deducciones
  const de = wb.addWorksheet("Itemized deductions");
  header(de, "Schedule A (Form 1040-NR)", "Tax year 2025");
  de.addRow(["Item", "", "Amount"]).font = { bold: true };
  de.addRow(["State and local income taxes (Texas - none)", "", 0]).getCell(3).numFmt = money;
  de.addRow(["Gifts to U.S. charities (cash)", "", 250]).getCell(3).numFmt = money;
  const deTotal = de.addRow(["Total itemized deductions - line 12", "", { formula: "C6+C7", result: 250 }]);
  deTotal.font = { bold: true };
  deTotal.getCell(3).numFmt = money;
  de.addRow(["Standard deduction not allowed: resident of China (only students/apprentices from India)."]);
  // Pagos
  const pa = wb.addWorksheet("Withholding and payments");
  header(pa, "Withholding and payments", "Tax year 2025");
  pa.addRow(["Item", "Source", "Amount", "Line"]).font = { bold: true };
  pa.addRow(["W-2 federal withholding", "W-2 box 2", 5400, "25a"]).getCell(3).numFmt = money;
  pa.addRow(["1042-S withholding credit", "1042-S box 10", 300, "25g"]).getCell(3).numFmt = money;
  pa.addRow(["2024 overpayment applied to 2025", "2024 1040-NR line 36", 600, "26"]).getCell(3).numFmt = money;
  const paTotal = pa.addRow(["Total payments", "", { formula: "C6+C7+C8", result: 6300 }, "33"]);
  paTotal.font = { bold: true };
  paTotal.getCell(3).numFmt = money;
  // Dias
  const da = wb.addWorksheet("Days in US");
  header(da, "Substantial presence test", "Tax year 2025");
  da.addRow(["Year", "Days present", "Multiplier", "Days counted"]).font = { bold: true };
  da.addRow([2025, 331, 1, { formula: "B6*C6", result: 331 }]);
  da.addRow([2024, 350, 1 / 3, { formula: "B7*C7", result: 116.67 }]);
  da.addRow([2023, 345, 1 / 6, { formula: "B8*C8", result: 57.5 }]);
  da.addRow(["Total", "", "", { formula: "SUM(D6:D8)", result: 505.17 }]).font = { bold: true };
  da.addRow(["Exempt individual: F-1 since 08/2021 (2025 is the 5th calendar year). Days excluded with Form 8843 - attach to the return."]);
  da.addRow(["Result: nonresident alien for 2025 - Form 1040-NR."]);
  // Arrastres
  const ca = wb.addWorksheet("Carryovers from 2024");
  header(ca, "Items carried from the 2024 return", "Tax year 2025");
  ca.addRow(["Item", "2024 source", "Amount", "2025 treatment"]).font = { bold: true };
  ca.addRow(["Overpayment applied to 2025 estimated tax", "2024 1040-NR line 36", 600, "Line 26"]).getCell(3).numFmt = money;
  ca.addRow(["Illinois income tax deducted in 2024", "2024 Sch A (1040-NR) line 1a", 1450, "2025 refund of 310 is taxable - Sch 1 line 1"]).getCell(3).numFmt = money;
  ca.addRow(["Form 8843 filed with the 2024 return", "2024 return", "", "File again for 2025"]);
  ca.addRow(["Treaty months claimed", "2024 Sch OI item L(c): 29", 41, "2025 Sch OI item L(c)"]);
  // Resumen contra la declaracion (como la hoja de conciliacion de los workpapers del estudio)
  const su = wb.addWorksheet("Return summary");
  header(su, "Form 1040-NR - amounts per workpaper", "Tax year 2025");
  su.addRow(["", "Line", "Description", "Amount", "Source"]).font = { bold: true };
  const rows = [
    ["1a", "Wages (W-2 box 1 less treaty exemption)", { formula: "'Income documents'!C6-Treaty!D6", result: 47000 }, "W-2 / Treaty"],
    ["1k", "Income exempt by treaty (Schedule OI item L)", { formula: "Treaty!D6", result: 5000 }, "Treaty"],
    ["2b", "Taxable interest", 0, "Bank interest not taxable to a nonresident"],
    ["8", "Schedule 1 - taxable state refund", { formula: "'Income documents'!C12", result: 310 }, "1099-G"],
    ["9", "Total effectively connected income", { formula: "D6+D8+D9", result: 47310 }, ""],
    ["12", "Itemized deductions (Schedule A (Form 1040-NR))", { formula: "'Itemized deductions'!C8", result: 250 }, "Sch A NR"],
    ["15", "Taxable income", { formula: "D10-D11", result: 47060 }, ""],
    ["19", "Child tax credit", 0, "Not allowed: resident of China"],
    ["20", "Education credits", 0, "Not allowed: nonresident alien / MFS"],
    ["23a", "Tax on income not effectively connected (Schedule NEC)", { formula: "'Income documents'!C9*10%", result: 300 }, "1042-S"],
    ["25a", "Federal withholding W-2", { formula: "'Withholding and payments'!C6", result: 5400 }, "W-2"],
    ["25g", "Withholding on Forms 1042-S", { formula: "'Withholding and payments'!C7", result: 300 }, "1042-S"],
    ["26", "2024 overpayment applied", { formula: "'Withholding and payments'!C8", result: 600 }, "2024 return"],
    ["33", "Total payments", { formula: "'Withholding and payments'!C9", result: 6300 }, ""],
  ];
  for (const [line, desc, amount, source] of rows) su.addRow(["", line, desc, amount, source]).getCell(4).numFmt = money;
  for (const ws of wb.worksheets) {
    ws.columns.forEach((c, i) => { c.width = [32, 34, 16, 70, 30][i] || 16; });
  }
  // La hoja resumen primero, como en los workpapers del estudio.
  wb.worksheets.forEach((ws, i) => { ws.orderNo = ws.name === "Return summary" ? -1 : i; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = {
  id: "1040-nr",
  titulo: "1040-NR — estudiante F-1 de China en OPT (Texas)",
  returnType: "1040-NR",
  taxYear: "2025",
  async archivos() {
    return [
      { name: "LIN, JUN HAO TY 2025 return.pdf", role: "current_return", pdf: buildPdf(current) },
      { name: "Jun Hao Lin - 2024 Tax Returns.pdf", role: "prior_return", pdf: buildPdf(prior) },
      { name: "Documents-2026_10_15.zip", role: "supporting_document", zip: Object.fromEntries(Object.entries(docs).map(([n, b]) => [`Documents/${n}`, b])) },
      { name: "Lin, Jun Hao - 2025 1040-NR workpaper.xlsx", role: "supporting_document", xlsx: await workpaper() },
    ];
  },
  esperado: { estadoCivil: "Married filing separately", tasaMarginal: 0.12 },
  clave: [
    { id: "E1", error: "Deduccion estandar (15,750) para un residente de China", codigo: /standard deduction claimed by a resident/i },
    { id: "E2", error: "Credito por hijos (2,200) para un residente de China", codigo: /dependent credit claimed by a resident/i },
    { id: "E3", error: "Credito de educacion (Form 8863) para un no residente", codigo: /Form 8863 — education credit/i },
    { id: "E4", error: "Seguridad social retenida a un F-1 en OPT (3,224)", codigo: /social security tax withheld from a nonresident/i },
    { id: "E5", error: "Renglon 1k (6,000) distinto del Schedule OI (5,000)", codigo: /line 1k — treaty-exempt income/i, tieout: "form1040-nrl1k" },
    { id: "E6", error: "Falta el Form 8843 (estaba en 2024)", codigo: /no Form 8843 to exclude the days/i },
    { id: "E7", error: "Renglon 24 mal sumado (1,242 en vez de 742)", codigo: /line 24 — amount does not follow/i },
    { id: "E8", error: "Sueldos del renglon 1a (46,000 en vez de 47,000)", codigo: /line 1a — W-2 wages exceed the return/i, tieout: "form1040-nrl1a" },
    { id: "E9", error: "Interes bancario gravado (420) a un no residente", codigo: /bank deposit interest reported as taxable/i },
    { id: "E10", error: "Falta la retencion del 1042-S en el 25g (300)", codigo: /line 25g — withholding on the Forms 1042-S/i, tieout: "form1040-nrl25g" },
    { id: "E11", error: "Falta el reintegro de Illinois (310) deducido en 2024", codigo: /state refund deducted last year/i },
    { id: "E12", error: "Falta el sobrepago de 2024 aplicado (600) en el 26", codigo: /line 26 — last year's overpayment not applied/i },
    { id: "E13", error: "Schedule OI item I dice que no presento antes", codigo: /item I — answers that no prior/i },
    { id: "E14", error: "Meses del tratado en 0 (2024 decia 29)", codigo: /item L\(c\) — treaty months/i },
  ],
  tolerados: [],
};
