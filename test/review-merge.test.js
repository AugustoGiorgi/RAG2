"use strict";
// Unir dos corridas del mismo paquete en un solo informe.
//
// Por que se corre dos veces, medido: cinco corridas identicas de un mismo 1120-S dieron 11, 7,
// 9, 8 y 4 hallazgos del modelo, y la union de las cinco son 28. Una sola corrida entrega el
// 28% de lo que el modelo es capaz de encontrar en ese paquete — no es que no lo vea, es que ve
// otra cosa cada vez.
//
// Lo dificil no es correr dos veces sino unir sin duplicar: un hallazgo repetido tiene que
// salir UNA vez, y dos hallazgos parecidos sobre cosas distintas tienen que salir los dos.
// Entidades y montos ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const { mergeReviews, mergeIssues, sameIssue, betterOf, subjectKey } = require("../lib/review-merge");

const issue = (over) => ({
  priority: "MEDIUM", formOrSchedule: "", issueDescription: "", evidence: "", ...over,
});

const BALANCE_A = issue({
  priority: "HIGH", formOrSchedule: "Form 1065 Schedule L",
  issueDescription: "Schedule L does not balance: assets $937,579 against liabilities and capital $1,209,181, out by $271,602.",
});
const BALANCE_B = issue({
  priority: "MEDIUM", formOrSchedule: "Schedule L — balance sheet",
  issueDescription: "The balance sheet closes with $937,579 of assets and $1,209,181 of liabilities plus capital.",
});
const OTRO_TEMA = issue({
  priority: "HIGH", formOrSchedule: "Form 1065 Line 20",
  issueDescription: "Other deductions of $412,880 are not supported by a statement.",
});

test("el mismo hallazgo escrito distinto se reconoce por las cifras", () => {
  assert.strictEqual(sameIssue(BALANCE_A, BALANCE_B), true);
});

test("dos hallazgos sobre cosas distintas no se confunden", () => {
  assert.strictEqual(sameIssue(BALANCE_A, OTRO_TEMA), false);
});

test("una sola cifra compartida no alcanza si el tema es otro", () => {
  const a = issue({ formOrSchedule: "Schedule L", issueDescription: "assets $937,579" });
  const b = issue({ formOrSchedule: "Line 20 other deductions", issueDescription: "deducted $937,579 of expenses" });
  assert.strictEqual(sameIssue(a, b), false, "el ingreso ordinario aparece en media docena de lugares");
});

test("union: lo repetido sale una vez y lo nuevo se suma", () => {
  const { issues, merged } = mergeIssues([[BALANCE_A, OTRO_TEMA], [BALANCE_B]]);
  assert.strictEqual(issues.length, 2, "el balance sale una vez, la deduccion tambien");
  assert.strictEqual(merged, 1);
});

test("de dos versiones del mismo hallazgo se conserva la mas severa", () => {
  assert.strictEqual(betterOf(BALANCE_A, BALANCE_B), BALANCE_A, "HIGH le gana a MEDIUM");
  const { issues } = mergeIssues([[BALANCE_B], [BALANCE_A]]);
  assert.strictEqual(issues[0].priority, "HIGH", "aunque el MEDIUM llegue primero");
});

test("a igual severidad se conserva la version mas detallada", () => {
  const corto = issue({ priority: "HIGH", formOrSchedule: "Schedule L", issueDescription: "no balancea." });
  const largo = issue({ priority: "HIGH", formOrSchedule: "Schedule L", issueDescription: "no balancea: activos $937,579 contra $1,209,181 de pasivo y capital, diferencia de $271,602." });
  assert.strictEqual(betterOf(corto, largo), largo);
});

test("la segunda corrida aporta los hallazgos que la primera no vio", () => {
  // Es el punto entero del ejercicio: 7 en una, 9 en la otra, 2 en comun -> 14.
  const primera = Array.from({ length: 7 }, (_, i) => issue({ formOrSchedule: "Tema " + i, issueDescription: `importe $${(i + 1) * 10},000` }));
  const segunda = Array.from({ length: 9 }, (_, i) => issue({ formOrSchedule: "Tema " + (i + 5), issueDescription: `importe $${(i + 6) * 10},000` }));
  const { issues, merged } = mergeIssues([primera, segunda]);
  assert.strictEqual(merged, 2, "Tema 5 y Tema 6 estan en las dos");
  assert.strictEqual(issues.length, 14);
});

/* --- La revision entera ------------------------------------------------- */

const revision = (over) => ({
  executiveSummary: "Resumen de la primera corrida.",
  filingReadiness: "NOT READY",
  issues: [], checkboxReview: [], infoConsistency: [], tieOutResults: [],
  openQuestions: [], missingDocuments: [], verifiedItems: [],
  ...over,
});

test("la prosa la escribe la primera corrida, no se mezcla", () => {
  const a = revision({ executiveSummary: "Primera." });
  const b = revision({ executiveSummary: "Segunda." });
  const { review } = mergeReviews([a, b]);
  assert.strictEqual(review.executiveSummary, "Primera.", "mezclar dos redacciones da un texto que no escribio nadie");
});

test("las listas si se unen", () => {
  const a = revision({
    checkboxReview: [{ box: "Form 1065 Item G(1) - Initial return", currentState: "No" }],
    openQuestions: ["Falta el K-1 de CCD Holdings."],
    tieOutResults: [{ lineItem: "Gross receipts", status: "TIE" }],
  });
  const b = revision({
    checkboxReview: [{ box: "Form 1065 Item G(5) - Amended return", currentState: "No" }],
    openQuestions: ["Falta el K-1 de CCD Holdings.", "Confirmar el domicilio."],
    tieOutResults: [{ lineItem: "Total deductions", status: "OUT_OF_BALANCE" }],
  });
  const { review } = mergeReviews([a, b]);
  assert.strictEqual(review.checkboxReview.length, 2);
  assert.strictEqual(review.openQuestions.length, 2, "la pregunta repetida sale una vez");
  assert.strictEqual(review.tieOutResults.length, 2);
});

test("una fila repetida conserva la version de la primera corrida", () => {
  const a = revision({ tieOutResults: [{ lineItem: "Gross receipts", status: "TIE", note: "primera" }] });
  const b = revision({ tieOutResults: [{ lineItem: "Gross Receipts ", status: "OUT_OF_BALANCE", note: "segunda" }] });
  const { review } = mergeReviews([a, b]);
  assert.strictEqual(review.tieOutResults.length, 1, "la misma linea, escrita distinto");
  assert.strictEqual(review.tieOutResults[0].note, "primera", "la segunda no tiene mas autoridad que la primera");
});

test("una sola revision pasa intacta", () => {
  const a = revision({ issues: [BALANCE_A] });
  const out = mergeReviews([a]);
  assert.strictEqual(out.review, a);
  assert.strictEqual(out.passes, 1);
  assert.strictEqual(out.merged, 0);
});

test("sin revisiones no rompe", () => {
  assert.strictEqual(mergeReviews([]).review, null);
  assert.strictEqual(mergeReviews(null).review, null);
  assert.strictEqual(mergeReviews([null, undefined]).review, null);
});

test("subjectKey normaliza el tema entre redacciones distintas", () => {
  assert.strictEqual(subjectKey({ formOrSchedule: "Form 1065 Schedule L" }), subjectKey({ formOrSchedule: "Schedule L (Form 1065)" }));
});

/* --- Filas duplicadas entre pasadas ------------------------------------- */

// Las ocho filas de casillas que salieron en un informe real de un 1040, donde las dos pasadas
// nombraron tres veces la misma casilla de forma distinta y la fila de alcance quedo en el
// medio de la tabla.
const CASILLAS_P1 = [
  { box: "Form 1040 Digital Assets question" },
  { box: "Form 1040 Filing Status - Married Filing Jointly" },
  { box: "Schedule B Part III Line 7a Foreign account question" },
  { box: "Schedule D Line (Qualified Opportunity Fund disposition)" },
  { box: "Boxes verified as correct" },
];
const CASILLAS_P2 = [
  { box: "Form 1040 Page 1 - Digital Assets question" },
  { box: "Schedule B Part III Line 7a - Foreign account" },
  { box: "Schedule D - Qualified opportunity fund disposition" },
];

test("la misma casilla nombrada distinto en cada pasada sale una vez", () => {
  const { review } = mergeReviews([revision({ checkboxReview: CASILLAS_P1 }), revision({ checkboxReview: CASILLAS_P2 })]);
  assert.strictEqual(review.checkboxReview.length, 5, "ocho filas con tres repetidas");
});

test("la fila de alcance va al final de la tabla, no en el medio", () => {
  const { review } = mergeReviews([revision({ checkboxReview: CASILLAS_P1 }), revision({ checkboxReview: CASILLAS_P2 })]);
  assert.match(review.checkboxReview[review.checkboxReview.length - 1].box, /Boxes verified as correct/);
});

test("dos casillas realmente distintas no se funden", () => {
  const a = revision({ checkboxReview: [{ box: "Form 1040 Item G(1) - Initial return" }] });
  const b = revision({ checkboxReview: [{ box: "Form 1040 Item G(5) - Amended return" }] });
  assert.strictEqual(mergeReviews([a, b]).review.checkboxReview.length, 2);
});

test("dos claves cortas no se funden por casualidad", () => {
  // "Item A" y "Item B" quedan en una letra cada una despues de sacar ubicacion y numeros:
  // por debajo del minimo no se compara por contencion.
  const a = revision({ checkboxReview: [{ box: "Line 1 Item A" }] });
  const b = revision({ checkboxReview: [{ box: "Line 2 Item B" }] });
  assert.strictEqual(mergeReviews([a, b]).review.checkboxReview.length, 2);
});

test("lo mismo aplica a la tabla de identificadores", () => {
  const a = revision({ infoConsistency: [{ item: "Taxpayer address" }, { item: "Identifiers verified as matching" }] });
  const b = revision({ infoConsistency: [{ item: "Taxpayer address - Form 1040 vs. CA Form 540" }] });
  const { review } = mergeReviews([a, b]);
  assert.strictEqual(review.infoConsistency.length, 2);
  assert.match(review.infoConsistency[review.infoConsistency.length - 1].item, /verified as matching/);
});
