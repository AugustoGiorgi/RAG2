"use strict";
// Lo que el informe puede llevar cuando sale.
//
// Tres corridas seguidas llevaron cosas que no debian: el numero de cuenta bancaria completo de
// una declaracion anterior, una lista con todos los SSN que nadie habia pedido, y el formulario
// de firma reportado como faltante cuando estaba en la declaracion. Numeros y nombres ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  prepareReviewForDelivery, maskText, dropUnrequestedLines, isFilingPaperworkClaim,
} = require("../lib/report-delivery");

/* --- Identificadores ----------------------------------------------------- */

test("un SSN queda con los ultimos cuatro digitos", () => {
  assert.strictEqual(maskText("Taxpayer SSN 123-45-6789 matches"), "Taxpayer SSN XXX-XX-6789 matches");
});

test("un SSN sin guiones solo se toca si una etiqueta dice que lo es", () => {
  assert.strictEqual(maskText("SSN 123456789 on the state form"), "SSN XXX-XX-6789 on the state form");
  assert.strictEqual(maskText("Routing number 021000021"), "Routing number 021000021", "nueve digitos sueltos pueden ser una ruta bancaria");
});

test("lo que tiene forma parecida y no es un SSN queda como esta", () => {
  for (const text of [
    "Parcel 47-001-02-0084-001",   // el numero de parcela trae un 001-02-0084 adentro
    "Call (555) 010-4477 or 555-010-4478",
    "Example LLC EIN 12-3456789",
    "Generated 2026-09-16",
  ]) {
    assert.strictEqual(maskText(text), text);
  }
});

test("una cuenta bancaria con etiqueta queda truncada; la ruta no se toca", () => {
  assert.strictEqual(maskText("Routing 021000021, Account 580251515"), "Routing 021000021, Account *****1515");
  assert.strictEqual(maskText("021000021-580251515"), "021000021-*****1515");
});

test("lo que ya viene truncado y los importes no se tocan", () => {
  const text = "Account ******6905, account ending in 8023, Accounts receivable 787,444, account 1,234.56";
  assert.strictEqual(maskText(text), text);
});

test("una licencia de conducir con etiqueta queda truncada", () => {
  assert.strictEqual(maskText("Driver license number A422000000121 used as ID"), "Driver license number ********0121 used as ID");
});

test("la mascara llega a cualquier parte del informe", () => {
  const { review } = prepareReviewForDelivery({
    issues: [{ evidence: "Dependent SSN 123-45-6789" }],
    infoConsistency: [{ item: "Spouse SSN", returnValue: "987-65-4321", sourceValue: "987-65-4321", status: "MATCH" }],
    executiveSummary: "Refund to account 580251515.",
  });
  assert.strictEqual(review.issues[0].evidence, "Dependent SSN XXX-XX-6789");
  assert.strictEqual(review.infoConsistency[0].returnValue, "XXX-XX-4321");
  assert.strictEqual(review.executiveSummary, "Refund to account *****1515.");
});

test("si dos numeros distintos quedan iguales al taparlos, la fila dice donde mirar", () => {
  const { review } = prepareReviewForDelivery({
    infoConsistency: [{ item: "Dependent SSN", returnValue: "111-22-3045", sourceValue: "999-22-3045", status: "MISMATCH" }],
  });
  const row = review.infoConsistency[0];
  assert.strictEqual(row.returnValue, row.sourceValue);
  assert.match(row.note, /differ only in digits hidden/);
});

test("el informe original no se modifica", () => {
  const original = { executiveSummary: "SSN 123-45-6789" };
  prepareReviewForDelivery(original);
  assert.strictEqual(original.executiveSummary, "SSN 123-45-6789");
});

/* --- Pedidos que nadie hizo --------------------------------------------- */

const LINES = [
  "Form 1040 line 11 ties.",
  "REQUESTED: List of every EIN and SSN found in the return — SSN 123-45-6789 ...",
  "REQUESTED: No user-specific requests were included in the review instructions.",
];

test("sin instrucciones del estudio, las lineas REQUESTED se van", () => {
  const { items, dropped } = dropUnrequestedLines(LINES, "");
  assert.deepStrictEqual(items, ["Form 1040 line 11 ties."]);
  assert.strictEqual(dropped, 2);
});

test("con instrucciones, la respuesta queda y el 'no se pidio nada' se va igual", () => {
  const { items } = dropUnrequestedLines(LINES, "List every EIN and SSN found in the return.");
  assert.strictEqual(items.length, 2);
  assert.ok(items.some((l) => /List of every EIN/.test(l)));
  assert.ok(!items.some((l) => /No user-specific/.test(l)));
});

/* --- Formularios de firma reportados como faltantes --------------------- */

test("el 8879 reportado como faltante se descarta", () => {
  for (const line of [
    "Form 8879 IRS e-file Signature Authorization and NJ-8879 (excluded from the page range sent — page not provided)",
    "Page 11 of the current return (Form 8879-PE e-file signature authorization) was not provided",
    "Form 8879-CORP not included in the package",
  ]) {
    assert.strictEqual(isFilingPaperworkClaim(line, false), true, line);
  }
});

test("un faltante real queda aunque mencione un formulario de firma", () => {
  assert.strictEqual(isFilingPaperworkClaim("Schedule K-1 from Example LLC", false), false);
  assert.strictEqual(isFilingPaperworkClaim("W-2 from Example Corp and the signed 8879", false), false, "el W-2 si puede faltar");
});

test("en preguntas abiertas solo se descarta si afirma que falta", () => {
  assert.strictEqual(isFilingPaperworkClaim("Was Form 8879 signed before transmission?", true), false);
  assert.strictEqual(isFilingPaperworkClaim("Form 8879 was not provided — can it be sent?", true), true);
});

test("todo junto sobre un informe", () => {
  const { review, dropped } = prepareReviewForDelivery({
    verifiedItems: LINES,
    missingDocuments: ["Schedule K-1 from Example LLC", "Form 8879 not provided"],
    openQuestions: ["Form 8879 was not included — please provide", "Confirm the move date."],
  }, { userNotes: "" });
  assert.deepStrictEqual(review.missingDocuments, ["Schedule K-1 from Example LLC"]);
  assert.deepStrictEqual(review.openQuestions, ["Confirm the move date."]);
  assert.strictEqual(review.verifiedItems.length, 1);
  assert.strictEqual(dropped, 4);
});
