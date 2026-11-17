"use strict";
// Estimated Taxes: la zona 5 ("Additional documents") se mandaba desde la pantalla pero el
// servidor la descartaba al armar la lista de archivos, y el modelo nunca la veia. Ahora entra
// con su rol, se lee como W-2 / 1099 / K-1 por el titulo del formulario, y cada archivo queda
// en el registro de lectura aunque el modelo no lo mencione. Se prueban las funciones reales
// de server.js, tomadas del archivo. Datos inventados.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no encontre ${name} en server.js`);
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
};
const names = [
  "normalizeEstimatedTaxesPayload", "normalizeEstimatedEntityTypeServer", "estimatedEntityDisplayName",
  "normalizeEstimatedPeriod", "estimatedTemplatePathForEntity", "detectEstimatedDocumentType",
  "detectEstimatedSupportingDocType", "classifyEstimatedTaxFile", "estimatedRolePurpose",
  "buildEstimatedDocumentBlocks", "estimatedDocumentExtractionChecklist", "detectEstimatedTaxPeriod",
  "safeJsonForPrompt", "normalizeEstimatedFileReadingLog", "buildEstimatedTaxesCompletePrompt",
];
// eslint-disable-next-line no-new-func
const fns = new Function("path", "ROOT", `${names.map(grab).join("\n\n")}\nreturn { ${names.join(", ")} };`)(path, "/app");

const w2Text = [
  "Form W-2 Wage and Tax Statement 2025",
  "a Employee's social security number XXX-XX-0000",
  "c Employer's name Sample Widgets LLC",
  "1 Wages, tips, other compensation 84,000.00  2 Federal income tax withheld 9,100.00",
  "16 State wages 84,000.00  17 State income tax 3,900.00",
  "Box 1. Enter this amount on the wages line of your tax return (Form 1040).",
].join("\n");
const voucherText = "2025 Form 1040-ES Estimated Tax Payment Voucher 2 Amount of estimated tax you are paying by check 4,000.00";
const plText = "Sample Widgets LLC Profit and Loss January through June 2025\nSales 300,000.00\nNet Income 60,000.00";
const priorReturnText = "Form 1040 U.S. Individual Income Tax Return 2024\n11 Adjusted gross income 150,000\n24 Total tax 22,000";

const screenPayload = () => ({
  entityType: "1040",
  period: "Q2",
  plFile: { name: "P&L Jan-Jun 2025.xlsx", role: "current_year_pl", text: plText },
  taxReturnFiles: [{ name: "2024 return.pdf", role: "prior_year_return", text: priorReturnText }],
  additionalFiles: [
    { name: "Employer W-2.pdf", role: "supporting_document", text: w2Text },
    { name: "Q1 voucher.pdf", role: "supporting_document", text: voucherText },
    { name: "Brokerage 1099.pdf", role: "supporting_document", text: "Form 1099-DIV 2025 1a Total ordinary dividends 2,400.00 4 Federal income tax withheld 0.00" },
  ],
});

// Lo mismo que hace buildEstimatedTaxFileContext antes de armar los bloques.
const enrich = (files) => files.map((file) => ({
  ...file,
  estimatedRole: fns.classifyEstimatedTaxFile(file),
  estimatedPeriod: fns.detectEstimatedTaxPeriod(file),
  detectedDocType: fns.detectEstimatedDocumentType(file),
}));

test("los documentos adicionales llegan a la lista de archivos con su rol", () => {
  const normalized = fns.normalizeEstimatedTaxesPayload(screenPayload());
  assert.deepStrictEqual(normalized.files.map((file) => [file.name, file.role]), [
    ["P&L Jan-Jun 2025.xlsx", "current_year_pl"],
    ["2024 return.pdf", "prior_year_return"],
    ["Employer W-2.pdf", "supporting_document"],
    ["Q1 voucher.pdf", "supporting_document"],
    ["Brokerage 1099.pdf", "supporting_document"],
  ]);
  assert.strictEqual(normalized.additionalFiles.length, 3);
});

test("un pedido que solo trae files[] tambien los conserva", () => {
  const { plFile, additionalFiles } = screenPayload();
  const normalized = fns.normalizeEstimatedTaxesPayload({ entityType: "1040", files: [plFile, ...additionalFiles] });
  assert.deepStrictEqual(normalized.files.filter((file) => file.role === "supporting_document").map((file) => file.name),
    ["Employer W-2.pdf", "Q1 voucher.pdf", "Brokerage 1099.pdf"]);
});

test("cada adicional se lee por lo que es, sin pasar por plantilla, P&L ni declaracion", () => {
  const files = enrich(fns.normalizeEstimatedTaxesPayload(screenPayload()).files);
  const byName = Object.fromEntries(files.map((file) => [file.name, file]));
  // El W-2 dice "Form 1040" en sus instrucciones: antes quedaba como declaracion del año anterior.
  assert.strictEqual(byName["Employer W-2.pdf"].estimatedRole, "supporting_document");
  assert.strictEqual(byName["Employer W-2.pdf"].detectedDocType, "W2_DOCUMENT");
  // El voucher dice "estimated tax 2025": antes quedaba como plantilla y se ignoraban sus numeros.
  assert.strictEqual(byName["Q1 voucher.pdf"].estimatedRole, "supporting_document");
  assert.strictEqual(byName["Brokerage 1099.pdf"].detectedDocType, "1099_DOCUMENT");
  // Las otras zonas no cambian.
  assert.strictEqual(byName["P&L Jan-Jun 2025.xlsx"].estimatedRole, "current_year_pl");
  assert.strictEqual(byName["2024 return.pdf"].estimatedRole, "prior_year_return_1040");
  assert.strictEqual(byName["2024 return.pdf"].detectedDocType, "1040_RETURN");
  // Una declaracion completa subida en la zona 5 se sigue reconociendo por su titulo.
  assert.strictEqual(fns.detectEstimatedDocumentType({ role: "supporting_document", name: "x.pdf", text: priorReturnText }), "1040_RETURN");
  assert.strictEqual(fns.detectEstimatedDocumentType({ role: "supporting_document", name: "Fund K-1.pdf", text: "Shareholder's Share of Income" }), "K1_DOCUMENT");
  assert.strictEqual(fns.detectEstimatedDocumentType({ role: "supporting_document", name: "letter.pdf", text: "Notice CP14 balance due" }), "OTHER");
});

test("el prompt trae el bloque de cada adicional, la regla 11 y el lugar en el registro", () => {
  const blocks = fns.buildEstimatedDocumentBlocks(enrich(fns.normalizeEstimatedTaxesPayload(screenPayload()).files));
  assert.match(blocks, /DOCUMENT 3: Employer W-2\.pdf\nDETECTED TYPE: W2_DOCUMENT\nROLE: supporting_document/);
  assert.match(blocks, /ADDITIONAL SUPPORTING DOCUMENT \(Zone 5\)/);
  assert.match(blocks, /Box 1 wages, Box 2 federal withholding/);
  assert.match(blocks, /2 Federal income tax withheld 9,100\.00/);
  assert.match(blocks, /DOCUMENT 5: Brokerage 1099\.pdf\nDETECTED TYPE: 1099_DOCUMENT/);
  const prompt = fns.buildEstimatedTaxesCompletePrompt({ entityType: "1040", period: "Q2" }, { documentBlocks: blocks });
  assert.match(prompt, /11\. Files with ROLE supporting_document are the Zone 5 additional documents/);
  assert.match(prompt, /"additional": \[\{"fileName":"string","documentType":"string"/);
  assert.match(prompt, /DOCUMENT 4: Q1 voucher\.pdf/);
});

test("el registro de lectura muestra cada adicional, lo mencione o no el modelo", () => {
  const payload = fns.normalizeEstimatedTaxesPayload(screenPayload());
  const rows = fns.normalizeEstimatedFileReadingLog({
    pl: { fileName: "P&L Jan-Jun 2025.xlsx", status: "read", months: 6 },
    returns: [{ fileName: "2024 return.pdf", status: "read", formsFound: ["1040"] }],
    additional: [{ fileName: "Employer W-2", documentType: "W-2", status: "read", notes: "Box 2 withholding used." }],
  }, payload);
  const additional = rows.filter((row) => /^Additional document/.test(row.purpose));
  assert.deepStrictEqual(additional.map((row) => [row.fileName, row.purpose, row.status]), [
    ["Employer W-2", "Additional document - W-2", "read"],
    ["Q1 voucher.pdf", "Additional document", "not reported"],
    ["Brokerage 1099.pdf", "Additional document", "not reported"],
  ]);
  // Sin adicionales el registro queda como antes.
  const before = fns.normalizeEstimatedFileReadingLog({ pl: { fileName: "P&L.xlsx" } }, { plFile: { name: "P&L.xlsx" } });
  assert.deepStrictEqual(before.map((row) => row.purpose), ["Current-year P&L"]);
});
