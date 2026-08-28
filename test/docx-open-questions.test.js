"use strict";
// La sección "Open Questions" del .docx exportado.
//
// normalizeReviewForExport renombra openQuestions -> questions antes de llegar al generador,
// que leía solo el nombre original. La sección no se imprimía nunca: se perdían las preguntas
// abiertas del modelo y también los avisos que el servidor escribe en ese campo — qué
// archivos subidos no se leyeron, y el diagnóstico de composición del paquete.
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

test("imprime las preguntas abiertas cuando llegan como `questions`", () => {
  const xml = build({ ...base, questions: ["2 uploaded document(s) were never read", "DIAGNOSTIC: 4 scans attached"] });
  assert.match(xml, /Open Questions/);
  assert.match(xml, /never read/);
  assert.match(xml, /4 scans attached/);
});

test("sigue imprimiéndolas con el nombre original `openQuestions`", () => {
  const xml = build({ ...base, openQuestions: ["pregunta con el nombre viejo"] });
  assert.match(xml, /Open Questions/);
  assert.match(xml, /nombre viejo/);
});

test("sin preguntas no agrega la sección", () => {
  assert.doesNotMatch(build({ ...base }), /Open Questions/);
  assert.doesNotMatch(build({ ...base, questions: [], openQuestions: [] }), /Open Questions/);
});
