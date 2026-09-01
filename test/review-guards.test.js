"use strict";
// Guardas sobre la review terminada.
//
// Las dos salen de una corrida real de un 1065. Un hallazgo afirmaba que $1,068 de otros
// ingresos no figuraban en el Form 8825 línea 2b, y el renglón "b Other income related to
// rental real estate activity. 2b 1,068." estaba en el texto que el modelo tenía delante. Y
// el workpaper traía una fila "Meals 50% Addback" con etiqueta y sin importe mientras la
// declaración deducía las comidas al 100%; tres revisiones pasaron por al lado citando la
// cifra de comidas en su propia evidencia.
const { test } = require("node:test");
const assert = require("node:assert");
const { verifyAbsenceClaims, verifyContinuityClaims, checkUnusedReconcilingLines, claimedAmounts } = require("../lib/review-guards");

const RETURN = {
  name: "Client 1065 2025.pdf",
  reviewRole: "current_return",
  fullText: `U.S. Return of Partnership Income 2025
2a Gross rents . . . . . . . . . . . . . . . . . . . . . . . 2a 74,300.
b Other income related to rental real estate activity. 2b 2,140.
14 Depreciation (see instructions) . . . . . . . . 14 5,900. 8,750.
${"filler line so the return clears the length gate. ".repeat(20)}`,
};

const issue = (over) => ({
  priority: "MEDIUM", category: "x", areaReviewed: "x", formOrSchedule: "x",
  issueDescription: "", evidence: "", riskAnalysis: "", proposedSolution: "", authority: "", source: "",
  ...over,
});

test("degrada el hallazgo que dice que una cifra no está, cuando sí está", () => {
  const review = { issues: [issue({
    priority: "MEDIUM",
    issueDescription: "The workpaper shows $2,140 of other income but Form 8825 line 2b does not report this amount.",
    riskAnalysis: "Income may be omitted.",
  })] };
  const out = verifyAbsenceClaims(review, [RETURN]);
  assert.strictEqual(out.corrected, 1);
  assert.strictEqual(out.issues[0].priority, "LOW");
  assert.match(out.issues[0].riskAnalysis, /CONTRADICTED BY THE RETURN/);
  assert.match(out.issues[0].riskAnalysis, /\$2,140\.00/);
  // Cita el renglón que lo desmiente, para que el revisor no tenga que buscarlo.
  assert.match(out.issues[0].riskAnalysis, /Other income related to rental real estate activity/);
  // Y conserva lo que decía el hallazgo original.
  assert.match(out.issues[0].riskAnalysis, /Income may be omitted/);
});

test("no toca los reclamos sobre documentos que el cliente no entregó", () => {
  // "No se entregó el 1098" es una pregunta distinta con una respuesta distinta: la cifra
  // esta en la declaracion justamente porque la declaracion la dedujo.
  const review = { issues: [issue({
    priority: "HIGH",
    issueDescription: "Schedule A line 8a reports mortgage interest of $74,300 but no Form 1098 was provided.",
  })] };
  const out = verifyAbsenceClaims(review, [RETURN]);
  assert.strictEqual(out.corrected, 0);
  assert.strictEqual(out.issues[0].priority, "HIGH");
});

test("no toca un hallazgo cuya cifra realmente no está en la declaración", () => {
  const review = { issues: [issue({
    issueDescription: "Form 8825 line 2b does not report the $9,999 of other income shown in the workpaper.",
  })] };
  const out = verifyAbsenceClaims(review, [RETURN]);
  assert.strictEqual(out.corrected, 0);
});

test("no toca hallazgos que no afirman ausencia", () => {
  const review = { issues: [issue({
    issueDescription: "Form 8825 line 2b reports $2,140 of other income; confirm it is rental income.",
  })] };
  assert.strictEqual(verifyAbsenceClaims(review, [RETURN]).corrected, 0);
});

test("sin declaración legible no corrige nada", () => {
  const review = { issues: [issue({ issueDescription: "Form 8825 line 2b does not report $2,140." })] };
  assert.strictEqual(verifyAbsenceClaims(review, []).corrected, 0);
  assert.strictEqual(verifyAbsenceClaims(review, [{ ...RETURN, fullText: "corto" }]).corrected, 0);
  assert.strictEqual(verifyAbsenceClaims({ issues: [] }, [RETURN]).corrected, 0);
  assert.strictEqual(verifyAbsenceClaims({}, [RETURN]).corrected, 0);
});

test("claimedAmounts ignora los números chicos de la prosa", () => {
  // "line 2b" y "50%" no son el sujeto del reclamo.
  assert.deepStrictEqual(claimedAmounts("Form 8825 line 2b does not report $2,140 or $75"), [2140]);
});

const WORKPAPER = {
  name: "workpaper.xlsx",
  reviewRole: "supporting_document",
  fullText: `--- Sheet: Book to Tax Reconciliation ---
,,,Net Income,41200.55
,,,Meals 50% Addback,
,,,Less: Depreciation as per Tax Return,14650
,,,Taxable Income,26550.55`,
};

test("fila de conciliación con etiqueta y sin importe", () => {
  const finding = checkUnusedReconcilingLines([RETURN, WORKPAPER]);
  assert.ok(finding);
  assert.strictEqual(finding.severity, "MEDIUM");
  assert.match(finding.detail, /Meals 50% Addback/);
  assert.match(finding.detail, /workpaper\.xlsx/);
});

test("si la fila tiene importe, se calla", () => {
  const completo = { ...WORKPAPER, fullText: WORKPAPER.fullText.replace("Addback,", "Addback,412.30") };
  assert.strictEqual(checkUnusedReconcilingLines([RETURN, completo]), null);
  // Un cero explícito también cuenta como decidido.
  const cero = { ...WORKPAPER, fullText: WORKPAPER.fullText.replace("Addback,", "Addback,0") };
  assert.strictEqual(checkUnusedReconcilingLines([RETURN, cero]), null);
});

test("solo mira planillas, nunca la declaración", () => {
  // El propio formulario dice "Schedule M-1 Reconciliation" e imprime "nondeductible
  // expenses" y "entertainment" como leyendas vacías: leerlo convertía cada casilla en
  // blanco del M-1 en un hallazgo.
  const conM1 = { ...RETURN, fullText: `${RETURN.fullText}
Schedule M-1 Reconciliation of Income (Loss) per Books With Income (Loss) per Return
b Travel and entertainment . . . . . . $
5 Add lines 1 through 4 . . . . . . . .` };
  assert.strictEqual(checkUnusedReconcilingLines([conM1]), null);
  assert.strictEqual(checkUnusedReconcilingLines([]), null);
  assert.strictEqual(checkUnusedReconcilingLines(null), null);
});

test("una planilla sin conciliación no se mira", () => {
  const otra = { name: "depreciacion.xlsx", reviewRole: "supporting_document", fullText: `--- Sheet: Assets ---
,,,Meals 50% Addback,` };
  assert.strictEqual(checkUnusedReconcilingLines([RETURN, otra]), null, "sin contexto de conciliacion no aplica");
});

test("reconoce las muchas formas de decir que algo no esta", () => {
  // Una segunda corrida uso "is missing from" y "is blank", y ninguna matcheaba.
  for (const frase of [
    "Form 8825 line 8 Interest is blank but the workpaper shows $2,140 of interest paid.",
    "the $2,140 is missing from the return per Form 8825 line 2b",
    "Form 8825 line 2b omitted the $2,140 of other income",
    "Schedule K line 2 does not include the $2,140",
    "Form 8825 line 2b failed to report $2,140",
  ]) {
    const out = verifyAbsenceClaims({ issues: [issue({ issueDescription: frase })] }, [RETURN]);
    assert.strictEqual(out.corrected, 1, `no reconocio: ${frase}`);
    assert.strictEqual(out.issues[0].priority, "LOW");
  }
});

test("desmiente el reclamo de continuidad que el cheque ya descarto", () => {
  const review = { issues: [issue({
    priority: "HIGH",
    issueDescription: "Schedule L beginning balances do not tie to 2024 ending balances for Cash and Buildings.",
    riskAnalysis: "Balances may be wrong.",
  })] };
  const out = verifyContinuityClaims(review, { continuityRan: true, continuityFindings: [] });
  assert.strictEqual(out.corrected, 1);
  assert.strictEqual(out.issues[0].priority, "LOW");
  assert.match(out.issues[0].riskAnalysis, /CONTRADICTED BY A COMPLETED CHECK/);
  assert.match(out.issues[0].riskAnalysis, /Balances may be wrong/);
});

test("no desmiente si el cheque de continuidad no corrio o encontro algo", () => {
  const review = { issues: [issue({
    issueDescription: "Schedule L beginning balances do not tie to prior year ending balances.",
  })] };
  // Sin declaracion anterior el cheque no pudo comparar nada: vacio no significa "coinciden".
  assert.strictEqual(verifyContinuityClaims(review, { continuityRan: false }).corrected, 0);
  // Y si el cheque SI encontro una ruptura, el hallazgo del modelo la acompaña.
  assert.strictEqual(verifyContinuityClaims(review, {
    continuityRan: true,
    continuityFindings: [{ category: "Prior-year continuity" }],
  }).corrected, 0);
});

test("no desmiente un hallazgo de continuidad que no habla de Schedule L ni M-2", () => {
  const review = { issues: [issue({
    issueDescription: "The beginning inventory does not match the prior year ending inventory.",
  })] };
  assert.strictEqual(verifyContinuityClaims(review, { continuityRan: true, continuityFindings: [] }).corrected, 0);
});
