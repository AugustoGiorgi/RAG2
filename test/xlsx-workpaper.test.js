"use strict";
// Generador de Excel estilizado: fórmulas seguras (probadas), IFERROR, round-trip real.
const { test } = require("node:test");
const assert = require("node:assert");
const ExcelJS = require("exceljs");
const { buildStyledWorkpaperXlsx, parseNum, safeSumFormula } = require("../lib/xlsx-workpaper");
const { buildM1Sheet } = require("../lib/m1-reconciliation");
const { canonicalizeWorkbookSheets, injectSectionTotalFormulas, injectFinancialStatementFormulas, linkEntryGuideToWorkpaper } = require("../lib/workbook-postprocess");

test("parseNum: montos, negativos con paréntesis, años excluidos", () => {
  assert.strictEqual(parseNum("1,234.56"), 1234.56);
  assert.strictEqual(parseNum("(500.25)"), -500.25);
  assert.strictEqual(parseNum("$70,000"), 70000);
  assert.strictEqual(parseNum("2025"), null);   // año, no monto
  assert.strictEqual(parseNum("texto"), null);
});

test("safeSumFormula: inyecta solo cuando el bloque reconcilia al centavo", () => {
  const rows = [["Header", ""], ["a", 10.5], ["b", 20.25], ["Total", 30.75]];
  const ok = safeSumFormula(rows, 3, 1);
  assert.match(ok.formula, /^IFERROR\(SUM\(B2:B3\),30\.75\)$/);
  const bad = [["Header", ""], ["a", 10], ["b", 20], ["Total", 99]];
  assert.strictEqual(safeSumFormula(bad, 3, 1), null);
});

test("round-trip completo: pipeline → xlsx → releído sin #REF y con fórmulas vivas", async () => {
  const pnl = { name: "Profit and Loss", rows: [
    ["P&L"], ["Account", "Amount"],
    ["Income", ""], ["Sales", 500000], ["Fees", 25000], ["Total Income", 525000],
    ["Expenses", ""], ["Rent", 60000], ["Wages", 180000], ["Total Expenses", 240000],
    ["Net Income", 285000],
  ]};
  const m1 = buildM1Sheet({ netIncomePerBooks: 285000, ajes: [], m1: { meals50: 750.5 }, separatelyStated: [] }, "1120-S");
  const guide = { name: "Data Entry Guide", rows: [
    ["#", "Field", "Line", "Amount", "Source"],
    [1, "Meals addback", "M-1", "750.50", "M-1"],
  ]};
  const wb = { sheets: [pnl, m1, guide] };
  canonicalizeWorkbookSheets(wb);
  injectSectionTotalFormulas(wb);
  injectFinancialStatementFormulas(wb);
  linkEntryGuideToWorkpaper(wb);

  const buffer = await buildStyledWorkpaperXlsx(wb);
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(buffer);

  let formulas = 0, refErrors = 0;
  out.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => {
    const f = c.value && c.value.formula;
    if (f) { formulas += 1; if (String(f).includes("#REF")) refErrors += 1; }
  })));
  assert.strictEqual(refErrors, 0, "nunca #REF");
  assert.ok(formulas >= 6, `esperaba >=6 formulas, hay ${formulas}`);

  // Toda fórmula de subtotal viaja envuelta en IFERROR con el valor cacheado.
  const m1ws = out.getWorksheet("Book to Tax (M-1)");
  let ordinary = null;
  m1ws.eachRow((row, rn) => { if (/ordinary business income/i.test(String(row.getCell(1).value || ""))) ordinary = m1ws.getCell(`B${rn}`).value; });
  assert.match(String(ordinary.formula), /^IFERROR\(/);
  assert.strictEqual(ordinary.result, 285750.5);
});

test("sheets verbatim: números intactos, sin fórmulas inyectadas", async () => {
  const verb = { name: "Cliente Original", verbatim: true, rows: [
    ["Reporte"], ["a", 10], ["b", 20], ["Total", 30],
  ]};
  const buffer = await buildStyledWorkpaperXlsx({ sheets: [verb] });
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(buffer);
  const ws = out.getWorksheet("Cliente Original");
  assert.strictEqual(ws.getCell("B4").value, 30); // número plano, no fórmula
});
