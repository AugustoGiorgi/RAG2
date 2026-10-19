"use strict";

/**
 * Caso del banco: 1065 de una sociedad de servicios con tres socios.
 * Sociedad, socios y cifras inventados. La 2025 trae errores plantados en los pagos garantizados,
 * los porcentajes de los K-1, el M-1, el M-2 contra el balance, una suma y la continuidad del
 * balance; la 2024 esta bien.
 */

const ExcelJS = require("exceljs");
const { Form, buildPdf, m, summaryPages } = require("../comun.cjs");

const NAME = "CEDAR POINT ADVISORS LLC";
const EIN = "99-4567812";

function form1065(year, v) {
  const f = new Form(`Form 1065 (${year})`);
  f.line("Department of the Treasury - Internal Revenue Service", { size: 7 });
  f.title(`Form 1065 U.S. Return of Partnership Income ${year} OMB No. 1545-0123`);
  f.line(`For calendar year ${year}, or tax year beginning , ${year}, ending , 20`, { size: 7 });
  f.line(`A Principal business activity CONSULTING Name of partnership ${NAME} D Employer identification number ${EIN}`);
  f.line("B Principal product or service MANAGEMENT CONSULTING Number, street, and room or suite no. 410 RIVER RD STE 12 E Date business started 03/01/2016");
  f.line(`C Business code number 541610 City or town, state or province, country, and ZIP code AUSTIN, TX 78701 F Total assets $ ${m(v.balance.find((r) => r[0] === "14")[3])}`);
  f.line("G Check applicable boxes: (1) Initial return (2) Final return (3) Name change (4) Address change (5) Amended return");
  f.line("H Check accounting method: (1) X Cash (2) Accrual (3) Other (specify)");
  f.line(`I Number of Schedules K-1. Attach one for each person who was a partner at any time during the tax year . . . . . . ${v.partners.length}`);
  f.rule();
  f.row("1a", "Gross receipts or sales", "1a", m(v.receipts));
  f.row("c", "Balance. Subtract line 1b from line 1a", "1c", m(v.receipts));
  f.row("2", "Cost of goods sold (attach Form 1125-A)", "2");
  f.row("3", "Gross profit. Subtract line 2 from line 1c", "3", m(v.receipts));
  f.row("4", "Ordinary income (loss) from other partnerships, estates, and trusts (attach statement)", "4");
  f.row("5", "Net farm profit (loss) (attach Schedule F (Form 1040))", "5");
  f.row("6", "Net gain (loss) from Form 4797, Part II, line 17 (attach Form 4797)", "6");
  f.row("7", "Other income (loss) (attach statement)", "7", m(v.otherIncome));
  f.row("8", "Total income (loss). Combine lines 3 through 7", "8", m(v.totalIncome));
  const d = v.deductions;
  f.row("9", "Salaries and wages (other than to partners) (less employment credits)", "9", m(d.salaries));
  f.row("10", "Guaranteed payments to partners", "10", m(v.guaranteedPage1));
  f.row("11", "Repairs and maintenance", "11");
  f.row("12", "Bad debts", "12");
  f.row("13", "Rent", "13", m(d.rent));
  f.row("14", "Taxes and licenses", "14", m(d.taxes));
  f.row("15", "Interest (see instructions)", "15");
  f.row("16a", "Depreciation (if required, attach Form 4562)", "16a");
  f.row("17", "Depletion (Do not deduct oil and gas depletion.)", "17");
  f.row("18", "Retirement plans, etc", "18");
  f.row("19", "Employee benefit programs", "19", m(d.benefits));
  f.row("20", "Energy efficient commercial buildings deduction (attach Form 7205)", "20");
  f.row("21", "Other deductions (attach statement)", "21", m(d.other));
  f.row("22", "Total deductions. Add the amounts shown in the far right column for lines 9 through 21", "22", m(v.totalDeductions));
  f.row("23", "Ordinary business income (loss). Subtract line 22 from line 8", "23", m(v.ordinary));
  f.newPage();
  f.line(`Form 1065 (${year}) ${NAME} ${EIN} Page 3`, { bold: true });
  f.title("Schedule B Other Information (continued)", 9);
  f.line(`19 Did the partnership make any payments in ${year} that would require it to file Form(s) 1042 and 1042-S under chapter 3 (sections 1441 through 1464) or chapter 4? . . . Yes X No`, { size: 7 });
  f.line(`23 Did the partnership make any payments in ${year} that would require it to file Form(s) 1099? See instructions . . . X Yes No`, { size: 7 });
  f.line("If Yes, did the partnership file or will it file required Form(s) 1099? . . . X Yes No", { size: 7 });
  f.newPage();
  f.line(`Form 1065 (${year}) ${NAME} ${EIN} Page 4`, { bold: true });
  f.title("Schedule K Partners' Distributive Share Items Total amount", 9);
  f.row("1", "Ordinary business income (loss) (page 1, line 23)", "1", m(v.ordinary));
  f.row("4a", "Guaranteed payments for services", "4a", m(v.guaranteedK));
  f.row("c", "Total guaranteed payments. Add lines 4a and 4b", "4c", m(v.guaranteedK));
  f.row("19a", "Distributions of cash and marketable securities", "19a", m(v.distributions));
  f.newPage();
  f.line(`Form 1065 (${year}) ${NAME} ${EIN} Page 5`, { bold: true });
  f.title("Analysis of Net Income (Loss) per Return", 9);
  f.row("1", ["Net income (loss). Combine Schedule K, lines 1 through 11. From the result, subtract the sum of", "Schedule K, lines 12 through 13e, and 21"], "1", m(v.analysis));
  f.title("Schedule L Balance Sheets per Books Beginning of tax year End of tax year", 9);
  for (const [n, label, a, b] of v.balance) f.row(n, label, "", `${m(a)} ${m(b)}`.trim());
  f.title("Schedule M-1 Reconciliation of Income (Loss) per Books With Analysis of Net Income (Loss) per Return", 9);
  f.row("1", "Net income (loss) per books", "", m(v.m1.books));
  f.row("4", "Expenses recorded on books this year not included on Schedule K, lines 1 through 13e, and 21 (itemize): Meals 3,000", "", m(v.m1.expenses));
  f.row("5", "Add lines 1 through 4", "", m(v.m1.books + v.m1.expenses));
  f.row("8", "Add lines 6 and 7", "", "");
  f.row("9", "Income (loss) (Analysis of Net Income (Loss) per Return, line 1). Subtract line 8 from line 5", "", m(v.m1.closing));
  f.title("Schedule M-2 Analysis of Partners' Capital Accounts", 9);
  f.row("1", "Balance at beginning of year", "", m(v.m2.begin));
  f.row("3", "Net income (loss) (see instructions)", "", m(v.m1.books));
  f.row("5", "Add lines 1 through 4", "", m(v.m2.begin + v.m1.books));
  f.row("6", "Distributions: a Cash", "", m(v.distributions));
  f.row("8", "Add lines 6 and 7", "", m(v.distributions));
  f.row("9", "Balance at end of year. Subtract line 8 from line 5", "", m(v.m2.begin + v.m1.books - v.distributions));
  return f.done();
}

function k1s(year, v) {
  const out = [];
  for (const p of v.partners) {
    const f = new Form(`Schedule K-1 (Form 1065) ${year}`);
    f.line("651121 Final K-1 Amended K-1 OMB No. 1545-0123");
    f.title(`Schedule K-1 (Form 1065) ${year} Partner's Share of Income, Deductions, Credits, and Other Items`, 9);
    f.line(`A Partnership's employer identification number ${EIN}`);
    f.line(`B Partnership's name, address, city, state, and ZIP code ${NAME}, 410 RIVER RD STE 12, AUSTIN, TX 78701`);
    f.line(`E Partner's SSN or TIN (Do not use TIN of a disregarded entity. See instructions.) ${p.ssn}`);
    f.line(`F Name, address, city, state, and ZIP code for partner entered in E. See instructions. ${p.name}`);
    f.line("I1 What type of entity is this partner? INDIVIDUAL");
    f.line("J Partner's share of profit, loss, and capital (see instructions): Beginning Ending");
    f.line(`Profit ${p.pct.toFixed(6)} % ${p.pct.toFixed(6)} %`);
    f.line(`Loss ${p.pct.toFixed(6)} % ${p.pct.toFixed(6)} %`);
    f.line(`Capital ${p.pct.toFixed(6)} % ${p.pct.toFixed(6)} %`);
    f.row("1", "Ordinary business income (loss)", "1", m(Math.round(v.ordinary * p.pct / 100)));
    f.row("4a", "Guaranteed payments for services", "4a", m(p.gp));
    f.row("19", `A Distributions ${m(Math.round(v.distributions * p.pct / 100))}`, "", "");
    out.push(...f.done());
  }
  return out;
}

const balance25 = [
  ["1", "Cash", 140000, 172000],
  ["2a", "Trade notes and accounts receivable", 60000, 66000],
  ["13", "Other assets (attach statement)", 20000, 20000],
  ["14", "Total assets", 220000, 258000],
  ["15", "Accounts payable", 25000, 31000],
  ["17", "Other current liabilities (attach statement)", 10000, 9000],
  ["21", "Partners' capital accounts", 185000, 218000],
  ["22", "Total liabilities and capital", 220000, 258000],
];
const balance24 = [
  ["1", "Cash", 118000, 140000],
  ["2a", "Trade notes and accounts receivable", 55000, 60000],
  ["13", "Other assets (attach statement)", 20000, 20000],
  ["14", "Total assets", 193000, 214000],
  ["15", "Accounts payable", 24000, 25000],
  ["17", "Other current liabilities (attach statement)", 9000, 10000],
  ["21", "Partners' capital accounts", 160000, 179000],
  ["22", "Total liabilities and capital", 193000, 214000],
];

// 2025: pagos garantizados 120,000 en la pagina 1 y 100,000 en el K (E1); porcentajes 50/30/15 (E2);
// total de ingresos mal combinado (E5); el balance abre en 220,000 y 2024 cerro en 214,000 (E6).
const v25 = {
  receipts: 640000, otherIncome: 4000, totalIncome: 645000, deductions: { salaries: 210000, rent: 48000, taxes: 22000, benefits: 18000, other: 62000 },
  guaranteedPage1: 120000, guaranteedK: 100000, totalDeductions: 480000, ordinary: 165000, distributions: 135000,
  analysis: 265000, balance: balance25,
  m1: { books: 168000, expenses: 3000, closing: 171000 }, // E3: cierra en 171,000 y el analisis dice 265,000
  m2: { begin: 185000 }, // E4: termina en 218,000 en el M-2... y el Schedule L dice 218,000: ver abajo
  partners: [
    { name: "LAURA B KENT", ssn: "000-45-6781", pct: 50, gp: 50000 },
    { name: "OMAR S HADDAD", ssn: "000-45-6792", pct: 30, gp: 30000 },
    { name: "GRACE N PARK", ssn: "000-45-6803", pct: 15, gp: 20000 },
  ],
};
// El M-2 cierra en 185,000 + 168,000 - 135,000 = 218,000 y el Schedule L tambien: para plantar E4
// el libro de capital del Schedule L queda en 213,000.
v25.balance = v25.balance.map((r) => (r[0] === "21" ? ["21", "Partners' capital accounts", 185000, 213000] : r));
const v24 = {
  receipts: 600000, otherIncome: 3000, totalIncome: 603000, deductions: { salaries: 200000, rent: 46000, taxes: 21000, benefits: 17000, other: 58000 },
  guaranteedPage1: 100000, guaranteedK: 100000, totalDeductions: 442000, ordinary: 161000, distributions: 145000,
  analysis: 261000, balance: balance24,
  m1: { books: 158000, expenses: 3000, closing: 161000 },
  m2: { begin: 166000 },
  partners: [
    { name: "LAURA B KENT", ssn: "000-45-6781", pct: 50, gp: 50000 },
    { name: "OMAR S HADDAD", ssn: "000-45-6792", pct: 30, gp: 30000 },
    { name: "GRACE N PARK", ssn: "000-45-6803", pct: 20, gp: 20000 },
  ],
};
v24.balance = v24.balance.map((r) => (r[0] === "21" ? ["21", "Partners' capital accounts", 160000, 179000] : r));

const header = `${NAME} ${EIN}`;
const current = () => [
  ...summaryPages(2025, header, [["ORDINARY BUSINESS INCOME", "165,000"], ["GUARANTEED PAYMENTS", "120,000"], ["DISTRIBUTIONS", "135,000"]], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 1065, SCH B-1, SCH K-1, 7004, 8879-PE",
  ]),
  ...form1065(2025, v25),
  ...k1s(2025, v25),
];
const prior = () => [
  ...summaryPages(2024, header, [["ORDINARY BUSINESS INCOME", "161,000"], ["GUARANTEED PAYMENTS", "100,000"], ["DISTRIBUTIONS", "145,000"]], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 1065, SCH B-1, SCH K-1, 7004, 8879-PE",
  ]),
  ...form1065(2024, v24),
  ...k1s(2024, v24),
];

async function workpaper() {
  const wb = new ExcelJS.Workbook();
  const money = "#,##0.00;(#,##0.00)";
  const head = (ws, title, period) => { ws.addRow(["Cedar Point Advisors LLC"]).font = { bold: true, size: 12 }; ws.addRow([title]).font = { bold: true }; ws.addRow([period]); ws.addRow([]); };
  const pl = wb.addWorksheet("PnL");
  head(pl, "Profit and Loss", "January-December, 2025");
  for (const [label, amount] of [
    ["Consulting revenue", 640000], ["Other income", 4000], ["Salaries & wages", 210000], ["Guaranteed payments - partners", 100000],
    ["Rent", 48000], ["Payroll taxes", 22000], ["Employee benefits", 18000], ["Meals", 6000], ["Other expenses", 72000], ["Net income", 168000],
  ]) pl.addRow([label, amount]).getCell(2).numFmt = money;
  const gp = wb.addWorksheet("Guaranteed payments");
  head(gp, "Guaranteed payments by partner", "Tax year 2025");
  for (const [p, a] of [["Laura B Kent", 50000], ["Omar S Haddad", 30000], ["Grace N Park", 20000], ["Total", 100000]]) gp.addRow([p, a]).getCell(2).numFmt = money;
  const own = wb.addWorksheet("Ownership");
  head(own, "Partners and ownership (operating agreement)", "12/31/25");
  for (const [p, pct] of [["Laura B Kent", "50%"], ["Omar S Haddad", "30%"], ["Grace N Park", "20%"]]) own.addRow([p, pct]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = {
  id: "1065",
  titulo: "1065 — consultora con tres socios (Texas)",
  returnType: "1065",
  taxYear: "2025",
  async archivos() {
    return [
      { name: "Cedar Point Advisors LLC 2025 return.pdf", role: "current_return", pdf: buildPdf(current()) },
      { name: "Cedar Point Advisors LLC - 2024 Tax Returns.pdf", role: "prior_return", pdf: buildPdf(prior()) },
      { name: "Cedar Point Advisors LLC_workpaper-2025.xlsx", role: "supporting_document", xlsx: await workpaper() },
    ];
  },
  esperado: {},
  clave: [
    { id: "E1", error: "Pagos garantizados: 120,000 en la pagina 1 y 100,000 en el Schedule K", codigo: /guaranteed payments differ/i },
    { id: "E2", error: "Los porcentajes de los K-1 suman 95% (50/30/15; el acuerdo dice 20%)", codigo: /ownership percentages do not add to 100/i },
    { id: "E3", error: "M-1 cierra en 171,000 y el Analysis of Net Income dice 265,000", codigo: /Schedule M-1 — does not close/i },
    { id: "E4", error: "M-2 cierra en 218,000 y el capital del Schedule L en 213,000", codigo: /Schedule M-2 — ending balance differs from the balance sheet/i },
    { id: "E5", error: "Renglon 8 mal combinado (645,000 en vez de 644,000)", codigo: /line 8 — amount does not follow/i },
    { id: "E6", error: "Schedule L abre en 220,000 y 2024 cerro en 214,000", codigo: /^Schedule L total assets does not open where/i },
    { id: "E9", error: "M-2 abre en 185,000 y el M-2 de 2024 cerro en 179,000 (mismo error que E6)", codigo: /Schedule M-2 — does not open where last year closed/i },
    { id: "E7", error: "El libro tiene 100,000 de pagos garantizados; la pagina 1 deduce 120,000", codigo: null },
    { id: "E8", error: "El K-1 de Grace Park dice 15% y el acuerdo operativo 20%", codigo: null },
  ],
  tolerados: [
    // El mismo error de apertura visto desde el otro total del balance.
    /^Schedule L total liabilities and (?:capital|shareholders. equity) does not open where/i,
  ],
};
