"use strict";
// El año que se prepara lo elige el preparador, y esa eleccion llega al modelo.
//
// Antes la tab mandaba un campo oculto que decia 2024 y el servidor tomaba el año mas alto de
// los NOMBRES de los archivos: un mayor exportado hasta 2026 con "2026" en el nombre convertia
// un workpaper de 2025 en uno de 2026. Estos tests fijan las dos mitades del arreglo: la
// eleccion manda sobre los nombres, y el prompt le dice al modelo que deje afuera lo que no es
// de ese año. Y que sin eleccion todo sigue igual que antes.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  reconcilePreparationYear, explicitPreparationYear, resolvePreparationYear, preparationPeriodRule,
} = require("../lib/preparation-year");

const files = (...names) => names.map((name) => ({ name }));

test("un año valido se acepta tal cual; cualquier otra cosa no es un año", () => {
  assert.strictEqual(explicitPreparationYear("2025"), "2025");
  assert.strictEqual(explicitPreparationYear(" 2025 "), "2025");
  assert.strictEqual(explicitPreparationYear(2025), "2025");
  for (const bad of ["", "25", "2025a", "1999", "FY2025", null, undefined]) {
    assert.strictEqual(explicitPreparationYear(bad), "", `"${bad}" no deberia valer como año`);
  }
});

test("el año elegido manda: un archivo con 2026 en el nombre no lo cambia", () => {
  const chosen = resolvePreparationYear(
    { taxYear: "2025", taxYearSelected: true },
    files("General Ledger Jan 2025 - Mar 2026.pdf", "Balance Sheet.xlsx"),
  );
  assert.deepStrictEqual(chosen, { taxYear: "2025", selected: true });
});

test("tambien cuando se elige un año anterior al de los archivos, como una declaracion atrasada", () => {
  const chosen = resolvePreparationYear({ taxYear: "2024", taxYearSelected: true }, files("P&L 2025.xlsx"));
  assert.deepStrictEqual(chosen, { taxYear: "2024", selected: true });
});

test("sin eleccion todo sigue como antes: gana el año mas reciente de los nombres", () => {
  // Es lo que manda una pestaña con la pagina vieja abierta: el 2024 del campo oculto.
  assert.deepStrictEqual(
    resolvePreparationYear({ taxYear: "2024" }, files("P&L 2025.xlsx")),
    { taxYear: "2025", selected: false },
  );
  // Una eleccion que no es un año tampoco vale: se reconcilia como antes.
  assert.deepStrictEqual(
    resolvePreparationYear({ taxYear: "abc", taxYearSelected: true }, files("P&L 2025.xlsx")),
    { taxYear: "2025", selected: false },
  );
  assert.deepStrictEqual(resolvePreparationYear({}, []), { taxYear: "", selected: false });
});

test("la reconciliacion contra los nombres no cambio", () => {
  assert.strictEqual(reconcilePreparationYear("2024", files("x 2025.pdf")), "2025");
  assert.strictEqual(reconcilePreparationYear("2025", files("x 2024.pdf")), "2025");
  assert.strictEqual(reconcilePreparationYear("", files("sin año.pdf")), "");
  assert.strictEqual(reconcilePreparationYear("abc", []), "abc");
});

test("la regla del periodo cubre columnas, saldos y transacciones de otros años", () => {
  const rule = preparationPeriodRule("2025");
  assert.match(rule, /tax year 2025/);
  assert.match(rule, /2025 next to 2024, or months or quarters that run into 2026/);
  assert.match(rule, /December 31, 2025/);
  assert.match(rule, /leave out every transaction dated outside the 2025 tax year/);
  assert.match(rule, /fiscal year that begins in 2025/);
  assert.match(rule, /AI Notes/);
  assert.strictEqual(preparationPeriodRule(""), "");
  assert.strictEqual(preparationPeriodRule("abc"), "");
});

// buildPreparerContent vive en server.js y no se exporta; se toma de ahi para probar el texto
// que de verdad recibe el modelo, no una copia. Sus ayudantes se reemplazan por versiones
// minimas: con un paquete sin archivos no hacen nada.
const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no encontre ${name} en server.js`);
  return src.slice(start, src.indexOf("\n}", start) + 2);
};
// eslint-disable-next-line no-new-func
const buildPreparerContent = new Function(
  "preparationPeriodRule", "softwareDisplayName", "RECONCILIATION_PROMPT_LINES", "collectScannedPdfDocuments",
  "stripAmountsFromTemplate", "csvTextFromTemplates", "stripFinancialAmountsFromText", "safeJsonForPrompt",
  `${grab("buildPreparerContent")}\nreturn buildPreparerContent;`,
)(
  preparationPeriodRule, () => "ProConnect Tax", [], () => ({ scannedDocs: [], skippedScans: [] }),
  (x) => x, () => "", (x) => x, () => "",
);
const promptFor = (metadata) => buildPreparerContent({ metadata: { instructions: "Prepare the workpaper.", ...metadata }, files: [] })
  .filter((block) => block.type === "text").map((block) => block.text).join("\n");

test("el año elegido llega al texto que recibe el modelo", () => {
  const prompt = promptFor({ taxYear: "2025", taxYearSelected: true });
  assert.match(prompt, /TAX YEAR CONTEXT: You are preparing the workpaper for TAX YEAR 2025/);
  assert.match(prompt, /SELECTED TAX YEAR: the preparer chose tax year 2025 in the app/);
});

test("sin eleccion el prompt es el de siempre, sin la regla nueva", () => {
  const prompt = promptFor({ taxYear: "2025" });
  assert.match(prompt, /TAX YEAR CONTEXT: You are preparing the workpaper for TAX YEAR 2025/);
  assert.doesNotMatch(prompt, /SELECTED TAX YEAR/);
});
