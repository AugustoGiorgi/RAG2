"use strict";
// El paso de concision, y la nota de una guarda que borraba.
//
// enforceReviewConciseness vacia riskAnalysis en todo hallazgo LOW: un ensayo de riesgo sobre
// algo informativo es justo el ruido que hay que cortar. Pero las guardas SIEMPRE degradan a
// LOW y escriben ahi su explicacion, asi que la regla borraba la nota de cada guarda apenas
// se escribia. Tres corridas seguidas dijeron "10 finding(s) lowered to LOW after being
// checked against the documents" y el documento no mostro ni una sola contradiccion. Los
// contadores nunca mintieron: el texto se borraba mas abajo.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { verifyAttachmentClaims } = require("../lib/review-guards");

// enforceReviewConciseness vive en server.js y no se exporta; se toma de ahi para que el test
// no pueda quedar probando una copia que diverge.
const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no encontre ${name} en server.js`);
  return src.slice(start, src.indexOf("\n}", start) + 2);
};
// eslint-disable-next-line no-new-func
const enforceReviewConciseness = new Function(
  [grab("limitSentences"), grab("isConfirmedRoundingNonIssue"), grab("isSelfDeclaredNonIssue"), grab("enforceReviewConciseness")].join("\n")
  + "\nreturn enforceReviewConciseness;",
)();

const issue = (over) => ({
  priority: "MEDIUM", category: "x", areaReviewed: "x", formOrSchedule: "x",
  issueDescription: "", evidence: "", riskAnalysis: "", proposedSolution: "", authority: "", source: "",
  ...over,
});

const PAQUETE = {
  name: "Client 1120 2025.pdf",
  reviewRole: "current_return",
  fullText: `U.S. Corporation Income Tax Return
SCHEDULE B-1 Information on Partners Owning 50% or More of the Partnership
${"relleno para que la declaracion pase el largo minimo. ".repeat(20)}`,
};

test("la nota de una guarda sobrevive al paso de concision", () => {
  const review = { issues: [issue({
    priority: "HIGH",
    issueDescription: "Schedule B-1 is not attached to the return package.",
  })] };
  const guarded = verifyAttachmentClaims(review, [PAQUETE]);
  assert.strictEqual(guarded.corrected, 1);
  assert.strictEqual(guarded.issues[0].priority, "LOW");
  assert.match(guarded.issues[0].riskAnalysis, /CONTRADICTED BY THE PACKAGE/);

  const final = { issues: guarded.issues };
  enforceReviewConciseness(final);
  assert.match(
    final.issues[0].riskAnalysis, /CONTRADICTED BY THE PACKAGE/,
    "la concision borro la explicacion de por que el hallazgo quedo en LOW",
  );
  assert.match(final.issues[0].riskAnalysis, /schedule b-1/i, "y con ella la cita de donde esta el anexo");
});

test("un LOW normal del modelo sigue perdiendo su ensayo de riesgo", () => {
  // La regla original vale: en un hallazgo informativo el riesgo es ruido.
  const final = { issues: [issue({
    priority: "LOW",
    issueDescription: "Verify the address format against the state record.",
    riskAnalysis: "The IRS may take issue with an abbreviated street name on future filings.",
  })] };
  enforceReviewConciseness(final);
  assert.strictEqual(final.issues[0].riskAnalysis, "");
});

test("un HIGH conserva su riesgo, recortado a una frase", () => {
  const final = { issues: [issue({
    priority: "HIGH",
    issueDescription: "Taxable income is understated.",
    riskAnalysis: "The deduction was never reduced. A second sentence that should be cut. And a third one.",
  })] };
  enforceReviewConciseness(final);
  assert.match(final.issues[0].riskAnalysis, /The deduction was never reduced/);
  assert.doesNotMatch(final.issues[0].riskAnalysis, /a third one/);
});
