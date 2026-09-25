"use strict";
// Dos arreglos de Preparation que salieron de revisar un workpaper contra un paquete de prueba:
//
// 1. Las ganancias acumuladas del Schedule L. QuickBooks separa el patrimonio en "Retained
//    Earnings" y "Net Income"; la guia de carga los sumo al cierre pero no al inicio, y el
//    Schedule L al inicio quedo descuadrado por el resultado del año anterior.
// 2. Las hojas largas. El navegador corta la copia estructurada de cada hoja en 250 filas y el
//    prompt la presentaba como la fuente de verdad; un mayor de miles de filas perdia la mitad
//    de las cuentas, y la copia del archivo que se agrega al workbook tambien salia cortada.
//
// Todos los datos son inventados.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseCsv, sheetsFromExtractedText, fullSheetRows, partialSheetsNote } = require("../lib/sheet-text");
const {
  readBalanceSheetEquity, equityFactsPrompt, fixRetainedEarningsInGuide, retainedEarningsNote,
} = require("../lib/balance-sheet-equity");
const { preparationPeriodRule } = require("../lib/preparation-year");

// ---------- lectura del texto que arma el navegador ----------

test("el CSV respeta comillas, comas dentro de comillas y comillas escapadas", () => {
  const rows = parseCsv('Label,Amount\n"Total for Sales","$1,078,900.00"\n"Say ""hi""",\nmulti,"a\nb"\n');
  assert.deepStrictEqual(rows, [
    ["Label", "Amount"],
    ["Total for Sales", "$1,078,900.00"],
    ['Say "hi"', ""],
    ["multi", "a\nb"],
  ]);
});

test("el texto se separa por hoja; un CSV sin marcadores es una sola hoja", () => {
  const text = "--- Sheet: P&L ---\nSales,100\n\n--- Sheet: Notes ---\nA,B";
  assert.deepStrictEqual(sheetsFromExtractedText(text).map((s) => [s.name, s.rows.length]), [["P&L", 1], ["Notes", 1]]);
  assert.deepStrictEqual(sheetsFromExtractedText("a,b\nc,d").map((s) => [s.name, s.rows.length]), [["", 2]]);
});

test("la hoja completa se lee del texto; si el nombre se repite (un ZIP) no se adivina", () => {
  const ledger = ["Date,Amount", ...Array.from({ length: 400 }, (_, i) => `01/0${(i % 9) + 1}/2025,${i}.00`)].join("\n");
  assert.strictEqual(fullSheetRows(`--- Sheet: Sheet1 ---\n${ledger}`, "Sheet1").length, 401);
  assert.strictEqual(fullSheetRows(`--- Sheet: Sheet1 ---\n${ledger}`, "Otra"), null);
  assert.strictEqual(fullSheetRows(`--- Sheet: Sheet1 ---\na,1\n\n--- Sheet: Sheet1 ---\nb,2`, "Sheet1"), null);
  const capped = fullSheetRows(`--- Sheet: Sheet1 ---\n${ledger}`, "Sheet1", 100);
  assert.strictEqual(capped.length, 101);
  assert.match(capped[100][0], /Truncated: showing 100 of 401 rows/);
});

test("el aviso nombra solo las hojas cortadas", () => {
  const templates = [{ sheets: [{ name: "Sheet1", rows: [["a"]], totalRows: 437 }, { name: "Chica", rows: [["a"]], totalRows: 1 }] }];
  const note = partialSheetsNote(templates);
  assert.match(note, /PARTIAL STRUCTURED COPY/);
  assert.match(note, /"Sheet1" \(first 1 of 437 rows\)/);
  assert.doesNotMatch(note, /Chica/);
  assert.strictEqual(partialSheetsNote([{ sheets: [{ name: "Sheet1", rows: [["a"]] }] }]), "", "sin totalRows (navegador viejo) no hay aviso");
});

// ---------- el patrimonio del balance ----------

// Como lo exporta QuickBooks: la primera columna es la de 2026, que el año elegido debe ignorar.
const BALANCE = `--- Sheet: Sheet1 ---
Demo Co,,,
Balance Sheet,,,
"As of Mar 31, 2026",,,
,Total,,
,"As of Mar 31, 2026","As of Dec 31, 2025","As of Dec 31, 2024 (PY)"
Assets,,,
Total for Assets,"$341,643.07","$315,689.22","$254,987.90"
Equity,,,
Common Stock,"25,000.00","25,000.00","25,000.00"
Retained Earnings,"170,179.07","102,747.90","58,300.00"
Net Income,"27,768.60","67,431.17","44,447.90"
Total for Equity,"$222,947.67","$195,179.07","$127,747.90"`;
const files = [{ name: "Demo Co_Balance Sheet.xlsx", preparationRole: "current_financials", text: BALANCE }];

test("el balance se lee en las columnas del año elegido, no en la de 2026", () => {
  const facts = readBalanceSheetEquity(files, "2025");
  assert.strictEqual(facts.file, "Demo Co_Balance Sheet.xlsx");
  assert.deepStrictEqual(facts.boy, { date: "12/31/2024", retainedEarnings: 58300, netIncome: 44447.9, total: 102747.9 });
  assert.deepStrictEqual(facts.eoy, { date: "12/31/2025", retainedEarnings: 102747.9, netIncome: 67431.17, total: 170179.07 });
});

test("un balance de una sola fecha la trae en el titulo", () => {
  const single = `--- Sheet: Sheet1 ---\nDemo Co,\nBalance Sheet,\n"As of Dec 31, 2025",\n,Total\nRetained Earnings,"(5,000.00)"\nNet Income,"12,000.00"`;
  const facts = readBalanceSheetEquity([{ name: "bs.xlsx", preparationRole: "current_financials", text: single }], 2025);
  assert.strictEqual(facts.boy, null);
  assert.deepStrictEqual(facts.eoy, { date: "12/31/2025", retainedEarnings: -5000, netIncome: 12000, total: 7000 });
});

test("sin renglon de Net Income, sin la fecha del año, o en un archivo del año anterior: nada", () => {
  const sinNI = BALANCE.replace(/Net Income,.*\n/, "");
  assert.strictEqual(readBalanceSheetEquity([{ ...files[0], text: sinNI }], "2025"), null);
  assert.strictEqual(readBalanceSheetEquity(files, "2023"), null);
  assert.strictEqual(readBalanceSheetEquity([{ ...files[0], preparationRole: "prior_return" }], "2025"), null);
});

test("el hecho para el modelo da la suma de cada fecha y advierte de que año es el Net Income", () => {
  const prompt = equityFactsPrompt(readBalanceSheetEquity(files, "2025"));
  assert.match(prompt, /Beginning of year \(12\/31\/2024\): Retained Earnings 58,300\.00 \+ Net Income 44,447\.90 = 102,747\.90/);
  assert.match(prompt, /End of year \(12\/31\/2025\): Retained Earnings 102,747\.90 \+ Net Income 67,431\.17 = 170,179\.07/);
  assert.match(prompt, /prior year's result/);
  assert.strictEqual(equityFactsPrompt(null), "");
});

const guideWith = (boy, eoy, m2) => ({
  tieOutChecks: [],
  screens: [
    { screenPath: "Balance Sheet > Liabilities and Equity (Schedule L)", fields: [
      { fieldName: "Retained Earnings - BOY", lineReference: "Sch L L25", value: boy },
      { fieldName: "Retained Earnings - EOY", lineReference: "Sch L L25", value: eoy },
      { fieldName: "Retained earnings - Appropriated - BOY", lineReference: "Sch L L24", value: 58300 },
    ] },
    { screenPath: "Reconciliation > Schedule M-2", fields: [
      { fieldName: "Balance at beginning of year", lineReference: "M-2 L1", value: m2 },
      { fieldName: "Net income per books", lineReference: "M-2 L2", value: 67431.17 },
    ] },
  ],
});

test("el error de la corrida real: al inicio solo Retained Earnings; se corrige y cuadra", () => {
  const facts = readBalanceSheetEquity(files, "2025");
  const guide = guideWith(58300, 170179.07, 102747.9);
  const changes = fixRetainedEarningsInGuide(guide, facts);
  assert.deepStrictEqual(changes, [{ kind: "boy", date: "12/31/2024", from: 58300, to: 102747.9 }]);
  const [boy, eoy, appropriated] = guide.screens[0].fields;
  assert.strictEqual(boy.value, 102747.9);
  assert.match(boy.statusNote, /Corrected by code/);
  assert.strictEqual(eoy.value, 170179.07, "el cierre ya estaba bien");
  assert.strictEqual(appropriated.value, 58300, "la linea 24 (appropriated) no se toca");
  assert.strictEqual(guide.screens[1].fields[0].value, 102747.9, "el M-2 ya estaba bien");
  assert.deepStrictEqual(guide.tieOutChecks.map((c) => [c.guideAmount, c.financialAmount, c.status]), [
    [102747.9, 102747.9, "OK"], [170179.07, 170179.07, "OK"],
  ]);
  assert.match(retainedEarningsNote(changes, facts), /beginning of year\) corrected by code: 58,300\.00 .* 102,747\.90/);
});

test("tambien el M-2 si arranco solo de Retained Earnings", () => {
  const guide = guideWith(102747.9, 170179.07, 58300);
  const changes = fixRetainedEarningsInGuide(guide, readBalanceSheetEquity(files, "2025"));
  assert.deepStrictEqual(changes.map((c) => [c.kind, c.to]), [["m2", 102747.9]]);
});

test("un valor que no es Retained Earnings solo (distribuciones) no se toca: el control lo muestra", () => {
  const guide = guideWith(92747.9, 170179.07, 92747.9);
  const changes = fixRetainedEarningsInGuide(guide, readBalanceSheetEquity(files, "2025"));
  assert.deepStrictEqual(changes, []);
  assert.strictEqual(guide.screens[0].fields[0].value, 92747.9);
  const boyCheck = guide.tieOutChecks[0];
  assert.strictEqual(boyCheck.status, "NEEDS_REVIEW");
  assert.strictEqual(boyCheck.difference, -10000);
});

// ---------- lo que recibe el modelo y lo que va al workbook ----------

const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no encontre ${name} en server.js`);
  return src.slice(start, src.indexOf("\n}", start) + 2);
};
// eslint-disable-next-line no-new-func
const buildPreparerContent = new Function(
  "preparationPeriodRule", "equityFactsPrompt", "partialSheetsNote", "softwareDisplayName", "RECONCILIATION_PROMPT_LINES",
  "collectScannedPdfDocuments", "stripAmountsFromTemplate", "csvTextFromTemplates", "stripFinancialAmountsFromText", "safeJsonForPrompt",
  `${grab("buildPreparerContent")}\nreturn buildPreparerContent;`,
)(
  preparationPeriodRule, equityFactsPrompt, partialSheetsNote, () => "ProConnect Tax", [],
  () => ({ scannedDocs: [], skippedScans: [] }), (x) => x, () => "", (x) => x, () => "{}",
);
const promptFor = (payload) => buildPreparerContent(payload)
  .filter((block) => block.type === "text").map((block) => block.text).join("\n");

test("el modelo recibe el patrimonio calculado y el aviso de la hoja cortada", () => {
  const ledger = {
    name: "Demo Co_General Ledger.xlsx", preparationRole: "current_financials",
    text: "--- Sheet: Sheet1 ---\nDate,Amount\n01/05/2025,10.00",
    workbookTemplate: { sheets: [{ name: "Sheet1", rows: [["Date", "Amount"]], totalRows: 437 }] },
  };
  const prompt = promptFor({
    metadata: { instructions: "Prepare.", taxYear: "2025", taxYearSelected: true },
    files: [ledger], equityFacts: readBalanceSheetEquity(files, "2025"),
  });
  assert.match(prompt, /BALANCE SHEET EQUITY \(read by code from "Demo Co_Balance Sheet\.xlsx"\)/);
  assert.match(prompt, /PARTIAL STRUCTURED COPY: this block does not have every row of "Sheet1" \(first 1 of 437 rows\)/);
});

test("sin hechos ni hojas cortadas el prompt no cambia", () => {
  const prompt = promptFor({
    metadata: { instructions: "Prepare.", taxYear: "2025", taxYearSelected: true },
    files: [{ name: "pl.xlsx", preparationRole: "current_financials", text: "--- Sheet: Sheet1 ---\nSales,1", workbookTemplate: { sheets: [{ name: "Sheet1", rows: [["Sales", "1"]], totalRows: 1 }] } }],
  });
  assert.doesNotMatch(prompt, /BALANCE SHEET EQUITY|PARTIAL STRUCTURED COPY/);
});

// eslint-disable-next-line no-new-func
const appendSourceReportSheets = new Function(
  "fullSheetRows", `${grab("normalizeRows")}\n${grab("appendSourceReportSheets")}\nreturn appendSourceReportSheets;`,
)(fullSheetRows);

test("la copia del mayor que va al workbook sale completa", () => {
  const lines = Array.from({ length: 436 }, (_, i) => `01/0${(i % 9) + 1}/2025,${i}.00`);
  const file = {
    name: "Demo Co_General Ledger.xlsx",
    text: `--- Sheet: Sheet1 ---\nDate,Amount\n${lines.join("\n")}`,
    workbookTemplate: { sheets: [{ name: "Sheet1", rows: [["Date", "Amount"], ...lines.slice(0, 249).map((l) => l.split(","))], totalRows: 437 }] },
  };
  const workbook = appendSourceReportSheets({ sheets: [] }, [file]);
  assert.strictEqual(workbook.sheets[0].rows.length, 437);
  assert.deepStrictEqual(workbook.sheets[0].rows.at(-1), lines.at(-1).split(","));
});

test("una hoja entera (o de un navegador viejo) se copia como antes", () => {
  const file = { name: "pl.xlsx", text: "--- Sheet: Sheet1 ---\nSales,1\nRent,2", workbookTemplate: { sheets: [{ name: "Sheet1", rows: [["Sales", "1"], ["Rent", "2"]] }] } };
  const workbook = appendSourceReportSheets({ sheets: [] }, [file]);
  assert.deepStrictEqual(workbook.sheets[0].rows, [["Sales", "1"], ["Rent", "2"]]);
});
