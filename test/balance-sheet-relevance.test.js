"use strict";
// Una declaracion individual no tiene Schedule L: un 1040 con un archivo llamado "workpaper"
// recibia en cada corrida la pregunta "Complete and document the Schedule L balance sheet
// tie-out". Las entidades siguen pidiendola. Datos inventados.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");
const start = src.indexOf("function hasBalanceSheetRelevantFiles(");
// eslint-disable-next-line no-eval
const relevant = eval(`(${src.slice(start, src.indexOf("\n}\n", start) + 2)})`);

const pkg = (returnType, names) => ({ metadata: { returnType }, files: names.map((name) => ({ name, reviewRole: "supporting_document" })) });

test("un 1040 con workpaper no pide el Schedule L", () => {
  for (const type of ["1040", "1040-NR", "1040NR", "1040-SR"]) {
    assert.strictEqual(relevant(pkg(type, ["Client 2025 1040 workpaper.xlsx"])), false, type);
  }
});

test("las entidades lo siguen pidiendo, y un tipo desconocido se decide por los archivos", () => {
  for (const type of ["1120", "1120-S", "1065", "1041"]) assert.strictEqual(relevant(pkg(type, [])), true, type);
  assert.strictEqual(relevant(pkg("", ["balance sheet 2025.pdf"])), true);
  assert.strictEqual(relevant(pkg("", ["W2.pdf"])), false);
});
