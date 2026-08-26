"use strict";
// Veredictos numéricos deterministas del Review. Reproduce las divergencias reales
// observadas entre dos corridas del MISMO paquete (importes ficticios donde aplica).
const { test } = require("node:test");
const assert = require("node:assert");
const { enforceNumericVerdicts, enforceTieOutVerdicts, enforceBalanceSheetVerdict, parseAmount } = require("../lib/tie-out");

test("parseAmount: formatos que llegan del modelo", () => {
  assert.strictEqual(parseAmount(81825), 81825);
  assert.strictEqual(parseAmount("81,825"), 81825);
  assert.strictEqual(parseAmount("$1,733.04"), 1733.04);
  assert.strictEqual(parseAmount("(218)"), -218);
  assert.strictEqual(parseAmount(""), null);
  assert.strictEqual(parseAmount(null), null);
  assert.strictEqual(parseAmount("n/a"), null);
});

test("el caso grave: una diferencia enorme NO puede quedar como TIE", () => {
  const { rows, changed } = enforceTieOutVerdicts([
    { lineItem: "Form 7203 stock basis", returnAmount: 74456, workpaperAmount: 95973, difference: -21517, status: "TIE" },
  ]);
  assert.strictEqual(rows[0].status, "OUT_OF_BALANCE");
  assert.strictEqual(rows[0].difference, -21517);
  assert.match(rows[0].note, /Recomputed by the app/);
  assert.strictEqual(changed, 1);
});

test("redondeo IRS por debajo de $1 siempre TIE (aunque el modelo diga lo contrario)", () => {
  const { rows } = enforceTieOutVerdicts([
    { lineItem: "W-2 wages", returnAmount: 81825, workpaperAmount: 81824.69, status: "OUT_OF_BALANCE" },
  ]);
  assert.strictEqual(rows[0].status, "TIE");
  assert.strictEqual(rows[0].difference, 0.31);
  assert.match(rows[0].note, /whole-dollar rounding/);
});

test("mismo importe = mismo veredicto, sin importar lo que dijo cada corrida", () => {
  const row = { lineItem: "Interest", returnAmount: 1738, workpaperAmount: 1733.04 };
  const run12 = enforceTieOutVerdicts([{ ...row, status: "TIE" }]).rows[0];
  const run13 = enforceTieOutVerdicts([{ ...row, status: "OUT_OF_BALANCE" }]).rows[0];
  assert.strictEqual(run12.status, run13.status);
  assert.strictEqual(run12.difference, run13.difference);
  assert.strictEqual(run12.status, "OUT_OF_BALANCE"); // 4.96 supera el umbral de $1
});

test("un lado faltante nunca se reporta como verificado", () => {
  const { rows, changed } = enforceTieOutVerdicts([
    { lineItem: "Schedule E line 30", returnAmount: 193201, workpaperAmount: "", status: "TIE" },
  ]);
  assert.strictEqual(rows[0].status, "NOT VERIFIED");
  assert.match(rows[0].note, /Not verified/);
  assert.strictEqual(changed, 1);
});

test("la diferencia se recalcula: no se confía en la aritmética del modelo", () => {
  const { rows } = enforceTieOutVerdicts([
    { lineItem: "Total tax", returnAmount: 58949, workpaperAmount: 58949, difference: 999, status: "TIE" },
  ]);
  assert.strictEqual(rows[0].difference, 0);
  assert.strictEqual(rows[0].status, "TIE");
});

test("balance sheet: 'balanced' también es aritmética, no opinión", () => {
  const bad = enforceBalanceSheetVerdict({ totalAssets: 340025.35, totalLiabEquity: 320000, balanced: true });
  assert.strictEqual(bad.check.balanced, false);
  assert.strictEqual(bad.check.difference, 20025.35);
  assert.strictEqual(bad.changed, 1);
  const good = enforceBalanceSheetVerdict({ totalAssets: 340025.35, totalLiabEquity: 340025.35, balanced: false });
  assert.strictEqual(good.check.balanced, true);
});

test("balance sheet sin importes legibles se deja intacto (no inventa un veredicto)", () => {
  const untouched = enforceBalanceSheetVerdict({ totalAssets: null, totalLiabEquity: null, balanced: false, note: "no Schedule L" });
  assert.strictEqual(untouched.changed, 0);
  assert.strictEqual(untouched.check.note, "no Schedule L");
});

test("enforceNumericVerdicts no muta el objeto original", () => {
  const original = { tieOutResults: [{ lineItem: "x", returnAmount: 10, workpaperAmount: 99, status: "TIE" }] };
  const result = enforceNumericVerdicts(original);
  assert.strictEqual(original.tieOutResults[0].status, "TIE");
  assert.strictEqual(result.review.tieOutResults[0].status, "OUT_OF_BALANCE");
  assert.strictEqual(result.corrections, 1);
});

test("checklist obligatoria: 1040 y entidades, y las lineas que faltan se agregan como no verificadas", () => {
  const { requiredTieOutsFor, ensureRequiredTieOutRows, tieOutChecklistPromptLines } = require("../lib/tie-out");
  assert.ok(requiredTieOutsFor("1040").length >= 12);
  assert.ok(requiredTieOutsFor("1120-S").length >= 8);
  assert.strictEqual(requiredTieOutsFor("990").length, 0); // sin checklist definida

  // La corrida solo devolvio 2 lineas: el resto debe aparecer marcado como no verificado.
  const partial = [
    { lineItem: "Form 1040 Line 1a (W-2 Wages)", returnAmount: 81825, workpaperAmount: 81824.69, status: "TIE" },
    { lineItem: "Form 1040 Line 2b (Interest)", returnAmount: 1738, workpaperAmount: 1733.04, status: "TIE" },
  ];
  const { rows, added } = ensureRequiredTieOutRows(partial, "1040");
  assert.strictEqual(rows.length, requiredTieOutsFor("1040").length);
  assert.strictEqual(added, requiredTieOutsFor("1040").length - 2);
  const schD = rows.find((r) => /Schedule D Line 7/i.test(r.lineItem));
  assert.strictEqual(schD.status, "NOT VERIFIED");
  assert.match(schD.note, /not performed/i);
});

test("checklist: etiquetas con distinto wording NO se duplican", () => {
  const { ensureRequiredTieOutRows } = require("../lib/tie-out");
  // etiquetas reales de las dos corridas, escritas distinto
  const runA = ensureRequiredTieOutRows([{ lineItem: "Schedule D Line 7 — Net Short-Term Capital Gain (Loss)", returnAmount: 1, workpaperAmount: 1 }], "1040").rows;
  const runB = ensureRequiredTieOutRows([{ lineItem: "Schedule D Line 7 Short-Term Gain/Loss", returnAmount: 1, workpaperAmount: 1 }], "1040").rows;
  const countD7 = (rows) => rows.filter((r) => /schedule d line 7/i.test(r.lineItem)).length;
  assert.strictEqual(countD7(runA), 1);
  assert.strictEqual(countD7(runB), 1);
  assert.strictEqual(runA.length, runB.length); // misma cantidad de filas -> corridas comparables
});

test("prompt de checklist se genera para 1040 y queda vacio donde no aplica", () => {
  const { tieOutChecklistPromptLines } = require("../lib/tie-out");
  const lines = tieOutChecklistPromptLines("1040").join("\n");
  assert.match(lines, /MANDATORY TIE-OUT CHECKLIST/);
  assert.match(lines, /Schedule D Line 15/);
  assert.match(lines, /never copy the return figure/i);
  assert.strictEqual(tieOutChecklistPromptLines("990").length, 0);
});

test("deteccion del tipo de return desde el documento (selector vacio)", () => {
  const { detectReturnTypeFromText, detectReturnTypeFromFiles } = require("../lib/tie-out");
  // texto como el que imprime el software: carta de la firma primero, sin "U.S."
  const cover = "Dear Joseph, Your 2025 Federal Individual Income Tax return will be electronically filed";
  assert.strictEqual(detectReturnTypeFromText(cover), "1040");
  assert.strictEqual(detectReturnTypeFromText("U.S. Income Tax Return for an S Corporation"), "1120-S");
  assert.strictEqual(detectReturnTypeFromText("U.S. Return of Partnership Income"), "1065");
  assert.strictEqual(detectReturnTypeFromText("U.S. Corporation Income Tax Return"), "1120");
  assert.strictEqual(detectReturnTypeFromText("solo un W-2 sin identidad de return"), "");

  // el K-1 adjunto (que menciona 1065) no puede ganarle al return bajo revision
  const k1 = "Schedule K-1 (Form 1065) U.S. Return of Partnership Income";
  const ret = cover + " ".repeat(50000) + " Form 1040";
  assert.strictEqual(detectReturnTypeFromFiles([
    { name: "k1.pdf", reviewRole: "supporting_document", extractedText: k1 },
    { name: "1040.pdf", reviewRole: "current_return", extractedText: ret },
  ]), "1040");

  // sin roles marcados, gana el documento mas grande (la declaracion, no el K-1)
  assert.strictEqual(detectReturnTypeFromFiles([
    { name: "k1.pdf", reviewRole: "supporting_document", extractedText: k1 },
    { name: "1040.pdf", reviewRole: "supporting_document", extractedText: ret },
  ]), "1040");

  // el return del anio anterior nunca decide
  assert.strictEqual(detectReturnTypeFromFiles([
    { name: "2024.pdf", reviewRole: "prior_return", extractedText: "U.S. Corporation Income Tax Return" },
    { name: "cur.pdf", reviewRole: "current_return", extractedText: cover },
  ]), "1040");
});

test("coherencia de totales: un total no puede cuadrar si sus componentes no cuadran", () => {
  const { enforceRollupCoherence } = require("../lib/tie-out");
  // caso real de la corrida #18: estimados mal por 37.000 pero total de pagos 'TIE'
  const { rows, flagged } = enforceRollupCoherence([
    { lineItem: "Form 1040 Line 25d — Total withholding", difference: 0, status: "TIE" },
    { lineItem: "Form 1040 Line 26 — Estimated tax payments", difference: 37000, status: "OUT_OF_BALANCE" },
    { lineItem: "Form 1040 Line 33 — Total payments", difference: 0, status: "TIE" },
  ], "1040");
  const total = rows.find((r) => /Line 33/.test(r.lineItem));
  assert.strictEqual(total.status, "OUT_OF_BALANCE");
  assert.match(total.note, /Cannot tie/);
  assert.strictEqual(flagged, 1);
});

test("coherencia: si los componentes cuadran, el total no se toca", () => {
  const { enforceRollupCoherence } = require("../lib/tie-out");
  const { rows, flagged } = enforceRollupCoherence([
    { lineItem: "Form 1040 Line 25d — Total withholding", difference: 0.45, status: "TIE" },
    { lineItem: "Form 1040 Line 26 — Estimated tax payments", difference: 0, status: "TIE" },
    { lineItem: "Form 1040 Line 33 — Total payments", difference: 0, status: "TIE" },
  ], "1040");
  assert.strictEqual(rows.find((r) => /Line 33/.test(r.lineItem)).status, "TIE");
  assert.strictEqual(flagged, 0);
});

test("tie sin respaldo: se anota, pero NO se cambia el veredicto", () => {
  const { flagUnsupportedTies } = require("../lib/tie-out");
  const { rows, flagged } = flagUnsupportedTies([
    // linea externa, importe identico al return y sin documento citado -> sospechosa
    { lineItem: "Form 1040 Line 2b — Taxable interest", difference: 0, status: "TIE", note: "" },
    // misma situacion pero citando el documento -> legitima
    { lineItem: "Form 1040 Line 1a — Wages", difference: 0, status: "TIE", note: "Sum of both W-2 Box 1 amounts." },
    // linea interna (calculo del propio return): un 0 es normal
    { lineItem: "Form 1040 Line 15 — Taxable income", difference: 0, status: "TIE", note: "" },
  ], "1040");
  assert.match(rows[0].note, /Not verified/);
  assert.strictEqual(rows[0].status, "NOT VERIFIED"); // se degrada: un cuadre sin evidencia no es un chequeo hecho
  assert.strictEqual(rows[1].status, "TIE");
  assert.strictEqual(rows[2].status, "TIE");
  assert.strictEqual(flagged, 1);
});

test("nota del motor viaja al Word (regresion: la tabla exportaba sin columna Note)", () => {
  const app = require("fs").readFileSync(require("path").join(__dirname, "..", "app.js"), "utf8");
  const block = app.match(/parts\.push\(dxTable\(\["Line Item"[\s\S]{0,320}/);
  assert.ok(block, "no se encontro la tabla de tie-out del docx");
  assert.match(block[0], /"Note"/);
  assert.match(block[0], /r\.note/);
});

test("filing readiness: descuadres numericos impiden READY", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8");
  const fn = src.match(/function enforceFilingReadinessConsistency[\s\S]*?\n}/)[0];
  // eslint-disable-next-line no-eval
  const enforce = eval(`(${fn})`);
  const withOut = { issues: [{ priority: "MEDIUM" }], tieOutResults: [{ status: "OUT_OF_BALANCE" }], openQuestions: [] };
  enforce(withOut);
  assert.strictEqual(withOut.filingReadiness, "NOT READY");
  const clean = { issues: [], tieOutResults: [{ status: "TIE" }], openQuestions: [] };
  enforce(clean);
  assert.strictEqual(clean.filingReadiness, "READY");
});

test("caso real #22: 11 lineas copiadas del return ya no pueden reportarse como verificadas", () => {
  const { enforceNumericVerdicts } = require("../lib/tie-out");
  // filas exactas de la corrida #22 (el modelo copio el importe del return)
  const rows = [
    { lineItem: "Form 1040 Line 1a — Wages", returnAmount: 81825, workpaperAmount: 81824.69, status: "TIE" },
    { lineItem: "Form 1040 Line 2b — Taxable interest", returnAmount: 1738, workpaperAmount: 1738, status: "TIE" },
    { lineItem: "Schedule D Line 7 — Net short-term capital gain (loss)", returnAmount: -51, workpaperAmount: -51, status: "TIE" },
    { lineItem: "Schedule D Line 15 — Net long-term capital gain (loss)", returnAmount: 269, workpaperAmount: 269, status: "TIE" },
    { lineItem: "Form 1040 Line 26 — Estimated tax payments", returnAmount: 54300, workpaperAmount: 54300, status: "TIE" },
    { lineItem: "Form 1040 Line 15 — Taxable income", returnAmount: 256147, workpaperAmount: 256147, status: "TIE" },
  ];
  const out = enforceNumericVerdicts({ tieOutResults: rows }, "1040");
  const byName = (re) => out.review.tieOutResults.find((r) => re.test(r.lineItem));
  // wages: diferencia real de 0.31 -> se leyo la fuente -> sigue siendo TIE
  assert.strictEqual(byName(/Line 1a/).status, "TIE");
  // lineas externas copiadas -> degradadas
  ["Line 2b", "Schedule D Line 7", "Schedule D Line 15", "Line 26"].forEach((n) => {
    assert.strictEqual(byName(new RegExp(n)).status, "NOT VERIFIED", n + " deberia quedar NOT VERIFIED");
  });
  // linea interna (calculo del propio return): un 0 es legitimo
  assert.strictEqual(byName(/Line 15 — Taxable/).status, "TIE");
  assert.strictEqual(out.unsupported, 4);
});

test("NOT VERIFIED bloquea la conclusion READY", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8");
  // eslint-disable-next-line no-eval
  const enforce = eval(`(${src.match(/function enforceFilingReadinessConsistency[\s\S]*?\n}/)[0]})`);
  const r = { issues: [], tieOutResults: [{ status: "TIE" }, { status: "NOT VERIFIED" }], openQuestions: [] };
  enforce(r);
  assert.strictEqual(r.filingReadiness, "NOT READY");
});
