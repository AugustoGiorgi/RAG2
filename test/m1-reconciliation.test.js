"use strict";
// Motor determinístico del M-1: matemática, variante 1040, guardián anti-doble-conteo.
const { test } = require("node:test");
const assert = require("node:assert");
const { buildM1Sheet, hasReconciliation, M1_LINES } = require("../lib/m1-reconciliation");

const num = (cell) => (cell && typeof cell === "object" ? cell.value : cell);
const findRow = (sheet, re) => sheet.rows.find((r) => re.test(String(r[0] || "")));

// Reconciliación tipo (datos FICTICIOS — nunca de clientes reales).
const RECON = {
  netIncomePerBooks: 187450.2,
  ajes: [{ label: "AJE-1 Furniture de minimis", amount: -9310.45, note: "" }],
  m1: {
    meals50: 2315.4, entertainment: 1200, charitable: 800, creditCardRewards: -12840.75,
    assetSaleIncomeRemoval: -54300, portfolioIncomeRemoval: -125.6, foreignTaxesPaid: 250,
  },
  separatelyStated: [{ label: "Net Section 1231 gain (K-1 Line 9)", amount: 54300, note: "" }],
};

test("ordinary income foots to the cent", () => {
  const sheet = buildM1Sheet(RECON, "1120-S");
  const adj = findRow(sheet, /^adjusted net income/i);
  const ord = findRow(sheet, /^ordinary business income/i);
  assert.strictEqual(num(adj[1]), 178139.75); // 187450.20 - 9310.45
  // 178139.75 + 2315.40+1200+800-12840.75-54300-125.60+250 = 115438.80
  assert.strictEqual(num(ord[1]), 115438.8);
});

test("subtotals are live formulas with cached values", () => {
  const sheet = buildM1Sheet(RECON, "1065");
  const ord = findRow(sheet, /^ordinary business income/i)[1];
  assert.match(ord.formula, /^B\d+\+SUM\(B\d+:B\d+\)$/);
  assert.strictEqual(typeof ord.value, "number");
});

test("every fixed M-1 line appears exactly once, in order", () => {
  const sheet = buildM1Sheet(RECON, "1120");
  const labels = sheet.rows.map((r) => String(r[0] || ""));
  let last = -1;
  for (const line of M1_LINES) {
    const idx = labels.indexOf(line.label);
    assert.notStrictEqual(idx, -1, `missing line: ${line.key}`);
    assert.ok(idx > last, `out of order: ${line.key}`);
    last = idx;
  }
});

test("1040 variant: Sch C-E sheet name, title and labels", () => {
  const sheet = buildM1Sheet({ netIncomePerBooks: 80000, ajes: [], m1: { meals50: 500 }, separatelyStated: [] }, "1040");
  assert.strictEqual(sheet.name, "Book to Tax (Sch C-E)");
  assert.match(String(sheet.rows[0][0]), /BUSINESS INCOME RECONCILIATION \(Schedule C \/ Schedule E\)/);
  assert.ok(findRow(sheet, /^net business income \(schedule c\/e, tax\)$/i));
});

test("double-count guard: duplicated AJE dropped, ordinary counted once", () => {
  const withDup = {
    ...RECON,
    ajes: [...RECON.ajes, { label: "AJE-2 Reclass home office to owner draw", amount: 4480.19 }],
    m1: { ...RECON.m1, homeOffice: 4480.19 },
  };
  const sheet = buildM1Sheet(withDup, "1120-S");
  assert.ok(!findRow(sheet, /AJE-2 Reclass home office/i), "duplicated AJE must be dropped");
  const ord = findRow(sheet, /^ordinary business income/i);
  assert.strictEqual(num(ord[1]), 119919 - 0.01); // 115438.80 + 4480.19 = 119918.99
});

test("double-count guard: unrelated same-amount AJE is kept", () => {
  const coincidence = {
    ...RECON,
    ajes: [{ label: "AJE Payroll accrual true-up", amount: 4480.19 }],
    m1: { ...RECON.m1, homeOffice: 4480.19 },
  };
  const sheet = buildM1Sheet(coincidence, "1120-S");
  assert.ok(findRow(sheet, /payroll accrual/i), "legit AJE must survive");
});

test("double-count guard: zero-amount reclass memos always survive", () => {
  const memos = { ...RECON, ajes: [{ label: "Reclass home office (no NI impact)", amount: 0 }], m1: { ...RECON.m1, homeOffice: 1000 } };
  const sheet = buildM1Sheet(memos, "1120-S");
  assert.ok(findRow(sheet, /no NI impact/i));
});

test("hasReconciliation gates on netIncomePerBooks", () => {
  assert.strictEqual(hasReconciliation(RECON), true);
  assert.strictEqual(hasReconciliation({}), false);
  assert.strictEqual(hasReconciliation(null), false);
  assert.strictEqual(hasReconciliation({ netIncomePerBooks: 0 }), true); // cero es válido
});
