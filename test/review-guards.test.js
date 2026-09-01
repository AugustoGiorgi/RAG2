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
const { verifyAbsenceClaims, verifyAttachmentClaims, verifyContinuityClaims, checkUnusedReconcilingLines, claimedAmounts, formAppearsInPackage, verifyWorkpaperClaims } = require("../lib/review-guards");

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
  // Dice que la cifra esta en la declaracion; NO le atribuye al hallazgo un reclamo que no hizo.
  assert.doesNotMatch(out.issues[0].riskAnalysis, /this finding says/);
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

test("no le atribuye al hallazgo cifras que nunca dijo que faltaban", () => {
  // Un hallazgo cita varias cifras y dice que falta UNA. "this finding says $85,617 and
  // $1,068 are not reported" le pone en la boca un reclamo que no hizo.
  const review = { issues: [issue({
    issueDescription: "Form 8825 line 2a shows gross rents $74,300 plus other income $2,140 = $76,440; the $2,140 is missing from the return.",
  })] };
  const out = verifyAbsenceClaims(review, [RETURN]);
  assert.strictEqual(out.corrected, 1);
  assert.match(out.issues[0].riskAnalysis, /reports something as absent/);
  assert.match(out.issues[0].riskAnalysis, /\$2,140\.00/);
  assert.doesNotMatch(out.issues[0].riskAnalysis, /says .*are not reported/);
});

// "El anexo requerido no esta adjunto" -- cuando si esta en el paquete.
//
// Dos veces en tres corridas de la misma declaracion, sobre dos anexos distintos. Una review
// dijo que faltaba el Schedule B-2; la sociedad no estaba eligiendo salir del regimen, asi
// que nunca hizo falta. La siguiente dijo que el Schedule B-1 no estaba adjunto, citando como
// evidencia la lista de formularios -- que es el primer lugar donde la declaracion lo nombra,
// tres renglones abajo del encabezado, con el formulario impreso mas adelante en el mismo
// paquete. Las dos mandan al preparador a buscar algo que ya tiene delante.
const PAQUETE = {
  name: "Client 1065 2025.pdf",
  reviewRole: "current_return",
  fullText: `FORMS NEEDED FOR THIS RETURN
FEDERAL: 1065, SCH B-1, SCH K-1, 1125-A, 6765, 8879-PE
2 a Did any corporation own 50% or more of the partnership? For rules of constructive
ownership, see instructions. If "Yes," attach Schedule B-1 . . . . . . . . . . X [ANSWER: Yes]
SCHEDULE B-1 Information on Partners Owning 50% or More of the Partnership
${"relleno para que la declaracion pase el largo minimo. ".repeat(20)}`,
};

test("degrada el hallazgo que dice que falta un anexo que si esta", () => {
  const review = { issues: [issue({
    priority: "HIGH",
    issueDescription: "Schedule B Question 2a is marked Yes but Schedule B-1 is not attached.",
    evidence: "Forms list: no Schedule B-1 listed.",
    riskAnalysis: "IRS e-file will reject.",
  })] };
  const out = verifyAttachmentClaims(review, [PAQUETE]);
  assert.strictEqual(out.corrected, 1);
  assert.strictEqual(out.issues[0].priority, "LOW");
  assert.match(out.issues[0].riskAnalysis, /CONTRADICTED BY THE PACKAGE/);
  assert.match(out.issues[0].riskAnalysis, /schedule b-1/i);
  assert.match(out.issues[0].riskAnalysis, /IRS e-file will reject/);
});

test("no toca el reclamo sobre un anexo que de verdad falta", () => {
  const review = { issues: [issue({
    priority: "HIGH",
    issueDescription: "Schedule K-2 is not attached although the partnership reports foreign activity.",
  })] };
  const out = verifyAttachmentClaims(review, [PAQUETE]);
  assert.strictEqual(out.corrected, 0);
  assert.strictEqual(out.issues[0].priority, "HIGH");
});

test("el texto de la instruccion no cuenta como que el formulario esta", () => {
  // 'If "Yes," attach Schedule B-1' nombra el anexo sin que este presente. Solo cuenta un
  // renglon que ARRANQUE con el nombre: el encabezado del formulario o la lista de formularios.
  const soloInstruccion = { ...PAQUETE, fullText: PAQUETE.fullText
    .replace(/^FEDERAL:.*$/m, "FEDERAL: 1065, SCH K-1, 1125-A")
    .replace(/^SCHEDULE B-1 .*$/m, "") };
  assert.strictEqual(formAppearsInPackage("Schedule", "B-1", soloInstruccion.fullText), false);
  const review = { issues: [issue({ issueDescription: "Schedule B-1 is not attached." })] };
  assert.strictEqual(verifyAttachmentClaims(review, [soloInstruccion]).corrected, 0);
});

test("reconoce al formulario por su encabezado o por la lista de formularios", () => {
  assert.strictEqual(formAppearsInPackage("Schedule", "B-1", PAQUETE.fullText), true);
  assert.strictEqual(formAppearsInPackage("Schedule", "B-2", PAQUETE.fullText), false);
  assert.strictEqual(formAppearsInPackage("Form", "6765", PAQUETE.fullText), true, "la lista dice 6765");
  assert.strictEqual(formAppearsInPackage("Form", "8825", PAQUETE.fullText), false);
});

test("sin paquete legible no corrige nada", () => {
  const review = { issues: [issue({ issueDescription: "Schedule B-1 is not attached." })] };
  assert.strictEqual(verifyAttachmentClaims(review, []).corrected, 0);
  assert.strictEqual(verifyAttachmentClaims(review, [{ name: "x", fullText: "corto" }]).corrected, 0);
  assert.strictEqual(verifyAttachmentClaims({ issues: [] }, [PAQUETE]).corrected, 0);
});

// "El workpaper no explica esto" -- cuando si lo explica, en un renglon mas abajo.
//
// Una review reporto gastos de interes de $75,016 en la declaracion contra $15,016 en el
// libro y llamo "sin explicar" a la diferencia de $60,000. El P&L trae DOS renglones de
// interes -- $60,000 en gastos y $15,016 en otros gastos -- y suman exacto la cifra de la
// declaracion. El hallazgo salio de leer uno solo de los dos.
const LIBRO = {
  name: "Cliente_Profit and Loss.xlsx",
  reviewRole: "supporting_document",
  fullText: `--- Sheet: Sheet1 ---
Cliente Corporation
Profit and Loss
January-December, 2025
,Jan 1 - Dec 31 2025,Jan 1 - Dec 31 2024 (PY)
Income
Sales,884300,712400
Total for Income,884300,712400
Expenses
Accounting fees,31200,28900
Contract labor,142880.40,118220
Interest paid,60000
Legal Fees,214300.55,96410.22
Rent,74500,74500
Salaries & wages,602110,551040
Total for Expenses,1125000.95,969070.22
Net Operating Income,-240700.95,-256670.22
Other Expenses
Amortization expenses,46100,46100
Interest Expense,15016.16,29774
Total for Other Expenses,61116.16,75874
Net Income,-1240806.40,-980110.22`,
};

test("degrada el reclamo de que el libro no explica una cifra que si trae", () => {
  const review = { issues: [issue({
    priority: "MEDIUM",
    issueDescription: "Interest expense $75,016 on return vs $15,016 in workpaper - $60,000 difference unexplained.",
    riskAnalysis: "May be an unsupported deduction.",
  })] };
  const out = verifyWorkpaperClaims(review, [RETURN, LIBRO]);
  assert.strictEqual(out.corrected, 1);
  assert.strictEqual(out.issues[0].priority, "LOW");
  assert.match(out.issues[0].riskAnalysis, /CONTRADICTED BY THE WORKPAPER/);
  assert.match(out.issues[0].riskAnalysis, /\$60,000\.00/);
  // Cita el renglon del libro que lo desmiente, y conserva lo que decia el hallazgo.
  assert.match(out.issues[0].riskAnalysis, /Interest paid/);
  assert.match(out.issues[0].riskAnalysis, /May be an unsupported deduction/);
});

test("una cifra que de verdad no esta en el libro no se toca", () => {
  const review = { issues: [issue({
    priority: "HIGH",
    issueDescription: "Consulting fees of $999,999 do not appear anywhere in the workpaper.",
  })] };
  const out = verifyWorkpaperClaims(review, [RETURN, LIBRO]);
  assert.strictEqual(out.corrected, 0);
  assert.strictEqual(out.issues[0].priority, "HIGH");
});

test("un reclamo sobre la declaracion no lo mira esta guarda", () => {
  // De eso se ocupa verifyAbsenceClaims, contra la declaracion y no contra los libros.
  const review = { issues: [issue({ issueDescription: "Form 8825 line 2b does not report $2,140." })] };
  assert.strictEqual(verifyWorkpaperClaims(review, [RETURN, LIBRO]).corrected, 0);
});

test("sin documentos de respaldo no corrige nada", () => {
  const review = { issues: [issue({ issueDescription: "The $60,000 is unexplained in the workpaper." })] };
  assert.strictEqual(verifyWorkpaperClaims(review, [RETURN]).corrected, 0);
  assert.strictEqual(verifyWorkpaperClaims(review, []).corrected, 0);
});

test("reconoce que un anexo esta aunque el hallazgo diga 'not visible'", () => {
  // Tercera redaccion del mismo error, sobre una review que decia que el Form 6765 no estaba
  // en el paquete mientras su propio hallazgo principal citaba la linea A del Form 6765.
  const paquete = { ...PAQUETE, fullText: `${PAQUETE.fullText}\nForm 6765 Credit for Increasing Research Activities` };
  const review = { issues: [issue({
    priority: "MEDIUM",
    issueDescription: "R&D credit carryforward with no current-year activity documented.",
    evidence: "Form 6765 listed on page 9 but not visible in package.",
  })] };
  const out = verifyAttachmentClaims(review, [paquete]);
  assert.strictEqual(out.corrected, 1);
  assert.strictEqual(out.issues[0].priority, "LOW");
  assert.match(out.issues[0].riskAnalysis, /form 6765/i);
});
