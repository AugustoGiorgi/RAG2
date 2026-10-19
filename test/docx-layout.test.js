"use strict";
// El Word de la Review con su armado nuevo: la pagina 1 con el veredicto, los conteos y lo que la
// review no leyo; los HIGH en un cuadro; cada hallazgo como tarjeta con "What to do"; los LOW en
// un cuadro compacto; una sola lista de preguntas y documentos; y las tablas largas al final.
// Solo presentacion. Datos inventados.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no encontré ${name}`);
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
};
// eslint-disable-next-line no-eval
const { build, amount, footerText } = eval(`(() => {
  const safeText = (v) => (v == null ? "" : String(v).trim());
  const escapeXml = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  ${grab("safePriority")}
  ${grab("dxP")}
  ${grab("dxH")}
  ${grab("dxLabel")}
  ${grab("dxAmount")}
  ${grab("dxTable")}
  ${src.match(/^const REVIEW_SCOPE_ROW = .*$/m)[0]}
  ${grab("reviewScopeCount")}
  ${grab("reviewInfoMatchLabel")}
  ${grab("checkboxNeedsChange")}
  ${grab("reviewCheckboxSummary")}
  ${grab("reviewCheckboxLabel")}
  ${src.match(/^const REVIEW_CHECKBOX_ROWS_SHOWN = .*$/m)[0]}
  ${grab("reviewCheckboxDocxRows")}
  ${grab("reviewDocxFooterText")}
  ${grab("buildStructuredReviewDocxXml")}
  return { build: buildStructuredReviewDocxXml, amount: dxAmount, footerText: reviewDocxFooterText };
})()`);

const text = (xml) => xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\n\s*(?=\n)/g, "");
const issue = (priority, formOrSchedule, extra = {}) => ({ priority, formOrSchedule, areaReviewed: "Area", issueDescription: `${formOrSchedule} is wrong.`, proposedSolution: `Fix ${formOrSchedule}.`, ...extra });
const review = {
  filingReadiness: "NOT READY",
  executiveSummary: "Two errors.",
  issues: [
    issue("LOW", "Form 4868 — filing date", { riskAnalysis: "CONTRADICTED BY THE RETURN: the figure is printed on the return. Lowered to LOW automatically; read the cited line before acting on it." }),
    issue("HIGH", "Form 1040 line 1a — W-2 wages exceed the return", { taxImpact: 600, taxImpactLabel: "≈ $600 of tax ($5,000 × 12% marginal rate)", source: "Automated cross-year check", riskAnalysis: "This check runs deterministically on every review.", evidence: "Computed by RAG Tax AI directly from the filed returns in this package, not by the language model." }),
    issue("MEDIUM", "Form 8889", { riskAnalysis: "The HSA deduction may be lost.", authority: "N/A", source: "W2_Acme.pdf; current_return" }),
  ],
  questions: [
    "2 file(s) in the package were NOT read by this review — a format that cannot be read: photo.heic.",
    "Confirm the HDHP coverage type.",
  ],
  missingDocuments: ["Form 2441 for the dependent care benefits."],
  tieOutResults: [
    { lineItem: "Line 24 - Total tax", returnAmount: "7401", workpaperAmount: "7401", difference: "0", status: "TIE", note: "" },
    { lineItem: "Line 1a - Wages", returnAmount: "80000", workpaperAmount: "85000", difference: "-5000", status: "OUT_OF_BALANCE", note: "W-2s add to 85,000." },
  ],
  balanceSheetCheck: { totalAssets: "0", totalLiabEquity: "0", balanced: true },
};

test("la pagina 1: veredicto con conteos, y lo que no se leyo arriba, fuera de las preguntas", () => {
  const t = text(build(review, { clientName: "Ficticio SA", returnType: "1040", taxYear: "2025" }));
  assert.match(t, /FILING READINESS\nNOT READY/);
  assert.match(t, /^1\nHigh\n1\nMedium\n1\nLow\n2\nQuestions & documents$/m, "1 pregunta + 1 documento; el aviso de no leido no cuenta");
  assert.ok(t.indexOf("Limits of this review: 2 file(s)") < t.indexOf("Executive Summary"));
  assert.strictEqual(t.split("NOT read by this review").length - 1, 1, "el aviso va una sola vez");
});

test("los HIGH en su cuadro con el efecto; las tarjetas con What to do y sin el relleno", () => {
  const xml = build(review, {});
  const t = text(xml);
  assert.match(t, /Fix Before Filing — 1 high finding/);
  assert.match(t, /Form 1040 line 1a\nW-2 wages exceed the return\n≈ \$600/);
  assert.match(t, /Findings — 1 high · 1 medium · 1 low/);
  assert.match(t, /What to do: Fix Form 1040 line 1a — W-2 wages exceed the return\./);
  assert.match(t, /Tax effect \(estimate\): ≈ \$600 of tax/);
  assert.doesNotMatch(t, /This check runs deterministically/, "la frase fija de los cruces no se imprime");
  assert.doesNotMatch(t, /Computed by RAG Tax AI directly from the filed returns/);
  assert.doesNotMatch(t, /Authority: N\/A/);
  assert.match(t, /Why it matters: The HSA deduction may be lost\./);
  assert.match(t, /Source: W2_Acme\.pdf; this year's return/, "el rol interno se dice en palabras");
  assert.match(t, /computed by code/i);
});

test("el orden y la numeracion son por severidad, como en pantalla", () => {
  const t = text(build(review, {}));
  assert.ok(t.indexOf("1   Form 1040 line 1a") >= 0);
  assert.ok(t.indexOf("2   Form 8889") >= 0);
  assert.ok(t.indexOf("Low — for the file (1)") > t.indexOf("2   Form 8889"));
  assert.match(t, /Checked by the app|CONTRADICTED BY THE RETURN: the figure is printed on the return\./);
  assert.doesNotMatch(t, /Lowered to LOW automatically/, "en el cuadro de LOW queda el motivo, no la instruccion");
});

test("una sola lista para preguntar y pedir, y el apendice con lo que no ata primero", () => {
  const t = text(build(review, {}));
  assert.match(t, /Open Questions and Documents to Request\nQuestions\n☐  1\.  Confirm the HDHP coverage type\.\nDocuments to request\n☐  2\.  Form 2441/);
  assert.ok(t.indexOf("Appendix") > t.indexOf("Documents to request"));
  assert.match(t, /Numeric Tie-Out — 1 of 2 tie · 1 out of balance/);
  assert.ok(t.indexOf("Line 1a - Wages") < t.indexOf("Line 24 - Total tax"), "lo que no ata va primero");
  assert.match(t, /80,000\n85,000\n-5,000/);
  assert.doesNotMatch(t, /Balance Sheet Check/, "un balance en cero no se imprime");
});

test("el documento apunta al pie, que lleva cliente y declaracion", () => {
  assert.match(build(review, {}), /<w:footerReference w:type="default" r:id="rIdFooter1"\/>/);
  assert.match(footerText({ clientName: "Ficticio SA", returnType: "1040", taxYear: "2025" }), /^RAG Tax AI  ·  Senior review  ·  Ficticio SA  ·  1040  ·  Tax year 2025  ·  \d{4}-\d{2}-\d{2}$/);
});

test("los importes de las columnas de plata, con separador de miles; lo demas, como viene", () => {
  assert.strictEqual(amount("85000"), "85,000");
  assert.strictEqual(amount("-5000"), "-5,000");
  assert.strictEqual(amount("(218)"), "-218");
  assert.strictEqual(amount("$1,733.04"), "1,733.04");
  assert.strictEqual(amount("0"), "0");
  assert.strictEqual(amount("N/A"), null);
  assert.strictEqual(amount(""), null);
});
