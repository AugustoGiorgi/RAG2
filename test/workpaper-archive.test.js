"use strict";
// Roll-forward de temporada: archivo por cliente, rotación, selección del año previo,
// y reconstrucción del template desde el xlsx archivado.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { saveWorkpaperToArchive, listArchive, loadNewestPriorWorkpaper, xlsxBufferToTemplate, templateToText } = require("../lib/workpaper-archive");
const { buildStyledWorkpaperXlsx } = require("../lib/xlsx-workpaper");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ragtax-arch-"));
const fakeXlsx = Buffer.from("PK-fake-not-read-by-save");

test("guardar + listar: orden nuevo→viejo y años correctos", () => {
  const dir = tmp();
  assert.ok(saveWorkpaperToArchive(dir, "client-1", "2024", fakeXlsx));
  assert.ok(saveWorkpaperToArchive(dir, "client-1", "2025", fakeXlsx));
  const list = listArchive(dir, "client-1");
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].taxYear, "2025");
  assert.strictEqual(list[1].taxYear, "2024");
  // otro cliente: vacío (aislado por carpeta)
  assert.deepStrictEqual(listArchive(dir, "client-2"), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ids peligrosos no escapan del directorio base", () => {
  const dir = tmp();
  assert.strictEqual(saveWorkpaperToArchive(dir, "../../etc", "2025", fakeXlsx)?.file?.includes(".."), false);
  assert.deepStrictEqual(listArchive(dir, "../.."), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadNewestPriorWorkpaper: toma el año ANTERIOR al preparado, no el actual", () => {
  const dir = tmp();
  saveWorkpaperToArchive(dir, "c1", "2024", Buffer.from("v2024"));
  saveWorkpaperToArchive(dir, "c1", "2025", Buffer.from("v2025"));
  const prior = loadNewestPriorWorkpaper(dir, "c1", "2026");
  assert.strictEqual(prior.taxYear, "2025");
  assert.strictEqual(prior.buffer.toString(), "v2025");
  const prior25 = loadNewestPriorWorkpaper(dir, "c1", "2025");
  assert.strictEqual(prior25.taxYear, "2024");
  assert.strictEqual(loadNewestPriorWorkpaper(dir, "c1", "2024"), null); // no hay más viejo
  fs.rmSync(dir, { recursive: true, force: true });
});

test("template desde xlsx archivado: sheets/rows reconstruidos y texto pipe-delimited", async () => {
  const buffer = await buildStyledWorkpaperXlsx({ sheets: [
    { name: "Profit and Loss", rows: [["Account", "Amount"], ["Sales", 1000.5], ["Total Income", 1000.5]] },
    { name: "AI Notes", rows: [["AI Notes"], ["nota"]] },
  ]});
  const template = await xlsxBufferToTemplate(Buffer.from(buffer), "workpaper-TY2025-x.xlsx");
  assert.strictEqual(template.sheets.length, 2);
  assert.strictEqual(template.sheets[0].name, "Profit and Loss");
  assert.deepStrictEqual(template.sheets[0].rows[1], ["Sales", "1000.5"]);
  const text = templateToText(template);
  assert.match(text, /--- Sheet: Profit and Loss ---/);
  assert.match(text, /Sales \| 1000\.5/);
});
