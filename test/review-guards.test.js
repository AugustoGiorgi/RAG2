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

// Los statements del preparador cuentan igual que un formulario: dos hallazgos de la misma
// review dijeron "STATEMENT 7 ... is not provided" y "Statement 1 is referenced but not
// provided" sobre statements impresos unas paginas mas adelante en el mismo paquete.
const CON_STATEMENTS = {
  ...PAQUETE,
  fullText: `${PAQUETE.fullText}
NEW YORK: CT-3, CT-3.4, CT-5, TR-579-CT
New York State Authorization for (9/25)
STATEMENT 1
FORM 1065, LINE 7
OTHER INCOME
STATEMENT 7
FORM 1065, SCHEDULE M-2, LINE 7
OTHER DECREASES`,
};

test("un statement impreso en el paquete cuenta como presente", () => {
  assert.strictEqual(formAppearsInPackage("Statement", "1", CON_STATEMENTS.fullText), true);
  assert.strictEqual(formAppearsInPackage("Statement", "7", CON_STATEMENTS.fullText), true);
  const review = { issues: [issue({
    priority: "HIGH",
    issueDescription: "Line 3 Other increases carries a reference to STATEMENT 7 which is not provided in the package.",
  })] };
  const out = verifyAttachmentClaims(review, [CON_STATEMENTS]);
  assert.strictEqual(out.corrected, 1);
  assert.strictEqual(out.issues[0].priority, "LOW");
  assert.match(out.issues[0].riskAnalysis, /statement 7/i);
});

test("un statement que de verdad no esta no se degrada", () => {
  assert.strictEqual(formAppearsInPackage("Statement", "9", CON_STATEMENTS.fullText), false);
  const review = { issues: [issue({ priority: "HIGH", issueDescription: "Statement 9 is referenced but not provided." })] };
  assert.strictEqual(verifyAttachmentClaims(review, [CON_STATEMENTS]).corrected, 0);
});

test("una fecha de revision no es una lista de formularios", () => {
  // "New York State Authorization for (9/25)" abre con el nombre de un estado y trae un 9
  // suelto: sin exigir los dos puntos de la lista, ese 9 pasaba por prueba de que el
  // Statement 9 estaba en el paquete.
  assert.strictEqual(formAppearsInPackage("Form", "9", CON_STATEMENTS.fullText), false);
  assert.strictEqual(formAppearsInPackage("Form", "25", CON_STATEMENTS.fullText), false);
  // Y la lista de verdad sigue contando.
  assert.strictEqual(formAppearsInPackage("Schedule", "CT-3", CON_STATEMENTS.fullText), true);
});

test("reconoce 'is not provided' sin el 'was'", () => {
  const review = { issues: [issue({ priority: "HIGH", issueDescription: "Statement 1 is not provided with the return." })] };
  assert.strictEqual(verifyAttachmentClaims(review, [CON_STATEMENTS]).corrected, 1);
});

// Un hallazgo correcto que la guarda degradaba por leer mal a quien pertenece la cifra.
//
// "Form 3800 shows $27,793 of carryforward ... Form 3800 Part III is blank ... verify that no
// 2025 credits were omitted" es verdadero: habla de una parte vacia del formulario, y los
// $27,793 los cita como prueba de que SI estan. Las dos guardas lo degradaron igual -- una
// porque encontro los $27,793 en la declaracion, la otra porque leyo "omitted" a sesenta
// palabras del nombre de un formulario que si esta en el paquete.
const GBC = "Form 3800 shows $27,793 GBC carryforward from prior years but no current-year credit generation is shown on Part III; verify the carryforward ties to 2024 and that no 2025 credits were omitted.";

test("no degrada el hallazgo que cita la cifra como presente en la declaracion", () => {
  // La cifra esta en la declaracion y el hallazgo lo dice; lo vacio es otra cosa.
  assert.deepStrictEqual(claimedAmounts(GBC), []);
  const conCifra = { ...RETURN, fullText: `${RETURN.fullText}\n4 Carryforward of general business credit . . . 27,793.` };
  assert.strictEqual(verifyAbsenceClaims({ issues: [issue({ issueDescription: GBC })] }, [conCifra]).corrected, 0);
});

test("sigue degradando cuando quien muestra la cifra son los libros", () => {
  // "The workpaper shows $2,140 ... Form 8825 line 2b does not report this amount": ahi la
  // cifra en la declaracion si es la contradiccion.
  assert.deepStrictEqual(claimedAmounts("The workpaper shows $2,140 of other income but Form 8825 line 2b does not report this amount."), [2140]);
});

test("una negacion con el mismo verbo no cuenta como que la cifra esta", () => {
  for (const frase of [
    "Form 8825 line 2b does not report $2,140",
    "Form 8825 line 2b failed to report $2,140",
    "Schedule K line 2 does not include the $2,140",
  ]) {
    assert.deepStrictEqual(claimedAmounts(frase), [2140], `no reconocio: ${frase}`);
  }
});

test("la frase de ausencia tiene que hablar del formulario que nombra", () => {
  const paquete = { ...PAQUETE, fullText: `${PAQUETE.fullText}\nForm 3800 General Business Credit` };
  // "omitted" a sesenta palabras de "Form 3800" no es un reclamo sobre el Form 3800.
  assert.strictEqual(verifyAttachmentClaims({ issues: [issue({ issueDescription: GBC })] }, [paquete]).corrected, 0);
  // Pegado al nombre, si lo es.
  const pegado = issue({ issueDescription: "Form 3800 is not attached to the return package." });
  assert.strictEqual(verifyAttachmentClaims({ issues: [pegado] }, [paquete]).corrected, 1);
});

// Dos correcciones que la corrida siguiente destapo, las dos del mismo tipo: la guarda usaba
// como contradiccion algo que el hallazgo nunca dijo que faltara.
test("un formulario que solo esta en la declaracion del año anterior no cuenta", () => {
  // "Form 4562 is not attached to the return" habla de ESTE año. La del año anterior trae su
  // propia copia del 4562, y juntar todos los documentos convertia un hallazgo verdadero
  // sobre un formulario faltante en una contradiccion.
  const anterior = {
    name: "Client 1120 2024.pdf",
    reviewRole: "prior_return",
    fullText: `U.S. Corporation Income Tax Return\nForm 4562 Depreciation and Amortization\n${"relleno ".repeat(200)}`,
  };
  const review = { issues: [issue({
    priority: "HIGH",
    issueDescription: "Schedule L shows amortization of $168,431 but Form 4562 is not attached to the return.",
  })] };
  assert.strictEqual(verifyAttachmentClaims(review, [PAQUETE, anterior]).corrected, 0);
  // Y si el formulario esta en la declaracion del año corriente, si se degrada.
  const conForm = { ...PAQUETE, fullText: `${PAQUETE.fullText}\nForm 4562 Depreciation and Amortization` };
  assert.strictEqual(verifyAttachmentClaims(review, [conForm, anterior]).corrected, 1);
});

test("una cifra que el hallazgo dice que muestran los libros no lo contradice", () => {
  // "Workpaper P&L shows Reimbursements $75,480.99 ... no corresponding line on prior year"
  // es un hallazgo verdadero sobre un gasto nuevo, y la guarda leia los $75,480.99 de vuelta
  // del P&L y lo daba por contradicho. El verbo puede traer un sustantivo de por medio.
  const libro = { ...LIBRO, fullText: `${LIBRO.fullText}\nReimbursements,75480.99` };
  const review = { issues: [issue({
    priority: "HIGH",
    issueDescription: "Workpaper P&L shows Reimbursements $75,480.99 in Other Expenses; verify the tax treatment. No corresponding line on prior year.",
  })] };
  assert.strictEqual(verifyWorkpaperClaims(review, [RETURN, libro]).corrected, 0);
});
