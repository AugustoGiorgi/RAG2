"use strict";
// El Analyze de Tax Planning lee los PDF como texto y no como una imagen de cada pagina.
// Una planificacion con dos declaraciones de 40 paginas costaba $1,67, casi todo en imagenes.
// Estos tests fijan que paginas se sacan, que se conserva, y los topes. Datos inventados.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  stripDotLeaders, isBoilerplatePage, hasTextLayer, pdfPagesToText, fitTextBudget, packPlanningPdfs,
} = require("../lib/planning-input");

const page = (num, text) => ({ num, text });
const filler = "x".repeat(300);

test("las lineas de puntos se van y quedan la etiqueta y el importe", () => {
  assert.strictEqual(stripDotLeaders("1a Wages . . . . . . . . . 1a 85,000."), "1a Wages 1a 85,000.");
  assert.strictEqual(stripDotLeaders("Total ......... 12,300"), "Total 12,300");
  assert.strictEqual(stripDotLeaders("Form 1040 (2025)"), "Form 1040 (2025)", "un punto solo no es una linea de puntos");
});

test("se sacan las paginas que no aportan, mirando solo el titulo", () => {
  assert.ok(isBoilerplatePage("IRS e-file Signature Authorization\tForm 8879\nERO must obtain..."));
  assert.ok(isBoilerplatePage("Form 7004 Application for Automatic Extension of Time To File\n..."));
  assert.ok(isBoilerplatePage("State of Somewhere Taxation Department\n2025 S-CORP-EXT Sub-Chapter S..."));
  assert.ok(isBoilerplatePage("Form Payment Record\nName of Bank TEST BANK"));
  // La carta del contador menciona el 8879 en el cuerpo, y la hoja de informacion general lista
  // la 7004 entre los formularios: las dos se quedan.
  assert.ok(!isBoilerplatePage("DEMO CPA LLC\n100 MAIN ST\nCITY, ST 00000\nPlease sign Form 8879 and return it."));
  assert.ok(!isBoilerplatePage("FORMS NEEDED FOR THIS RETURN\nFEDERAL: 1120S, SCH K-1, 4562, 7004, 7203\nSTATE: S-CORP-EXT"));
  assert.ok(!isBoilerplatePage("2025 FEDERAL INCOME TAX SUMMARY PAGE 1\nWAGES, SALARIES, TIPS 41,810"));
});

test("un escaneo no tiene capa de texto", () => {
  assert.ok(hasTextLayer([page(1, filler), page(2, filler)]));
  assert.ok(!hasTextLayer([page(1, ""), page(2, " 1 ")]));
  assert.ok(!hasTextLayer([]));
});

test("el texto de un PDF va pagina por pagina, sin las paginas de tramite", () => {
  const out = pdfPagesToText([
    page(1, `DEMO CPA LLC\nCover letter\n${filler}`),
    page(2, `IRS e-file Signature Authorization\tForm 8879\n${filler}`),
    page(3, `Form 1040 (2025)\nWages . . . . . . . 1a 85,000.\n${filler}`),
  ]);
  assert.deepStrictEqual(out.dropped, [2]);
  assert.strictEqual(out.kept, 2);
  assert.match(out.text, /--- Page 1 ---\nDEMO CPA LLC/);
  assert.match(out.text, /--- Page 3 ---\nForm 1040 \(2025\)\nWages 1a 85,000\./);
  assert.doesNotMatch(out.text, /8879/);
});

test("el tope de texto deja enteros a los chicos y corta a los largos por pagina", () => {
  const small = { name: "chico", text: "a".repeat(100) };
  const big = { name: "largo", text: Array.from({ length: 10 }, (_, i) => `--- Page ${i + 1} ---\n${"b".repeat(1000)}`).join("\n") };
  const fitted = fitTextBudget([small, big], 3100);
  assert.strictEqual(fitted[0].text, small.text);
  assert.strictEqual(fitted[0].cut, false);
  assert.strictEqual(fitted[1].cut, true);
  assert.ok(fitted[1].text.length <= 3100);
  assert.match(fitted[1].text, /--- Page 2 ---[\s\S]*\[Remaining pages of this file omitted for length\.\]$/);
  assert.deepStrictEqual(fitTextBudget([small], 3100), [{ ...small, cut: false }], "si entra, no se toca");
});

test("cada PDF viaja como texto o como documento, con el tope de escaneos", () => {
  const textPdf = { name: "return.pdf", pages: [page(1, `Form 1040\n${filler}`), page(2, `Form 8879\n${filler}`)], total: 2 };
  const scan = (name, total) => ({ name, content: "AAAA", pages: Array.from({ length: total }, (_, i) => page(i + 1, "")), total });
  const out = packPlanningPdfs([textPdf, scan("scan-a.pdf", 30), scan("scan-b.pdf", 20), { name: "broken.pdf", content: "AAAA", failed: true }], { scannedPageCap: 40 });
  assert.deepStrictEqual(out.texts.map((t) => t.name), ["return.pdf"]);
  assert.match(out.texts[0].text, /^FILE: return\.pdf\nROLE: other\n--- Page 1 ---/);
  assert.deepStrictEqual(out.dropped, [{ name: "return.pdf", pages: [2] }]);
  assert.deepStrictEqual(out.scanned.map((s) => [s.name, s.pages]), [["scan-a.pdf", 30]]);
  assert.deepStrictEqual(out.skipped, ["scan-b.pdf", "broken.pdf"]);
});
