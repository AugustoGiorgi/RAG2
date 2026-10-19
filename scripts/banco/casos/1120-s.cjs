"use strict";

/**
 * Caso del banco: 1120-S de un estudio de diseño con dos accionistas (60% y 40%).
 * Empresa, accionistas y cifras inventados. La 2025 trae errores plantados en el balance, el
 * M-1, el M-2, el 1125-E, la suma de deducciones y un formulario que arrastra algo y desaparece;
 * la 2024 esta bien.
 */

const ExcelJS = require("exceljs");
const { Form, buildPdf, m, summaryPages } = require("../comun.cjs");

const NAME = "HARBORVIEW DESIGN GROUP INC";
const EIN = "99-3456781";
const HOLDERS = [
  { name: "ELENA M CRUZ", ssn: "000-34-5671", pct: 60 },
  { name: "PETER J WALSH", ssn: "000-34-5682", pct: 40 },
];

function form1120S(year, v) {
  const f = new Form(`Form 1120-S (${year})`);
  f.line("Department of the Treasury - Internal Revenue Service", { size: 7 });
  f.title(`Form 1120-S U.S. Income Tax Return for an S Corporation ${year} OMB No. 1545-0123`);
  f.line(`For calendar year ${year} or tax year beginning , ${year}, ending , 20`, { size: 7 });
  f.line(`A S election effective date 01/01/2018 Name ${NAME} D Employer identification number ${EIN}`);
  f.line("B Business activity code number 541430 Number, street, and room or suite no. 75 HARBOR ST STE 300 E Date incorporated 12/04/2017");
  f.line(`City or town, state or province, country, and ZIP or foreign postal code BOSTON, MA 02210 F Total assets (see instructions) $ ${m(v.assetsEnd)}`);
  f.line("H Check if: (1) Final return (2) Name change (3) Address change (4) Amended return (5) S election termination");
  f.line("I Enter the number of shareholders who were shareholders during any part of the tax year . . . . . . 2");
  f.rule();
  f.row("1a", "Gross receipts or sales", "1a", m(v.receipts));
  f.row("b", "Returns and allowances", "1b");
  f.row("c", "Balance. Subtract line 1b from line 1a", "1c", m(v.receipts));
  f.row("2", "Cost of goods sold (attach Form 1125-A)", "2");
  f.row("3", "Gross profit. Subtract line 2 from line 1c", "3", m(v.receipts));
  f.row("4", "Net gain (loss) from Form 4797, line 17 (attach Form 4797)", "4");
  f.row("5", "Other income (loss) (see instructions-attach statement)", "5");
  f.row("6", "Total income (loss). Add lines 3 through 5", "6", m(v.receipts));
  const d = v.deductions;
  f.row("7", "Compensation of officers (see instructions-attach Form 1125-E)", "7", m(d.officers));
  f.row("8", "Salaries and wages (less employment credits)", "8", m(d.salaries));
  f.row("9", "Repairs and maintenance", "9");
  f.row("10", "Bad debts", "10");
  f.row("11", "Rents", "11", m(d.rents));
  f.row("12", "Taxes and licenses", "12", m(d.taxes));
  f.row("13", "Interest (see instructions)", "13", m(d.interest));
  f.row("14", "Depreciation not claimed on Form 1125-A or elsewhere on return (attach Form 4562)", "14", m(d.depreciation));
  f.row("15", "Depletion (Do not deduct oil and gas depletion.)", "15");
  f.row("16", "Advertising", "16", m(d.advertising));
  f.row("17", "Pension, profit-sharing, etc., plans", "17");
  f.row("18", "Employee benefit programs", "18", m(d.benefits));
  f.row("19", "Energy efficient commercial buildings deduction (attach Form 7205)", "19");
  f.row("20", "Other deductions (attach statement)", "20", m(d.other));
  f.row("21", "Total deductions. Add lines 7 through 20", "21", m(v.totalDeductions));
  f.row("22", "Ordinary business income (loss). Subtract line 21 from line 6", "22", m(v.ordinary));
  f.newPage();
  f.line(`Form 1120-S (${year}) ${NAME} ${EIN} Page 3`, { bold: true });
  f.title("Schedule K Shareholders' Pro Rata Share Items Total amount", 9);
  f.row("1", "Ordinary business income (loss) (page 1, line 22)", "1", m(v.ordinary));
  f.row("4", "Interest income", "4", m(v.interestIncome));
  f.row("16c", "Nondeductible expenses", "16c", m(v.nondeductible));
  f.row("d", "Distributions (attach statement if required) (see instructions)", "16d", m(v.distributions));
  f.row("18", ["Income (loss) reconciliation. Combine the amounts on lines 1 through 10 in the far right column. From the result,", "subtract the sum of the amounts on lines 11 through 12e and 16f"], "18", m(v.ordinary + v.interestIncome));
  f.newPage();
  f.line(`Form 1120-S (${year}) ${NAME} ${EIN} Page 4`, { bold: true });
  f.title("Schedule L Balance Sheets per Books Beginning of tax year End of tax year", 9);
  for (const [n, label, a, b] of v.balance) f.row(n, label, "", `${m(a)} ${m(b)}`.trim());
  f.title("Schedule M-1 Reconciliation of Income (Loss) per Books With Income (Loss) per Return", 9);
  f.row("1", "Net income (loss) per books", "", m(v.m1.books));
  f.row("3", "Expenses recorded on books this year not included on Schedule K, lines 1 through 12 and 16f (itemize): a Depreciation $ b Travel and entertainment $ 2,400", "", m(v.m1.expenses));
  f.row("4", "Add lines 1 through 3", "", m(v.m1.books + v.m1.expenses));
  f.row("7", "Add lines 5 and 6", "", "");
  f.row("8", "Income (loss) (Schedule K, line 18). Subtract line 7 from line 4", "", m(v.m1.closing));
  f.title("Schedule M-2 Analysis of Accumulated Adjustments Account, Shareholders' Undistributed Taxable Income Previously Taxed, Accumulated Earnings and Profits, and Other Adjustments Account", 8);
  f.line("(a) Accumulated adjustments account (b) Shareholders' undistributed taxable income previously taxed (c) Accumulated earnings and profits (d) Other adjustments account", { size: 7 });
  f.row("1", "Balance at beginning of tax year", "", m(v.m2.begin));
  f.row("2", "Ordinary income from page 1, line 22", "", m(v.ordinary));
  f.row("3", "Other additions", "", m(v.interestIncome));
  f.row("5", "Other reductions", "", m(-v.nondeductible));
  f.row("6", "Combine lines 1 through 5", "", m(v.m2.begin + v.ordinary + v.interestIncome - v.nondeductible));
  f.row("7", "Distributions", "", m(v.distributions));
  f.row("8", "Balance at end of tax year. Subtract line 7 from line 6", "", m(v.m2.begin + v.ordinary + v.interestIncome - v.nondeductible - v.distributions));
  f.newPage();
  f.title(`Form 1125-E Compensation of Officers ${year}`);
  f.line(`Name ${NAME} Employer identification number ${EIN}`, { size: 7 });
  f.line("(a) Name of officer (b) Social security number (c) Percent of time devoted to business (d) Common stock percent owned (f) Amount of compensation", { size: 7 });
  for (const h of HOLDERS) f.line(`${h.name} ${h.ssn} 100% ${h.pct}% ${m(v.officers1125E * h.pct / 100)}`);
  f.row("2", "Total compensation of officers", "2", m(v.officers1125E));
  f.row("3", "Compensation of officers claimed on Form 1125-A or elsewhere on return", "3");
  f.row("4", "Subtract line 3 from line 2. Enter the result here and on Form 1120, page 1, line 12 or the appropriate line of your tax return", "4", m(v.officers1125E));
  return f.done();
}

function k1s(year, v) {
  const out = [];
  for (const h of HOLDERS) {
    const f = new Form(`Schedule K-1 (Form 1120-S) ${year}`);
    f.line("671121 Final K-1 Amended K-1 OMB No. 1545-0123");
    f.title(`Schedule K-1 (Form 1120-S) ${year} Shareholder's Share of Income, Deductions, Credits, and Other Items`, 9);
    f.line(`A Corporation's employer identification number ${EIN}`);
    f.line(`B Corporation's name, address, city, state, and ZIP code ${NAME}, 75 HARBOR ST STE 300, BOSTON, MA 02210`);
    f.line(`E Shareholder's identifying number ${h.ssn}`);
    f.line(`F1 Shareholder's name, address, city, state, and ZIP code ${h.name}`);
    f.line(`G Current year allocation percentage ${h.pct.toFixed(6)} %`);
    f.row("1", "Ordinary business income (loss)", "1", m(Math.round(v.ordinary * h.pct / 100)));
    f.row("16", `D Distributions ${m(Math.round(v.distributions * h.pct / 100))}`, "", "");
    out.push(...f.done());
  }
  return out;
}

const balance25 = [
  ["1", "Cash", 96000, 128000],
  ["2a", "Trade notes and accounts receivable", 84000, 101000],
  ["10a", "Buildings and other depreciable assets less accumulated depreciation", 180000, 168000],
  ["14", "Other assets (attach statement)", 50000, 55000],
  ["15", "Total assets", 410000, 452000],
  ["16", "Accounts payable", 41000, 47000],
  ["17", "Mortgages, notes, bonds payable in less than 1 year", 30000, 28000],
  ["20", "Mortgages, notes, bonds payable in 1 year or more", 210000, 196000],
  ["22", "Capital stock", 1000, 1000],
  ["24", "Retained earnings", 128000, 177000],
  ["27", "Total liabilities and shareholders' equity", 410000, 449000],
];
const balance24 = [
  ["1", "Cash", 70000, 91000],
  ["2a", "Trade notes and accounts receivable", 76000, 84000],
  ["10a", "Buildings and other depreciable assets less accumulated depreciation", 192000, 180000],
  ["14", "Other assets (attach statement)", 48000, 50000],
  ["15", "Total assets", 386000, 405000],
  ["16", "Accounts payable", 38000, 41000],
  ["17", "Mortgages, notes, bonds payable in less than 1 year", 32000, 30000],
  ["20", "Mortgages, notes, bonds payable in 1 year or more", 222000, 210000],
  ["22", "Capital stock", 1000, 1000],
  ["24", "Retained earnings", 93000, 123000],
  ["27", "Total liabilities and shareholders' equity", 386000, 405000],
];

// 2025: suma de deducciones con 1,000 de mas (E4); 1125-E 95,000 contra 90,000 en la pagina 1 (E3).
const d25 = { officers: 90000, salaries: 310000, rents: 72000, taxes: 34000, interest: 14000, depreciation: 12000, advertising: 18000, benefits: 26000, other: 64000 };
const v25 = {
  receipts: 820000, deductions: d25, totalDeductions: 641000, ordinary: 179000, interestIncome: 1500, nondeductible: 2400, distributions: 120000,
  assetsEnd: 452000, balance: balance25, officers1125E: 95000,
  m1: { books: 177500, expenses: 2400, closing: 182000 }, // E5: cierra en 182,000 y la linea 18 es 180,500
  m2: { begin: 115000 }, // E6: el AAA de 2024 cerro en 120,000
};
const d24 = { officers: 90000, salaries: 296000, rents: 70000, taxes: 32000, interest: 15000, depreciation: 12000, advertising: 16000, benefits: 24000, other: 60000 };
const v24 = {
  receipts: 760000, deductions: d24, totalDeductions: 615000, ordinary: 145000, interestIncome: 1200, nondeductible: 2200, distributions: 109000,
  assetsEnd: 405000, balance: balance24, officers1125E: 90000,
  m1: { books: 144000, expenses: 2200, closing: 146200 },
  m2: { begin: 85000 },
};

const header = `${NAME} ${EIN}`;
const current = () => [
  ...summaryPages(2025, header, [["ORDINARY BUSINESS INCOME", "179,000"], ["DISTRIBUTIONS", "120,000"], ["TOTAL ASSETS (END OF YEAR)", "452,000"]], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 1120-S, SCH B, SCH K-1, 1125-E, 4562, 7004, 8879-S",
    "MASSACHUSETTS: 355S, SCH SK-1",
  ]),
  ...form1120S(2025, v25),
  ...k1s(2025, v25),
];
const prior = () => [
  ...summaryPages(2024, header, [["ORDINARY BUSINESS INCOME", "145,000"], ["DISTRIBUTIONS", "109,000"], ["TOTAL ASSETS (END OF YEAR)", "405,000"]], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 1120-S, SCH B, SCH K-1, 1125-E, 4562, 8990, 7004, 8879-S",
    "MASSACHUSETTS: 355S, SCH SK-1",
    "CARRYOVERS TO 2025",
    "FEDERAL CARRYOVERS",
    "DISALLOWED BUSINESS INTEREST EXPENSE 6,500.",
  ]),
  ...form1120S(2024, v24),
  ...k1s(2024, v24),
];

async function workpaper() {
  const wb = new ExcelJS.Workbook();
  const money = "#,##0.00;(#,##0.00)";
  const head = (ws, title, period) => { ws.addRow(["Harborview Design Group Inc"]).font = { bold: true, size: 12 }; ws.addRow([title]).font = { bold: true }; ws.addRow([period]); ws.addRow([]); };
  const rec = wb.addWorksheet("Book to tax reconciliation");
  head(rec, "Book to tax reconciliation", "12/31/25");
  rec.addRow(["", "", "Net income as per book", 177500]).getCell(4).numFmt = money;
  rec.addRow(["", "", "Add: Meals and entertainment (50%)", 2400]).getCell(4).numFmt = money;
  rec.addRow(["", "", "Total income as per tax return", { formula: "D5+D6", result: 179900 }]).getCell(4).numFmt = money;
  const pl = wb.addWorksheet("PnL");
  head(pl, "Profit and Loss", "January-December, 2025");
  for (const [label, amount] of [
    ["Design services", 820000], ["Total income", 820000], ["Officer salaries", 90000], ["Salaries & wages", 310000], ["Rent", 72000], ["Payroll taxes", 34000],
    ["Interest expense", 14000], ["Depreciation", 12000], ["Advertising", 18000],
    ["Health insurance - officers (2% shareholders)", 14000], ["Health insurance - employees", 12000],
    ["Software and subscriptions", 36000], ["Professional fees", 20000], ["Meals", 4800], ["Office expenses", 6000],
    ["Interest income", 1500], ["Net income", 177500],
  ]) pl.addRow([label, amount]).getCell(2).numFmt = money;
  const bs = wb.addWorksheet("Balance Sheet");
  head(bs, "Balance Sheet", "As of Dec 31, 2025");
  for (const [label, amount] of [
    ["Cash - operating", 128000], ["Accounts receivable", 101000], ["Fixed assets net", 168000], ["Security deposits", 15000], ["Loan to shareholder - E. Cruz", 40000],
    ["Total assets", 452000], ["Accounts payable", 47000], ["Line of credit", 28000], ["Note payable - bank", 196000], ["Capital stock", 1000], ["Retained earnings", 180000], ["Total liabilities and equity", 452000],
  ]) bs.addRow([label, amount]).getCell(2).numFmt = money;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = {
  id: "1120-s",
  titulo: "1120-S — estudio de diseño con dos accionistas (Massachusetts)",
  returnType: "1120-S",
  taxYear: "2025",
  async archivos() {
    return [
      { name: "Harborview Design Group Inc 2025 return.pdf", role: "current_return", pdf: buildPdf(current()) },
      { name: "Harborview Design Group Inc - 2024 Tax Returns.pdf", role: "prior_return", pdf: buildPdf(prior()) },
      { name: "Harborview Design Group Inc_Tax return workpaper-2025.xlsx", role: "supporting_document", xlsx: await workpaper() },
    ];
  },
  esperado: {},
  clave: [
    { id: "E1", error: "Schedule L no balancea al cierre (452,000 contra 449,000)", codigo: /^Schedule L does not balance$/i },
    { id: "E2", error: "Schedule L abre en 410,000 y 2024 cerro en 405,000", codigo: /^Schedule L total assets does not open where/i },
    { id: "E3", error: "Form 1125-E (95,000) distinto de la pagina 1 linea 7 (90,000)", codigo: /Form 1125-E — total differs/i },
    { id: "E4", error: "Renglon 21 mal sumado (641,000 en vez de 640,000)", codigo: /line 21 — amount does not follow/i },
    { id: "E5", error: "M-1 cierra en 182,000 y Schedule K linea 18 es 180,500", codigo: /Schedule M-1 — does not close/i },
    { id: "E6", error: "M-2 abre el AAA en 115,000 y 2024 cerro en 120,000", codigo: /Schedule M-2 — does not open where last year closed/i },
    { id: "E7", error: "Form 8990 con interes no deducido arrastrado (6,500) desaparece", codigo: /Forms filed last year and missing this year/i },
    { id: "E8", error: "Seguro de salud de accionistas de 2% (14,000) como beneficio de empleados y no en el W-2", codigo: null },
    { id: "E9", error: "Prestamo al accionista (40,000) sin intereses ni documento", codigo: null },
    { id: "E10", error: "Retained earnings del libro (180,000) contra Schedule L (177,000)", codigo: null },
  ],
  tolerados: [
    // El mismo error de apertura visto desde el otro total del balance.
    /^Schedule L total liabilities and (?:capital|shareholders. equity) does not open where/i,
  ],
};
