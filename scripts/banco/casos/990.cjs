"use strict";

/**
 * Caso del banco: 990 de una fundacion cultural (entidad publica, 501(c)(3)).
 * Organizacion, directores y cifras inventados. El codigo solo cruza la aritmetica impresa del
 * 990; el resto de los errores es para la Review completa con el modelo.
 */

const ExcelJS = require("exceljs");
const { Form, buildPdf, m, summaryPages } = require("../comun.cjs");

const NAME = "LAKESHORE COMMUNITY ARTS FOUNDATION";
const EIN = "99-6781234";

function form990(year, v) {
  const f = new Form(`Form 990 (${year})`);
  f.line("Department of the Treasury - Internal Revenue Service", { size: 7 });
  f.title(`Form 990 Return of Organization Exempt From Income Tax ${year} OMB No. 1545-0047`);
  f.line("Under section 501(c), 527, or 4947(a)(1) of the Internal Revenue Code (except private foundations)", { size: 7 });
  f.line(`A For the ${year} calendar year, or tax year beginning , ${year}, and ending , 20`, { size: 7 });
  f.line(`C Name of organization ${NAME} D Employer identification number ${EIN}`);
  f.line("Number and street 1200 LAKESHORE DR E Telephone number (312) 555-0100");
  f.line(`City or town, state or province, country, and ZIP or foreign postal code CHICAGO, IL 60610 G Gross receipts $ ${m(v.revenue[1])}`);
  f.line("I Tax-exempt status: X 501(c)(3) 501(c) ( ) (insert no.) 4947(a)(1) or 527");
  f.title("Part I Summary", 9);
  f.line("1 Briefly describe the organization's mission or most significant activities: COMMUNITY ART CLASSES AND EXHIBITIONS", { size: 7 });
  f.row("3", "Number of voting members of the governing body (Part VI, line 1a)", "3", "7");
  f.row("5", "Total number of individuals employed in calendar year (Part V, line 2a)", "5", "6");
  f.line("Prior Year Current Year", { x: 470, size: 7 });
  f.row("8", "Contributions and grants (Part VIII, line 1h)", "8", `${m(v.contributions[0])} ${m(v.contributions[1])}`);
  f.row("9", "Program service revenue (Part VIII, line 2g)", "9", `${m(v.program[0])} ${m(v.program[1])}`);
  f.row("10", "Investment income (Part VIII, column (A), lines 3, 4, and 7d)", "10", `${m(v.investment[0])} ${m(v.investment[1])}`);
  f.row("11", "Other revenue (Part VIII, column (A), lines 5, 6d, 8c, 9c, 10c, and 11e)", "11", `${m(0)} ${m(0)}`);
  f.row("12", "Total revenue-add lines 8 through 11 (must equal Part VIII, column (A), line 12)", "12", `${m(v.revenue[0])} ${m(v.revenue[1])}`);
  f.row("13", "Grants and similar amounts paid (Part IX, column (A), lines 1-3)", "13", `${m(v.grants[0])} ${m(v.grants[1])}`);
  f.row("15", "Salaries, other compensation, employee benefits (Part IX, column (A), lines 5-10)", "15", `${m(v.salaries[0])} ${m(v.salaries[1])}`);
  f.row("17", "Other expenses (Part IX, column (A), lines 11a-11d, 11f-24e)", "17", `${m(v.other[0])} ${m(v.other[1])}`);
  f.row("18", "Total expenses. Add lines 13-17 (must equal Part IX, column (A), line 25)", "18", `${m(v.expenses[0])} ${m(v.expenses[1])}`);
  f.row("19", "Revenue less expenses. Subtract line 18 from line 12", "19", `${m(v.net[0])} ${m(v.net[1])}`);
  f.line("Beginning of Current Year End of Year", { x: 440, size: 7 });
  f.row("20", "Total assets (Part X, line 16)", "20", `${m(v.assets[0])} ${m(v.assets[1])}`);
  f.row("21", "Total liabilities (Part X, line 26)", "21", `${m(v.liabilities[0])} ${m(v.liabilities[1])}`);
  f.row("22", "Net assets or fund balances. Subtract line 21 from line 20", "22", `${m(v.netAssets[0])} ${m(v.netAssets[1])}`);
  f.newPage();
  f.line(`Form 990 (${year}) Page 3`, { bold: true });
  f.title("Part IV Checklist of Required Schedules", 9);
  f.line("1 Is the organization described in section 501(c)(3) or 4947(a)(1) (other than a private foundation)? If \"Yes,\" complete Schedule A . . . X Yes No", { size: 7 });
  f.line("2 Is the organization required to complete Schedule B, Schedule of Contributors? See instructions . . . Yes X No", { size: 7 });
  f.title("Part VII Compensation of Officers, Directors, Trustees, Key Employees", 9);
  f.line("(A) Name and title (B) Average hours per week (D) Reportable compensation from the organization (W-2/1099-MISC/1099-NEC)", { size: 7 });
  f.line(`ANNA K FERRIS EXECUTIVE DIRECTOR 40.00 ${m(v.edComp)}`);
  f.line("THOMAS R BLY BOARD CHAIR 2.00 0.");
  return f.done();
}

// 2025: el renglon 19 de este año dice 55,000 y la cuenta da 45,000 (E1); el 22 al cierre dice
// 610,000 y la cuenta da 600,000 (E2).
const v25 = {
  contributions: [520000, 610000], program: [140000, 150000], investment: [8000, 10000], revenue: [668000, 770000],
  grants: [60000, 70000], salaries: [380000, 420000], other: [215000, 235000], expenses: [655000, 725000], net: [13000, 55000],
  assets: [700000, 760000], liabilities: [140000, 160000], netAssets: [560000, 610000], edComp: 128000,
};
const v24 = {
  contributions: [480000, 520000], program: [130000, 140000], investment: [6000, 8000], revenue: [616000, 668000],
  grants: [55000, 60000], salaries: [360000, 380000], other: [205000, 215000], expenses: [620000, 655000], net: [-4000, 13000],
  assets: [680000, 700000], liabilities: [133000, 140000], netAssets: [547000, 560000], edComp: 121000,
};

const header = `${NAME} ${EIN}`;
const current = () => [
  ...summaryPages(2025, header, [["TOTAL REVENUE", "770,000"], ["TOTAL EXPENSES", "725,000"], ["NET ASSETS END OF YEAR", "610,000"]], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 990, SCH D, SCH O, 8868",
    "ILLINOIS: AG990-IL",
  ]),
  ...form990(2025, v25),
];
const prior = () => [
  ...summaryPages(2024, header, [["TOTAL REVENUE", "668,000"], ["TOTAL EXPENSES", "655,000"], ["NET ASSETS END OF YEAR", "560,000"]], [
    "FORMS NEEDED FOR THIS RETURN",
    "FEDERAL: 990, SCH A, SCH B, SCH D, SCH O, 8868",
    "ILLINOIS: AG990-IL",
  ]),
  ...form990(2024, v24),
];

async function workpaper() {
  const wb = new ExcelJS.Workbook();
  const money = "#,##0.00;(#,##0.00)";
  const head = (ws, title) => { ws.addRow(["Lakeshore Community Arts Foundation"]).font = { bold: true, size: 12 }; ws.addRow([title]).font = { bold: true }; ws.addRow(["January-December, 2025"]); ws.addRow([]); };
  const pl = wb.addWorksheet("Statement of activities");
  head(pl, "Statement of activities");
  for (const [label, amount] of [
    ["Contributions - individuals", 360000], ["Contributions - Lakeview Family Trust (single donor)", 250000], ["Program fees (classes)", 150000], ["Interest and dividends", 10000],
    ["Total revenue", 770000], ["Grants to artists", 70000], ["Salaries and benefits", 420000], ["Occupancy", 120000], ["Other expenses", 115000], ["Total expenses", 725000], ["Change in net assets", 45000],
  ]) pl.addRow([label, amount]).getCell(2).numFmt = money;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = {
  id: "990",
  titulo: "990 — fundacion cultural publica (Illinois)",
  returnType: "990",
  taxYear: "2025",
  async archivos() {
    return [
      { name: "Lakeshore Community Arts Foundation 2025 Form 990.pdf", role: "current_return", pdf: buildPdf(current()) },
      { name: "Lakeshore Community Arts Foundation - 2024 Form 990.pdf", role: "prior_return", pdf: buildPdf(prior()) },
      { name: "Lakeshore Community Arts Foundation_workpaper-2025.xlsx", role: "supporting_document", xlsx: await workpaper() },
    ];
  },
  esperado: {},
  clave: [
    { id: "E1", error: "Parte I renglon 19 (año corriente) 55,000; la resta da 45,000", codigo: /amount does not follow the form.s own arithmetic/i, detalle: /line 19 \(column 2\) prints \$55,000/ },
    { id: "E2", error: "Parte I renglon 22 al cierre 610,000; la resta da 600,000", codigo: /amount does not follow the form.s own arithmetic/i, detalle: /line 22 \(column 2\) prints \$610,000/ },
    { id: "E3", error: "Falta el Schedule A (estaba en 2024 y Parte IV linea 1 dice Yes)", codigo: null },
    { id: "E4", error: "Parte IV linea 2 dice No y un donante dio 250,000: falta el Schedule B", codigo: null },
    { id: "E5", error: "Los activos netos abren en 560,000 y el cambio del año es 45,000: cierran en 605,000, no en 610,000", codigo: null },
  ],
  tolerados: [],
};
