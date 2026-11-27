"use strict";
// Fotos sueltas en Review y Preparation. Antes las dos pestañas leian imagenes solo adentro de un
// ZIP: un JPG subido solo (desde la computadora, Drive u OneDrive) viajaba como nombre de archivo
// y el modelo nunca lo veia. Preparation ademas no adjuntaba ninguna imagen, ni las de un ZIP.
// Codigo real de server.js y app.js, tomado de los archivos. Datos inventados.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { collectImages } = require("../lib/review-attachments");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8").replace(/\r\n/g, "\n");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const grab = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no encontre ${name}`);
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
};
// eslint-disable-next-line no-new-func
const preparationImageBlocks = new Function(`${grab(server, "preparationImageBlocks")}\nreturn preparationImageBlocks;`)();

// Un JPEG minimo valido para collectImages (empieza con FF D8 FF).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]).toString("base64");

test("Preparation adjunta cada foto despues de una linea con su nombre", () => {
  const { images } = collectImages({ files: [
    { name: "W-2 photo.jpg", scannedImages: [{ name: "W-2 photo.jpg", data: JPEG }] },
    { name: "2025 P&L.xlsx", text: "Sales 100" },
  ] });
  const blocks = preparationImageBlocks(images, []);
  assert.deepStrictEqual(blocks.map((block) => block.type), ["text", "text", "image"]);
  assert.match(blocks[0].text, /^IMAGE FILES ATTACHED \(1\): .*READ THEM VISUALLY.*do NOT report them as missing: W-2 photo\.jpg\.$/);
  assert.strictEqual(blocks[1].text, "Image file: W-2 photo.jpg");
  assert.deepStrictEqual(blocks[2].source, { type: "base64", media_type: "image/jpeg", data: JPEG });
});

test("sin fotos no agrega nada; las que no entran se nombran como pendientes", () => {
  assert.deepStrictEqual(preparationImageBlocks([], []), []);
  const only = preparationImageBlocks([], ["huge scan.jpg"]);
  assert.strictEqual(only.length, 1);
  assert.match(only[0].text, /^NOT ATTACHED \(size or count limits — flag as pending in aiNotes\): huge scan\.jpg\.$/);
  const both = preparationImageBlocks([{ name: "a.jpg", mediaType: "image/jpeg", data: JPEG }], ["b.jpg"]);
  assert.match(both[0].text, /NOT ATTACHED .*: b\.jpg\.$/);
});

test("el pedido de Preparation suma las fotos despues de los PDF escaneados", () => {
  const builder = grab(server, "buildPreparerContent");
  assert.match(builder, /const \{ scannedDocs, skippedScans, scannedImages \} = collectScannedPdfDocuments\(payload\);/);
  assert.match(builder, /content\.push\(\.\.\.preparationImageBlocks\(scannedImages, scannedDocs\.length \? \[\] : skippedScans\)\);/);
});

test("el navegador prepara una foto suelta para Review y Preparation, no para el resto", () => {
  assert.match(app, /const LOOSE_IMAGE_TYPES = new Set\(\["preparationPackage"\]\);/);
  const prepare = grab(app, "prepareFileForReview");
  assert.match(prepare, /if \(\(zipImages \|\| LOOSE_IMAGE_TYPES\.has\(type\)\) && ZIP_IMAGE_EXTENSIONS\.includes\(ext\)\) \{/);
  assert.match(prepare, /scannedImages: \[await looseImageForReview\(file\)\]/);
  assert.match(prepare, /unreadEntries: \[displayFileName\(file\)\]/, "si no se puede preparar, queda como no leida");
  // Una foto que llega de Drive u OneDrive no es un Blob: trae el contenido en base64.
  assert.match(grab(app, "looseImageForReview"), /isBase64BackedFile\(file\)[\s\S]*new Blob\(\[base64ToArrayBuffer/);
  // La Review pide zipImages; Preparation manda su tipo.
  assert.match(app, /prepareFileForReview\(\{ \.\.\.item, zipImages: true \}\)/);
  assert.match(app, /prepareFileForReview\(\{ file, type: "preparationPackage" \}\)/);
});
