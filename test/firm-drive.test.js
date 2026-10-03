"use strict";
// Lo que no depende de Google para guardar las revisiones de una firma en Drive
// (lib/firm-drive.js): el nombre del archivo y el cuerpo de la subida. Datos ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const { safeDriveFileName, reviewDriveFileName, driveMultipartBody, DOCX_MIME } = require("../lib/firm-drive");

test("el nombre de archivo no lleva barras ni caracteres raros, y termina en .docx", () => {
  assert.strictEqual(safeDriveFileName("Acme / Co: 2025?"), "Acme - Co- 2025-.docx");
  assert.strictEqual(safeDriveFileName("Review.docx"), "Review.docx");
  assert.strictEqual(safeDriveFileName(""), "Review.docx");
});

test("el nombre de una revision dice de quien es y cuando se genero", () => {
  assert.strictEqual(reviewDriveFileName("Acme-Holdings-2025", "Ana Smith", "2026-10-03 1415"), "Acme-Holdings-2025 - Ana Smith - 2026-10-03 1415.docx");
  const fallback = reviewDriveFileName("Acme-Holdings-2025", "Ana Smith", "cualquier cosa");
  assert.match(fallback, /^Acme-Holdings-2025 - Ana Smith - \d{4}-\d{2}-\d{2} \d{4}\.docx$/, "una hora mal formada no se usa");
});

test("el cuerpo multipart lleva los metadatos y el archivo, en ese orden", () => {
  const file = Buffer.from("PK\u0003\u0004contenido");
  const { body, contentType } = driveMultipartBody({ name: "x.docx", parents: ["folder-1"], mimeType: DOCX_MIME }, file, DOCX_MIME, "frontera");
  assert.strictEqual(contentType, "multipart/related; boundary=frontera");
  const text = body.toString("latin1");
  assert.ok(text.startsWith("--frontera\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{\"name\":\"x.docx\",\"parents\":[\"folder-1\"]"));
  assert.ok(text.includes(`--frontera\r\nContent-Type: ${DOCX_MIME}\r\n\r\nPK`));
  assert.ok(text.endsWith("\r\n--frontera--"));
});
