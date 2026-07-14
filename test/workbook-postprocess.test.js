"use strict";
// Post-proceso determinístico: tabs canónicas, totales de sección anidados,
// aritmética de estados financieros y la cadena de linkeo de fórmulas.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  canonicalizeWorkbookSheets, injectSectionTotalFormulas,
  injectFinancialStatementFormulas, linkEntryGuideToWorkpaper,
} = require("../lib/workbook-postprocess");
const { buildM1Sheet } = require("../lib/m1-reconciliation");

const F = (v) => (v && typeof v === "object" ? v.formula : null);

function nestedPnl() {
  return { name: "P&L", rows: [
    ["PROFIT AND LOSS"], ["Account", "Amount"],
    ["Income", ""], ["Sales", 900000], ["Refunds", -12500], ["Total Income", 887500],
    ["Expenses", ""], ["Advertising", 40000],
    ["Payroll", ""], ["Wages", 200000], ["Payroll taxes", 18000], ["Total Payroll", 218000],
    ["Rent", 60000], ["Total Expenses", 318000],
    ["Net Income", 569500],
  ]};
}

test("canonicalize: renames variants and enforces tab order", () => {
  const wb = { sheets: [
    { name: "Src report", rows: [["x", 1]], verbatim: true },
    { name: "AI Notes", rows: [["AI Notes"]] },
    { name: "Adjusting Journal Entries", rows: [["JE", 1]] },
    { name: "Extra Analysis", rows: [["y", 2]] },
    { name: "P&L", rows: [["z", 3]] },
    { name: "Data Entry Guide", rows: [["g", 4]] },
    { name: "Book to Tax (M-1)", rows: [["m", 5]] },
  ]};
  canonicalizeWorkbookSheets(wb);
  assert.deepStrictEqual(wb.sheets.map((s) => s.name), [
    "Book to Tax (M-1)", "Profit and Loss", "AJE Worksheet", "Extra Analysis", "AI Notes", "Data Entry Guide", "Src report",
  ]);
});

test("canonicalize: never renames verbatim source tabs", () => {
  const wb = { sheets: [{ name: "P&L", rows: [["a", 1]], verbatim: true }] };
  canonicalizeWorkbookSheets(wb);
  assert.strictEqual(wb.sheets[0].name, "P&L");
});

test("nested section totals become child-chain formulas (only when they foot)", () => {
  const pnl = nestedPnl();
  pnl.name = "Profit and Loss";
  injectSectionTotalFormulas({ sheets: [pnl] });
  assert.strictEqual(F(pnl.rows[5][1]), "B4+B5");          // Total Income
  assert.strictEqual(F(pnl.rows[11][1]), "B10+B11");       // Total Payroll (anidado)
  assert.strictEqual(F(pnl.rows[13][1]), "B8+B12+B13");    // Total Expenses salta el interior anidado
});

test("non-reconciling totals stay static; verbatim untouched", () => {
  const bad = { name: "T", rows: [["Section", ""], ["a", 10], ["b", 20], ["Total Section", 99]] };
  injectSectionTotalFormulas({ sheets: [bad] });
  assert.strictEqual(bad.rows[3][1], 99);
  const verb = { name: "V", verbatim: true, rows: [["Income", ""], ["a", 10], ["b", 20], ["Total Income", 30]] };
  injectSectionTotalFormulas({ sheets: [verb] });
  assert.strictEqual(verb.rows[3][1], 30);
});

test("statement arithmetic: Net Income live; BS net income linked to P&L", () => {
  const pnl = nestedPnl(); pnl.name = "Profit and Loss";
  const bs = { name: "Balance Sheet", rows: [
    ["BS"], ["Account", "Amount"],
    ["Total Liabilities", 120000], ["Net Income", 569500], ["Total Equity", 700000],
    ["Total Liabilities & Equity", 820000],
  ]};
  injectFinancialStatementFormulas({ sheets: [pnl, bs] });
  assert.strictEqual(F(pnl.rows[14][1]), "B6-B14");
  assert.strictEqual(F(bs.rows[5][1]), "B3+B5");
  assert.strictEqual(F(bs.rows[3][1]), "'Profit and Loss'!B15");
});

test("linker chain: P&L→M-1, guide→M-1 y guide→P&L; dollar-fallback para montos redondeados", () => {
  const pnl = nestedPnl(); pnl.name = "Profit and Loss";
  const m1 = buildM1Sheet({ netIncomePerBooks: 569500, ajes: [], m1: { meals50: 1234.56 }, separatelyStated: [] }, "1065");
  const guide = { name: "Data Entry Guide", rows: [
    ["TIE-OUT CHECKS"],
    ["Check", "Guide Amount", "Financial Amount", "Difference", "Status"],
    ["Income vs P&L", 887500, 887500, 0, "OK"],
    [""],
    ["#", "Field", "Line", "Amount", "Source"],
    [1, "Meals addback", "M-1", "1234.56", "M-1"],
    [2, "Gross receipts (rounded)", "L1a", 887500, "P&L"],
  ]};
  const wb = { sheets: [pnl, m1, guide] };
  linkEntryGuideToWorkpaper(wb);
  const ni = m1.rows.find((r) => /^net income \(loss\) per books$/i.test(String(r[0] || "")));
  assert.match(F(ni[1]) || "", /^'Profit and Loss'!B\d+$/);
  assert.match(F(guide.rows[5][3]) || "", /^'Book to Tax \(M-1\)'!B\d+$/);
  assert.match(F(guide.rows[6][3]) || "", /^'Profit and Loss'!B\d+$/);
  assert.strictEqual(F(guide.rows[2][3]), "B3-C3"); // tie-out difference viva
});

test("linker sin M-1 (1040 personal): tie-outs vivos y links a tabs secundarias", () => {
  const w2 = { name: "W-2 Summary", rows: [["W-2"], ["Box", "Desc", "Amount"], [1, "Wages", 70123.45]] };
  const guide = { name: "Data Entry Guide", rows: [
    ["TIE-OUT CHECKS"],
    ["Check", "Guide Amount", "Financial Amount", "Difference", "Status"],
    ["Wages tie", 70123.45, 70123.45, 0, "OK"],
    [""],
    ["#", "Field", "Line", "Amount", "Source"],
    [1, "Wages", "1040 1a", "70123.45", "W-2"],
  ]};
  const wb = { sheets: [w2, guide] };
  linkEntryGuideToWorkpaper(wb); // no debe crashear ni saltearse los tie-outs
  assert.strictEqual(F(guide.rows[2][3]), "B3-C3");
  assert.strictEqual(F(guide.rows[5][3]), "'W-2 Summary'!C3");
});

test("linker: montos ambiguos quedan estáticos (nunca un link dudoso)", () => {
  const pnl = { name: "Profit and Loss", rows: [["P&L"], ["A", "Amt"], ["a", 500.4], ["b", 500.2]] };
  const m1 = buildM1Sheet({ netIncomePerBooks: 1000.6, ajes: [], m1: {}, separatelyStated: [] }, "1065");
  const guide = { name: "Data Entry Guide", rows: [["#", "F", "L", "Amount", "S"], [1, "x", "", 500, "y"]] };
  linkEntryGuideToWorkpaper({ sheets: [pnl, m1, guide] });
  assert.strictEqual(guide.rows[1][3], 500);
});
