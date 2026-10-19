"use strict";

/**
 * Caso del banco: 1120 de una C corp de servicios de automatizacion.
 * Empresa, funcionarios y cifras inventados. La 2025 trae errores plantados en el impuesto del
 * Schedule J, el sobrepago y los anticipos del año anterior, la perdida operativa, el M-1, el M-2,
 * el 1125-E y la suma de deducciones; la 2024 esta bien.
 */

const ExcelJS = require("exceljs");
const { Form, buildPdf, m, summaryPages } = require("../comun.cjs");

const NAME = "NORTHGATE AUTOMATION INC";
const EIN = "99-5678123";

function form1120(year, v) {
  const f = new Form(`Form 1120 (${year})`);
  f.line("Department of the Treasury - Internal Revenue Service", { size: 7 });
  f.title(`Form 1120 U.S. Corporation Income Tax Return ${year} OMB No. 1545-0123`);
  f.line(`For calendar year ${year} or tax year beginning , ${year}, ending , 20`, { size: 7 });
  f.line(`Name ${NAME} B Employer identification number ${EIN}`);
  f.line("Number, street, and room or suite no. 900 INDUSTRIAL PKWY C Date incorporated 06/15/2012");
  f.line(`City or town, state or province, country, and ZIP or foreign postal code COLUMBUS, OH 43219 D Total assets (see instructions) $ ${m(v.balance.find((r) => r[0] === "15")[3])}`);
  f.line("E Check if: (1) Initial return (2) Final return (3) Name change (4) Address change");
  f.rule();
  f.row("1a", "Gross receipts or sales", "1a", m(v.receipts));
  f.row("c", "Balance. Subtract line 1b from line 1a", "1c", m(v.receipts));
  f.row("2", "Cost of goods sold (attach Form 1125-A)", "2");
  f.row("3", "Gross profit. Subtract line 2 from line 1c", "3", m(v.receipts));
  f.row("4", "Dividends and inclusions (Schedule C, line 23)", "4");
  f.row("5", "Interest", "5", m(v.interestIncome));
  f.row("11", "Total income. Add lines 3 through 10", "11", m(v.receipts + v.interestIncome));
  const d = v.deductions;
  f.row("12", "Compensation of officers (see instructions-attach Form 1125-E)", "12", m(d.officers));
  f.row("13", "Salaries and wages (less employment credits)", "13", m(d.salaries));
  f.row("14", "Repairs and maintenance", "14");
  f.row("15", "Bad debts", "15");
  f.row("16", "Rents", "16", m(d.rents));
  f.row("17", "Taxes and licenses", "17", m(d.taxes));
  f.row("18", "Interest (see instructions)", "18", m(d.interest));
  f.row("19", "Charitable contributions", "19", m(d.charity));
  f.row("20", "Depreciation from Form 4562 not claimed on Form 1125-A or elsewhere on return (attach Form 4562)", "20", m(d.depreciation));
  f.row("21", "Depletion", "21");
  f.row("22", "Advertising", "22", m(d.advertising));
  f.row("23", "Pension, profit-sharing, etc., plans", "23");
  f.row("24", "Employee benefit programs", "24");
  f.row("25", "Energy efficient commercial buildings deduction (attach Form 7205)", "25");
  f.row("26", "Other deductions (attach statement)", "26", m(d.other));
  f.row("27", "Total deductions. Add lines 12 through 26", "27", m(v.totalDeductions));
  f.row("28", "Taxable income before net operating loss deduction and special deductions. Subtract line 27 from line 11", "28", m(v.line28));
  f.row("29a", "Net operating loss deduction (see instructions)", "29a", m(v.nolDeduction));
  f.row("b", "Special deductions (Schedule C, line 24)", "29b");
  f.row("c", "Add lines 29a and 29b", "29c", m(v.nolDeduction));
  f.row("30", "Taxable income. Subtract line 29c from line 28. See instructions", "30", m(v.line28 - v.nolDeduction));
  f.row("31", "Total tax (Schedule J, Part I, line 11)", "31", m(v.tax));
  f.row("33", "Total payments and credits (Schedule J, Part III, line 23)", "33", m(v.payments));
  f.row("35", "Amount owed. If line 33 is smaller than the total of lines 31 and 34, enter amount owed", "35", m(v.owed));
  f.row("35b", "Overpayment. If line 33 is larger than the total of lines 31 and 34, enter amount overpaid", "", m(v.overpaid));
  f.line(`36 Enter amount from line 35 you want: Credited to ${year + 1} estimated tax ${m(v.credited) || "0."} Refunded ${m(v.refunded) || "0."}`);
  f.newPage();
  f.line(`Form 1120 (${year}) ${NAME} ${EIN} Page 3`, { bold: true });
  f.title("Schedule J Tax Computation and Payment (see instructions)", 9);
  f.line("Part I-Tax Computation", { bold: true });
  f.row("1", "Income tax. See instructions", "", m(v.incomeTax));
  f.row("11", "Total tax. Add lines 7 through 10. Enter here and on page 1, line 31", "11", m(v.tax));
  f.line("Part III-Payments and Refundable Credits", { bold: true });
  f.row("13", "Preceding year's overpayment credited to the current year", "13", m(v.priorCredited));
  f.row("14", "Current year's estimated tax payments", "14", m(v.estimates));
  f.row("23", "Total payments and credits. Add lines 19 through 22", "23", m(v.payments));
  f.title("Schedule K Other Information (see instructions)", 9);
  f.line(`12 Enter the available NOL carryover from prior tax years (do not reduce it by any deduction reported on line 29a.) . . . . $ ${m(v.nolAvailable)}`);
  f.newPage();
  f.line(`Form 1120 (${year}) ${NAME} ${EIN} Page 6`, { bold: true });
  f.title("Schedule L Balance Sheets per Books Beginning of tax year End of tax year", 9);
  for (const [n, label, a, b] of v.balance) f.row(n, label, "", `${m(a)} ${m(b)}`.trim());
  f.title("Schedule M-1 Reconciliation of Income (Loss) per Books With Income per Return", 9);
  f.row("1", "Net income (loss) per books", "", m(v.books));
  f.row("2", "Federal income tax per books", "", m(v.tax));
  f.row("5", "Expenses recorded on books this year not deducted on this return (itemize): Travel and entertainment $ 4,000", "", m(4000));
  f.row("6", "Add lines 1 through 5", "", m(v.books + v.tax + 4000));
  f.row("9", "Add lines 7 and 8", "", "");
  f.row("10", "Income (page 1, line 28)-line 6 less line 9", "", m(v.m1Closing));
  f.title("Schedule M-2 Analysis of Unappropriated Retained Earnings per Books (Schedule L, Line 25)", 9);
  f.row("1", "Balance at beginning of year", "", m(v.m2Begin));
  f.row("2", "Net income (loss) per books", "", m(v.books));
  f.row("4", "Add lines 1, 2, and 3", "", m(v.m2Begin + v.books));
  f.row("5", "Distributions: a Cash", "", m(v.dividends));
  f.row("7", "Add lines 5 and 6", "", m(v.dividends));
  f.row("8", "Balance at end of year (line 4 less line 7)", "", m(v.m2Begin + v.books - v.dividends));
  f.newPage();
  f.title(`Form 1125-E Compensation of Officers ${year}`);
  f.line(`Name ${NAME} Employer identification number ${EIN}`, { size: 7 });
  f.line(`RAYMOND T OKAFOR 000-56-7891 100% 70% ${m(v.officers1125E * 0.7)}`);
  f.line(`DIANA S MERCER 000-56-7802 100% 30% ${m(v.officers1125E * 0.3)}`);
  f.row("2", "Total compensation of officers", "2", m(v.officers1125E));
  f.row("3", "Compensation of officers claimed on Form 1125-A or elsewhere on return", "3");
  f.row("4", "Subtract line 3 from line 2. Enter the result here and on Form 1120, page 1, line 12 or the appropriate line of your tax return", "4", m(v.officers1125E));
  return f.done();
}

const bal = (assets, re, ap) => [
  ["1", "Cash", assets[0] - 400000, assets[1] - 420000],
  ["2a", "Trade notes and accounts receivable", 250000, 260000],
  ["10a", "Buildings and other depreciable assets less accumulated depreciation", 150000, 160000],
  ["15", "Total assets", assets[0], assets[1]],
  ["16", "Accounts payable", ap[0], ap[1]],
  ["22", "Capital stock: b Common stock", 10000, 10000],
  ["25", "Retained earnings-Unappropriated", re[0], re[1]],
  ["28", "Total liabilities and shareholders' equity", assets[0], assets[1]],
];

// 2025: impuesto 21,000 sobre 110,000 (E1); el 13 vacio con 4,000 acreditados en 2024 (E2); NOL
// disponible 50,000 contra 60,000 (E3); M-2 cierra en 158,000 y el Schedule L en 150,000 (E4);
// M-1 cierra en 112,000 y el renglon 28 es 113,000 (E5); deducciones con 1,000 de menos (E6);
// 1125-E 125,000 contra 120,000 (E7); anticipos PAID por 12,000 y el 14 dice 6,000 (E8).
const d25 = { officers: 120000, salaries: 380000, rents: 60000, taxes: 40000, interest: 8000, charity: 15000, depreciation: 30000, advertising: 25000, other: 112000 };
const v25 = {
  receipts: 900000, interestIncome: 2000, deductions: d25, totalDeductions: 789000, line28: 113000, nolDeduction: 3000,
  incomeTax: 21000, tax: 21000, priorCredited: "", estimates: 6000, payments: 6000, owed: 15000, overpaid: "", credited: "", refunded: "",
  nolAvailable: 50000, balance: bal([600000, 680000], [120000, 150000], [470000, 520000]), books: 88000, m1Closing: 112000, m2Begin: 120000, dividends: 50000,
  officers1125E: 125000,
};
const d24 = { officers: 110000, salaries: 350000, rents: 58000, taxes: 37000, interest: 9000, charity: 3000, depreciation: 28000, advertising: 22000, other: 98000 };
const v24 = {
  receipts: 740000, interestIncome: 1000, deductions: d24, totalDeductions: 715000, line28: 26000, nolDeduction: 20000,
  incomeTax: 1260, tax: 1260, priorCredited: "", estimates: 4000, payments: 6760, owed: "", overpaid: 5500, credited: 4000, refunded: 1500,
  nolAvailable: 80000, balance: bal([560000, 600000], [104000, 120000], [446000, 470000]), books: 20000, m1Closing: 26000, m2Begin: 104000, dividends: 4000,
  officers1125E: 110000,
};

const header = `${NAME} ${EIN}`;
const current = () => [
  ...summaryPages(2025, header, [["TAXABLE INCOME", "110,000"], ["TOTAL TAX", "21,000"], ["TOTAL PAYMENTS", "6,000"], ["BALANCE DUE", "15,000"]], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 1120, 1125-E, 4562, 7004, 8879-C",
    "OHIO: CAT",
  ]),
  ...form1120(2025, v25),
];
const prior = () => [
  ...summaryPages(2024, header, [["TAXABLE INCOME", "6,000"], ["TOTAL TAX", "1,260"], ["OVERPAYMENT CREDITED TO 2025", "4,000"]], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 1120, 1125-E, 4562, 7004, 8879-C",
    "OHIO: CAT",
    "ESTIMATES",
    "FEDERAL ESTIMATES",
    "4/15/25 3,000. 0. 3,000. PAID",
    "6/16/25 3,000. 0. 3,000. PAID",
    "9/15/25 3,000. 0. 3,000. PAID",
    "12/15/25 3,000. 0. 3,000. PAID",
    "TOTAL $ 12,000. $ 0. $ 12,000.",
  ]),
  ...form1120(2024, v24),
];

async function workpaper() {
  const wb = new ExcelJS.Workbook();
  const money = "#,##0.00;(#,##0.00)";
  const head = (ws, title, period) => { ws.addRow(["Northgate Automation Inc"]).font = { bold: true, size: 12 }; ws.addRow([title]).font = { bold: true }; ws.addRow([period]); ws.addRow([]); };
  const rec = wb.addWorksheet("Book to tax reconciliation");
  head(rec, "Book to tax reconciliation", "12/31/25");
  for (const [label, amount] of [["Net income as per book", 88000], ["Add: Federal income tax per books", 21000], ["Add: Meals (50%)", 4000], ["Total income as per tax return", 113000]]) rec.addRow(["", "", label, amount]).getCell(4).numFmt = money;
  const pl = wb.addWorksheet("PnL");
  head(pl, "Profit and Loss", "January-December, 2025");
  for (const [label, amount] of [
    ["Automation services", 900000], ["Officer salaries", 125000], ["Salaries & wages", 380000], ["Rent", 60000], ["Payroll taxes", 40000], ["Interest expense", 8000],
    ["Charitable contributions", 15000], ["Depreciation", 30000], ["Advertising", 25000], ["Meals", 8000], ["IRS penalties", 2500], ["Other expenses", 97500],
    ["Interest income", 2000], ["Federal income tax", 21000], ["Net income", 88000],
  ]) pl.addRow([label, amount]).getCell(2).numFmt = money;
  const pay = wb.addWorksheet("Tax payments");
  head(pay, "Federal estimated payments 2025", "Tax year 2025");
  for (const [date, amount] of [["04/15/2025", 3000], ["06/16/2025", 3000], ["09/15/2025", 3000], ["12/15/2025", 3000], ["Overpayment from 2024", 4000], ["Total", 16000]]) pay.addRow([date, amount]).getCell(2).numFmt = money;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = {
  id: "1120",
  titulo: "1120 — C corp de automatizacion (Ohio)",
  returnType: "1120",
  taxYear: "2025",
  async archivos() {
    return [
      { name: "Northgate Automation Inc 2025 return.pdf", role: "current_return", pdf: buildPdf(current()) },
      { name: "Northgate Automation Inc - 2024 Tax Returns.pdf", role: "prior_return", pdf: buildPdf(prior()) },
      { name: "Northgate Automation Inc_Tax return workpaper-2025.xlsx", role: "supporting_document", xlsx: await workpaper() },
    ];
  },
  esperado: { tasaMarginal: 0.21 },
  clave: [
    { id: "E1", error: "Schedule J: impuesto 21,000 sobre 110,000 (21% = 23,100)", codigo: /income tax is not 21% of taxable income/i },
    { id: "E2", error: "Sobrepago de 2024 acreditado (4,000) que no aparece en Schedule J linea 13", codigo: /last year's overpayment not credited/i },
    { id: "E3", error: "NOL disponible 50,000; deberia ser 60,000 (80,000 menos 20,000 usados)", codigo: /available NOL does not roll forward/i },
    { id: "E4", error: "M-2 cierra en 158,000 y el Schedule L (renglon 25) en 150,000", codigo: /Schedule M-2 — ending balance differs from the balance sheet/i },
    { id: "E5", error: "M-1 cierra en 112,000 y el renglon 28 es 113,000", codigo: /Schedule M-1 — does not close/i },
    { id: "E6", error: "Renglon 27 mal sumado (789,000 en vez de 790,000)", codigo: /line 27 — amount does not follow/i },
    { id: "E7", error: "Form 1125-E (125,000) distinto de la pagina 1 linea 12 (120,000)", codigo: /Form 1125-E — total differs/i },
    { id: "E8", error: "Anticipos de 2025 pagados por 12,000 y Schedule J linea 14 dice 6,000", codigo: /Prepayments made for this year are not credited/i },
    { id: "E9", error: "Multas del IRS (2,500) deducidas en otras deducciones", codigo: null },
    { id: "E10", error: "Donaciones (15,000) por encima del 10% del ingreso gravable", codigo: null },
  ],
  tolerados: [],
};
