"use strict";
// Puente K-1: asignación por socio con fórmulas vivas al M-1. Datos 100% ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const ExcelJS = require("exceljs");
const { buildK1Sheet, normalizeOwners, boxFor } = require("../lib/k1-builder");
const { buildM1Sheet } = require("../lib/m1-reconciliation");
const { buildStyledWorkpaperXlsx } = require("../lib/xlsx-workpaper");

const F = (v) => (v && typeof v === "object" ? v.formula : null);
const V = (v) => (v && typeof v === "object" ? v.value : v);

const RECON = {
  netIncomePerBooks: 187450.2,
  ajes: [],
  m1: { meals50: 2315.4, creditCardRewards: -12840.75, assetSaleIncomeRemoval: -54300, portfolioIncomeRemoval: -125.6 },
  separatelyStated: [
    { label: "Interest income (K-1 Line 4)", amount: 125.6, note: "" },
    { label: "Net Section 1231 gain (K-1 Line 9)", amount: 54300, note: "" },
    { label: "Distributions (K-1 Line 16D)", amount: 80000, note: "" },
  ],
};
const OWNERS = [{ name: "Ana Prueba", ownershipPct: 60 }, { name: "Luis Ejemplo", ownershipPct: 40 }];

test("normalizeOwners: usa evidencia válida; fallback 100% flageado sin evidencia", () => {
  assert.strictEqual(normalizeOwners(OWNERS).assumed, false);
  assert.strictEqual(normalizeOwners([]).assumed, true);
  assert.strictEqual(normalizeOwners([{ name: "X", ownershipPct: 70 }]).assumed, true); // no suma 100
  assert.strictEqual(normalizeOwners(null).owners[0].pct, 100);
});

test("boxFor: referencias de caja correctas por entidad", () => {
  assert.strictEqual(boxFor("Interest income", "1065"), "Line 5");
  assert.strictEqual(boxFor("Interest income", "1120-S"), "Line 4");
  assert.strictEqual(boxFor("Net Section 1231 gain", "1065"), "Line 10");
  assert.strictEqual(boxFor("Net Section 1231 gain", "1120-S"), "Line 9");
  assert.strictEqual(boxFor("Distributions", "1120-S"), "Line 16D");
});

test("K-1: total vivo al M-1 y columnas por socio = total × %", () => {
  const m1 = buildM1Sheet(RECON, "1120-S");
  const k1 = buildK1Sheet(m1, OWNERS, "1120-S");
  assert.strictEqual(k1.name, "Schedule K-1 Allocation");
  const ordinaria = k1.rows.find((r) => /ordinary business income/i.test(String(r[1] || "")));
  assert.match(F(ordinaria[2]), /^'Book to Tax \(M-1\)'!B\d+$/);
  // 187450.20 + 2315.40 - 12840.75 - 54300 - 125.60 = 122499.25
  assert.strictEqual(V(ordinaria[2]), 122499.25);
  assert.strictEqual(V(ordinaria[3]), 73499.55);  // 60%
  assert.strictEqual(V(ordinaria[4]), 48999.7);   // 40%
  assert.match(F(ordinaria[3]), /^\$C\d+\*D\$\d+\/100$/); // % editable como driver
  // Separately stated presentes con su caja
  const g1231 = k1.rows.find((r) => /1231/i.test(String(r[1] || "")));
  assert.strictEqual(g1231[0], "Line 9");
  assert.strictEqual(V(g1231[3]), 32580); // 54300 × 60%
});

test("K-1: sin evidencia de owners → single owner 100% con flag NEEDS REVIEW", () => {
  const m1 = buildM1Sheet(RECON, "1065");
  const k1 = buildK1Sheet(m1, [], "1065");
  assert.match(String(k1.rows[1][0]), /NEEDS REVIEW/);
  const ordinaria = k1.rows.find((r) => /ordinary business income/i.test(String(r[1] || "")));
  assert.strictEqual(V(ordinaria[3]), V(ordinaria[2])); // 100%
});

test("K-1: null para entidades sin K-1 (1040/1120/blank)", () => {
  const m1 = buildM1Sheet(RECON, "1120");
  assert.strictEqual(buildK1Sheet(m1, OWNERS, "1120"), null);
  assert.strictEqual(buildK1Sheet(m1, OWNERS, "1040"), null);
  assert.strictEqual(buildK1Sheet(m1, OWNERS, ""), null);
});

test("round-trip: M-1 + K-1 al Excel real — cadena viva, cero #REF", async () => {
  const m1 = buildM1Sheet(RECON, "1120-S");
  const k1 = buildK1Sheet(m1, OWNERS, "1120-S");
  const buffer = await buildStyledWorkpaperXlsx({ sheets: [m1, k1] });
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(buffer);
  let refErrors = 0, crossToM1 = 0;
  out.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => {
    const f = c.value && c.value.formula;
    if (f) {
      if (String(f).includes("#REF")) refErrors += 1;
      if (String(f).includes("'Book to Tax (M-1)'!")) crossToM1 += 1;
    }
  })));
  assert.strictEqual(refErrors, 0);
  assert.ok(crossToM1 >= 4, `esperaba >=4 links al M-1, hay ${crossToM1}`);
});
