"use strict";
// Verificación de evidencia y cobertura de documentos.
//
// Reproduce la corrida real que motivó estos dos motores: un paquete 1040 con cinco W-2
// donde la review leyó tres, reconcilió salarios contra el conjunto equivocado, y declaró
// TIE un renglón de intereses de $1,726 cuyo único documento de respaldo en la carpeta
// mostraba $0.01. Nombres y montos cambiados; la forma de la falla es la real.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  verifyTieOutEvidence, auditDocumentCoverage, auditDerivations, amountAppearsInText, parseDerivation,
  enforceNumericVerdicts, canonicalLineKey, ensureRequiredTieOutRows,
} = require("../lib/tie-out");

const support = (name, text) => ({ name, reviewRole: "supporting_document", text });
const PACKAGE = [
  support("Brokerage 1099 2025.pdf", "2025 FORM 1099-DIV\n1a. Total ordinary dividends  $612.40\n1b. Qualified dividends $612.40\nINTEREST INCOME\n1. Interest income (not included in Box 3)  $0.02\nTotal Interest Income $0.02"),
  support("AB W2 2025.pdf", "a Employee's social security number 111-22-3333\n1 Wages, tips, other compensation\n88400.00\n2 Federal income tax withheld\n9120.55"),
  support("CD W2 2025.pdf", "a Employee's social security number 444-55-6666\n1 Wages, tips, other compensation\n15600.00\n2 Federal income tax withheld\n412.00"),
  support("CD W2 Second Employer 2025.pdf", "a Employee's social security number 444-55-6666\n1 Wages, tips, other compensation\n3210.75\n2 Federal income tax withheld\n0.00"),
  { name: "Scanned Entity Docs 2025.pdf", reviewRole: "supporting_document", text: "" },
  { name: "Client 1040 2025.pdf", reviewRole: "current_return", text: "Taxable interest 2b 4,908. Ordinary dividends 3b 612." },
  { name: "Client 1040 2024.pdf", reviewRole: "prior_return", text: "prior year return text" },
];

const row = (lineItem, workpaperAmount, note) => ({
  lineItem, returnAmount: workpaperAmount, workpaperAmount, difference: "0", status: "TIE", note,
});

test("amountAppearsInText: acepta el formato real de un 1099, rechaza coincidencias parciales", () => {
  assert.ok(amountAppearsInText(612, "1a. Total ordinary dividends  $612.40"), "612 debe encontrarse dentro de 612.40");
  assert.ok(amountAppearsInText(88400, "88400.00"));
  assert.ok(amountAppearsInText(88400, "88,400.00"));
  assert.ok(!amountAppearsInText(612, "total 1612.00"), "no debe matchear como sufijo de otro numero");
  assert.ok(!amountAppearsInText(612, "total 6120.00"), "no debe matchear como prefijo de otro numero");
  assert.ok(!amountAppearsInText(4908, "1. Interest income  $0.02"));
});

test("parseDerivation: extrae la cadena y el total declarado", () => {
  const d = parseDerivation("W-2 Box 1: 88,400.00 + 15,600.00 + 3,210.75 = 107,210.75 segun los tres W-2.");
  assert.deepStrictEqual(d.parts, [88400, 15600, 3210.75]);
  assert.strictEqual(d.stated, 107210.75);
  assert.strictEqual(parseDerivation("Coincide con el 1099 del broker."), null);
});

test("degrada el renglon cuyo importe no existe en ningun documento de respaldo", () => {
  // La falla real: cita un documento que existe, le atribuye una cifra que no dice.
  const rows = [row("Form 1040 Line 2b — Taxable interest", "4908",
    "El 1099 del broker muestra $4,908 de interes gravable (incluye $0.02 de la cuenta y $4,907.98 de otras fuentes). Coincide con el return.")];
  const out = verifyTieOutEvidence(rows, "1040", PACKAGE);
  assert.strictEqual(out.flagged, 1);
  assert.strictEqual(out.rows[0].status, "NOT VERIFIED");
  assert.match(out.rows[0].note, /was not found in any supporting document/);
});

test("NO degrada cuando la cifra si esta en el respaldo, aunque el documento este mal nombrado", () => {
  // "JP Morgan" para un archivo llamado "Chase ..." describe el documento correcto.
  // El test es si el numero existe, no si el nombre coincide.
  const rows = [row("Form 1040 Line 3b — Ordinary dividends", "612", "El statement de JP Morgan muestra $612 de dividendos ordinarios.")];
  const out = verifyTieOutEvidence(rows, "1040", PACKAGE);
  assert.strictEqual(out.flagged, 0);
  assert.strictEqual(out.rows[0].status, "TIE");
});

test("auditDerivations: re-suma la cadena y degrada si no cierra", () => {
  // Suma mal por $1: el modelo escribio un total que sus propios sumandos no dan.
  const bad = [row("Form 1040 Line 1a — Wages", "107211.75",
    "W-2 Box 1: 88,400.00 + 15,600.00 + 3,210.75 = 107,211.75")];
  const out = auditDerivations(bad);
  assert.strictEqual(out.flagged, 1);
  assert.match(out.rows[0].note, /add to 107210\.75, not 107211\.75/);

  // La misma linea con la suma correcta pasa.
  const good = [row("Form 1040 Line 1a — Wages", "107210.75",
    "W-2 Box 1: 88,400.00 + 15,600.00 + 3,210.75 = 107,210.75")];
  assert.strictEqual(auditDerivations(good).flagged, 0);
  // Y en la cadena completa tampoco se exige encontrar el total en un documento.
  assert.strictEqual(verifyTieOutEvidence(good, "1040", PACKAGE).flagged, 0);
});

test("auditDerivations: tambien audita filas OUT_OF_BALANCE", () => {
  // La falla real: un total que cuenta un W-2 dos veces sin listarlo. La fila no es TIE,
  // asi que la verificacion de evidencia no la mira — y la instruccion que produce es
  // "corregi la linea", sobre una linea que estaba bien.
  const rows = [{
    lineItem: "Form 1040 Line 1z — Wages", returnAmount: "107210", workpaperAmount: "119259",
    difference: "-12049", status: "OUT_OF_BALANCE",
    note: "Return shows $107,210 but sum of W-2 Box 1 is $119,258.83 (88,400.00 + 15,600.00 + 3,210.75).",
  }];
  const out = auditDerivations(rows);
  assert.strictEqual(out.flagged, 1);
  assert.strictEqual(out.rows[0].status, "NOT VERIFIED");
  assert.match(out.rows[0].note, /derives 107210\.75 but the support column shows 119259/);
});

test("auditDerivations: el redondeo a dolar entero no dispara falsos positivos", () => {
  // La nota trae centavos y la columna va redondeada. Es lo normal, no un hallazgo.
  const rows = [{
    lineItem: "Form 1040 Line 25d — Total withholding", returnAmount: "64852", workpaperAmount: "64826",
    difference: "26", status: "OUT_OF_BALANCE",
    note: "Sum of W-2 Box 2: 62,782.08 + 0 + 2,044.29 = 64,826.37.",
  }];
  assert.strictEqual(auditDerivations(rows).flagged, 0);
});

test("auditDerivations: no vuelve a tocar lo que ya esta NOT VERIFIED", () => {
  const rows = [{
    lineItem: "Form 1040 Line 1a — Wages", returnAmount: "107210", workpaperAmount: "119259",
    difference: "", status: "NOT VERIFIED", note: "88,400.00 + 15,600.00 + 3,210.75 = 999,999.00",
  }];
  assert.strictEqual(auditDerivations(rows).flagged, 0);
});

test("canonicalLineKey: 1z y 1a son el mismo control de salarios", () => {
  // Una corrida reporto los salarios como "Line 1z"; la checklist no lo reconocio y agrego
  // su propia fila "Line 1a" como no realizada. La tabla salio con dos renglones de
  // salarios que se contradecian.
  assert.strictEqual(canonicalLineKey("Form 1040 Line 1z — Wages"), canonicalLineKey("Form 1040 Line 1a — Wages"));
  assert.strictEqual(canonicalLineKey("Form 1040 Line 1 — Wages"), canonicalLineKey("Form 1040 Line 1a — Wages"));
  assert.notStrictEqual(canonicalLineKey("Form 1040 Line 2b — Interest"), canonicalLineKey("Form 1040 Line 1a — Wages"));

  const rows = [{ lineItem: "Form 1040 Line 1z — Wages", returnAmount: "1", workpaperAmount: "1", difference: "0", status: "TIE", note: "n/a" }];
  const added = ensureRequiredTieOutRows(rows, "1040").rows.filter((r) => /Wages/.test(r.lineItem));
  assert.strictEqual(added.length, 1, "no debe agregarse una segunda fila de salarios");
});

test("un documento escaneado sin texto no se hace pasar por verificado", () => {
  const onlyScan = [PACKAGE[4], PACKAGE[5]];
  const rows = [row("Schedule E Line 30 — Partnership and S corporation income", "428816", "El K-1 de la entidad confirma $428,816.")];
  const out = verifyTieOutEvidence(rows, "1040", onlyScan);
  assert.strictEqual(out.rows[0].status, "NOT VERIFIED");
  assert.match(out.rows[0].note, /image with no readable text/);
});

test("no toca renglones internos, ni los que ya no son TIE, ni los que no citan documento", () => {
  const rows = [
    row("Form 1040 Line 15 — Taxable income", "500000", "AGI menos deducciones. Calculo del propio return."),
    { lineItem: "Form 1040 Line 2b — Taxable interest", returnAmount: "4908", workpaperAmount: "10", difference: "4898", status: "OUT_OF_BALANCE", note: "1099 del broker" },
    row("Form 1040 Line 2b — Taxable interest", "4908", "Sin fuente citada."),
  ];
  const out = verifyTieOutEvidence(rows, "1040", PACKAGE);
  assert.strictEqual(out.flagged, 0, "ninguno de los tres califica para esta verificacion");
});

test("sin documentos de respaldo el motor no inventa hallazgos", () => {
  const rows = [row("Form 1040 Line 2b — Taxable interest", "4908", "El 1099 del broker lo confirma.")];
  assert.strictEqual(verifyTieOutEvidence(rows, "1040", [PACKAGE[5]]).flagged, 0);
  assert.strictEqual(verifyTieOutEvidence(rows, "1040", []).flagged, 0);
});

test("el return no cuenta como respaldo de si mismo", () => {
  // 4,908 SI aparece — pero solo dentro del propio 1040. Copiar la cifra del return
  // es exactamente la falla que este motor busca.
  const rows = [row("Form 1040 Line 2b — Taxable interest", "4908", "Confirmado contra el 1099 del broker.")];
  const out = verifyTieOutEvidence(rows, "1040", PACKAGE);
  assert.strictEqual(out.rows[0].status, "NOT VERIFIED");
});

test("cobertura: un archivo ausente de documentsRead se reporta como no leido", () => {
  const review = {
    documentsRead: [
      { filename: "Client 1040 2025.pdf" }, { filename: "Client 1040 2024.pdf" },
      { filename: "AB W2 2025.pdf" }, { filename: "CD W2 Second Employer 2025.pdf" },
      { filename: "Brokerage 1099 2025.pdf" }, { filename: "Scanned Entity Docs 2025.pdf" },
    ],
  };
  const { coverage, unreviewed } = auditDocumentCoverage(review, PACKAGE);
  assert.strictEqual(coverage.length, 7);
  assert.deepStrictEqual(unreviewed.map((c) => c.name), ["CD W2 2025.pdf"]);
});

test("cobertura: un nombre contenido en otro NO cuenta como leido", () => {
  // "CD W2 2025.pdf" y "CD W2 Second Employer 2025.pdf" son dos W-2 distintos de la misma
  // persona. Con solapamiento de palabras el primero quedaba tapado por el segundo, que es
  // precisamente el archivo que la corrida real habia salteado.
  const review = { documentsRead: [{ filename: "CD W2 Second Employer 2025.pdf" }] };
  const { coverage } = auditDocumentCoverage(review, PACKAGE);
  assert.strictEqual(coverage.find((c) => c.name === "CD W2 2025.pdf").read, false);
  assert.strictEqual(coverage.find((c) => c.name === "CD W2 Second Employer 2025.pdf").read, true);
});

test("cobertura: sin archivos no devuelve nada", () => {
  assert.deepStrictEqual(auditDocumentCoverage({ documentsRead: [] }, []), { coverage: [], unreviewed: [] });
});

test("enforceNumericVerdicts encadena la verificacion de evidencia", () => {
  const review = {
    tieOutResults: [row("Form 1040 Line 2b — Taxable interest", "4908", "El 1099 del broker muestra $4,908.")],
  };
  const out = enforceNumericVerdicts(review, "1040", PACKAGE);
  assert.strictEqual(out.unevidenced, 1);
  assert.strictEqual(out.review.tieOutResults[0].status, "NOT VERIFIED");
  // Sin archivos el comportamiento previo queda intacto.
  const legacy = enforceNumericVerdicts({ tieOutResults: [row("Form 1040 Line 2b — Taxable interest", "4908", "El 1099 del broker muestra $4,908.")] }, "1040");
  assert.strictEqual(legacy.review.tieOutResults[0].status, "TIE");
});
