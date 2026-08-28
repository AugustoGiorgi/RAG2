"use strict";
// Qué secciones llegan realmente al .docx exportado.
//
// Dos campos poblados por la review resultaron no imprimirse nunca: openQuestions (renombrado
// a `questions` camino al generador) y verifiedItems (renombrado a `reviewerComments`). En
// ambos casos el contenido se generaba, se pagaba en tokens, y se descartaba en silencio al
// exportar. Este test fija el contrato: si el generador deja de imprimir una sección que la
// review llena, falla acá y no seis corridas después.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no encontré ${name}`);
  const end = src.indexOf("\n}", start);
  return src.slice(start, end + 2);
};
// eslint-disable-next-line no-eval
const build = eval(`(() => {
  const safeText = (v) => String(v == null ? "" : v);
  const escapeXml = (v) => String(v == null ? "" : v);
  ${grab("dxP")}
  ${grab("dxH")}
  ${grab("dxLabel")}
  ${grab("dxTable")}
  ${grab("buildStructuredReviewDocxXml")}
  return buildStructuredReviewDocxXml;
})()`);

const base = { issues: [], tieOutResults: [], checkboxReview: [], infoConsistency: [], missingDocuments: [] };

test("los nombres que produce normalizeReviewForExport son los que lee el generador", () => {
  // El normalizador renombra al exportar; el generador tiene que leer ESE nombre.
  const exportador = src.slice(src.indexOf("function normalizeReviewForExport"));
  const cuerpo = exportador.slice(0, exportador.indexOf("\n}"));
  assert.match(cuerpo, /questions: normalizeReviewStringArray/, "sigue renombrando openQuestions -> questions");
  assert.match(cuerpo, /reviewerComments: normalizeReviewStringArray/, "sigue renombrando verifiedItems -> reviewerComments");
  const generador = grab("buildStructuredReviewDocxXml");
  assert.match(generador, /structured\.questions/, "el generador debe leer `questions`");
  assert.match(generador, /structured\.reviewerComments/, "el generador debe leer `reviewerComments`");
});

test("imprime los items verificados, incluido el inventario de los adjuntos escaneados", () => {
  const xml = build({ ...base, reviewerComments: ["SCANNED: taxes.pdf — p1 1099-INT $1,699.30; p3 1098 $37,513.99"] });
  assert.match(xml, /Verified Items/);
  assert.match(xml, /1098 \$37,513\.99/);
});

test("acepta también el nombre original, para reviews ya guardadas", () => {
  const xml = build({ ...base, verifiedItems: ["item con el nombre viejo"] });
  assert.match(xml, /Verified Items/);
  assert.match(xml, /nombre viejo/);
});

test("sin items verificados no agrega la sección", () => {
  assert.doesNotMatch(build({ ...base }), /Verified Items/);
  assert.doesNotMatch(build({ ...base, reviewerComments: [], verifiedItems: [] }), /Verified Items/);
});
