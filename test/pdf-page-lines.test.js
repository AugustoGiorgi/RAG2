"use strict";
// pdfPageLines: reconstruccion de lineas visuales desde items de pdf.js.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const src = fs.readFileSync(require("node:path").join(__dirname, "..", "app.js"), "utf8");
// eslint-disable-next-line no-eval
const pdfPageLines = eval(`(${src.match(/function pdfPageLines[\s\S]*?\n}/)[0]})`);
const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });

test("junta la etiqueta con su importe pese al orden de dibujado", () => {
  // pdf.js entrega el formulario en blanco primero y las cifras despues. Aqui el importe
  // llega ultimo y con la baseline 1.7 unidades mas abajo, como en un 7203 real.
  const content = { items: [
    item("5 Stock basis before distributions", 59.6, 399.6),
    item("6 Distributions (excluding dividend distributions)", 59.6, 387.6),
    item("704,091.", 527.5, 385.9),
    item("621,409.", 527.5, 397.9),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "5 Stock basis before distributions 621,409.",
    "6 Distributions (excluding dividend distributions) 704,091.",
  ]);
});

test("no fusiona filas contiguas ni pierde el orden horizontal", () => {
  const content = { items: [
    item("b", 300, 500), item("a", 100, 500),
    item("fila siguiente", 100, 488),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), ["a b", "fila siguiente"]);
});

test("descarta items vacios y pagina sin texto", () => {
  assert.deepStrictEqual(pdfPageLines({ items: [item("   ", 10, 10)] }), []);
  assert.deepStrictEqual(pdfPageLines({ items: [] }), []);
  assert.deepStrictEqual(pdfPageLines({}), []);
});
