"use strict";
// Que se le manda al modelo cuando la declaracion no entra entera.
//
// El caso que motiva todo esto, medido sobre un paquete real: una declaracion de 264 paginas
// recortada por el medio a 160.000 caracteres le entregaba al modelo las paginas 1 a 31 y las
// 232 a 264. El Formulario 1040 empieza en la pagina 48. El modelo nunca vio la declaracion.
//
// Estas pruebas fijan las dos cosas que no pueden volver a pasar: que se conserve por posicion
// en vez de por importancia, y que se saque una pagina sin dejar constancia de cual.
// Entidades, numeros y montos ficticios; el layout es el que produce pdf.js.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  selectPages, splitPages, classifyPage, removalNotice, pageLabel, TIER,
} = require("../lib/package-trim");

const page = (n, body) => `--- Page ${n} ---\n${body}\n`;
/** Relleno para que una pagina pese, sin parecerse a nada que el clasificador mire. */
const filler = (n) => Array(n).fill("  amounts and line items follow on this page").join("\n");

const COVER = page(1, "CERTIFAI CPA\n111 TOWN SQUARE PL\nDear client,\nYour 2025 Federal Individual Income Tax return will be\nelectronically filed. Mail your California payment voucher on or before April 15, 2026.");
const SUMMARY = page(2, "2025 FEDERAL INCOME TAX SUMMARY PAGE 1\n" + filler(40));
const ESTIMATES = page(3, "2025 2026 FEDERAL ESTIMATED TAX WORKSHEET PAGE 1\n" + filler(40));
const VOUCHER = page(4, "FILE ONLY IF YOU ARE MAKING A PAYMENT WITH FORM 1040. RETURN THIS VOUCHER WITH\n" + filler(20));
const CONSENT = page(5, "2025 Agency Disclosure Statements Agency Disclosure Statements Page 1\n" + filler(20));
const EFILE = page(6, "Form 8879 IRS e-file Signature Authorization\n" + filler(20));
const MAILTO = page(7, "Mail to: INTERNAL REVENUE SERVICE\nP.O. BOX 931000\nLOUISVILLE, KY 40293-1000");
const F1040 = page(8, "Form 1040 2025 U.S. Individual Income Tax Return\nMERIDIAN TAXPAYER 099-72-3045\n" + filler(60));
const SCHED_D = page(9, "SCHEDULE D OMB No. 1545-0074\nCapital Gains and Losses\n" + filler(60));
const K1 = page(10, "Schedule K-1 (Form 1065) 2025 Partner's Share of Income\n" + filler(60));
const CA_RETURN = page(11, "2025 CALIFORNIA INCOME TAX SUMMARY PAGE 1\nFranchise Tax Board\n" + filler(60));
const GA_RETURN = page(12, "Georgia Form 500\nIndividual Income Tax Return\n" + filler(20) + "\nMail to: GEORGIA DEPARTMENT OF REVENUE");
const RECORD = page(13, "Record of Estimated Tax Payments\n2025 payments applied\n" + filler(20));

const PACKAGE = [COVER, SUMMARY, ESTIMATES, VOUCHER, CONSENT, EFILE, MAILTO, F1040, SCHED_D, K1, CA_RETURN, GA_RETURN, RECORD].join("");

const tierOf = (p) => classifyPage(p).tier;

test("el nucleo federal se clasifica como nucleo", () => {
  assert.strictEqual(tierOf(F1040), TIER.CORE);
  assert.strictEqual(tierOf(SCHED_D), TIER.CORE);
  assert.strictEqual(tierOf(K1), TIER.CORE);
});

test("lo que nunca es materia de revision se marca para sacar", () => {
  assert.strictEqual(tierOf(ESTIMATES), TIER.DROP, "hoja de estimados del año siguiente");
  assert.strictEqual(tierOf(VOUCHER), TIER.DROP, "voucher de pago");
  assert.strictEqual(tierOf(CONSENT), TIER.DROP, "consentimiento");
  assert.strictEqual(tierOf(EFILE), TIER.DROP, "autorizacion de e-file");
  assert.strictEqual(tierOf(MAILTO), TIER.DROP, "instrucciones de envio");
});

test("la carta al cliente NO se saca: dice los saldos por jurisdiccion", () => {
  // Decia "mail your California payment voucher" y la primera version la leyo como un voucher.
  assert.notStrictEqual(tierOf(COVER), TIER.DROP);
});

test("una declaracion estatal con la direccion de envio en el cuerpo NO se saca", () => {
  // Georgia Form 500 trae "Mail to: GEORGIA DEPARTMENT OF REVENUE" abajo. Es una declaracion.
  assert.strictEqual(tierOf(GA_RETURN), TIER.STATE);
});

test("el registro de pagos de estimados se conserva: hace falta para el safe harbor del 6654", () => {
  assert.notStrictEqual(tierOf(RECORD), TIER.DROP);
});

test("las estatales se distinguen del nucleo federal", () => {
  assert.strictEqual(tierOf(CA_RETURN), TIER.STATE);
});

test("sin presupuesto que apriete, solo se va lo que nunca es materia de revision", () => {
  const r = selectPages(PACKAGE, Infinity);
  assert.ok(r.trimmed);
  assert.ok(r.text.includes("Form 1040 2025"), "el 1040 tiene que quedar");
  assert.ok(r.text.includes("SCHEDULE D"), "el Schedule D tiene que quedar");
  assert.ok(r.text.includes("Schedule K-1"), "el K-1 tiene que quedar");
  assert.ok(r.text.includes("Georgia Form 500"), "la estatal tiene que quedar");
  assert.ok(!r.text.includes("ESTIMATED TAX WORKSHEET"), "los estimados de 2026 se van");
  assert.ok(!r.text.includes("Form 8879"), "la autorizacion de e-file se va");
});

test("cuando el presupuesto aprieta, el nucleo federal sobrevive a lo estatal", () => {
  // Presupuesto para poco mas que las tres paginas del nucleo.
  const core = [F1040, SCHED_D, K1].reduce((n, p) => n + p.length, 0);
  const r = selectPages(PACKAGE, core + 200);
  assert.ok(r.text.includes("Form 1040 2025"), "el 1040 no puede salir antes que una estatal");
  assert.ok(r.text.includes("SCHEDULE D"));
  assert.ok(r.text.includes("Schedule K-1"));
  assert.ok(!r.text.includes("CALIFORNIA"), "la estatal sale primero");
});

test("todo lo que se saca queda en el manifiesto, con numero de pagina", () => {
  const r = selectPages(PACKAGE, 6000);
  const aviso = removalNotice(r.removed, r.pageCount);
  assert.match(aviso, /PAGES NOT INCLUDED/);
  assert.match(aviso, /You have NOT seen the pages listed above/);
  assert.match(aviso, /never infer what it contained/);
  for (const item of r.removed) {
    assert.ok(Number.isFinite(item.page), "cada pagina sacada tiene numero");
    assert.ok(aviso.includes(String(item.page)), `la pagina ${item.page} tiene que figurar en el manifiesto`);
  }
});

test("el manifiesto esta vacio cuando no se saco nada", () => {
  assert.strictEqual(removalNotice([], 10), "");
});

test("un documento sin marcas de pagina no se toca", () => {
  const plano = "Form 1040 2025\n" + filler(500);
  const r = selectPages(plano, 100);
  assert.strictEqual(r.pageCount, 0);
  assert.strictEqual(r.trimmed, false);
  assert.strictEqual(r.text, plano, "sin estructura devuelve el original intacto");
});

test("un documento con muy pocas paginas no se analiza", () => {
  const chico = [F1040, SCHED_D, VOUCHER].join("");
  assert.deepStrictEqual(splitPages(chico), []);
  assert.strictEqual(selectPages(chico, 100).pageCount, 0);
});

test("si la limpieza se comiera media declaracion, no limpia nada", () => {
  // Doce vouchers y una pagina de nucleo: sacar el 90% seria un error del clasificador.
  const sospechoso = Array.from({ length: 12 }, (_, i) => page(i + 1, "FILE ONLY IF YOU ARE MAKING A PAYMENT\n" + filler(30))).join("") + page(13, "Form 1040 2025\n" + filler(30));
  const r = selectPages(sospechoso, Infinity);
  assert.strictEqual(r.trimmed, false, "por encima del umbral de seguridad no se toca nada");
  assert.strictEqual(r.text, sospechoso);
});

test("las paginas conservadas mantienen su marcador y su orden", () => {
  const r = selectPages(PACKAGE, Infinity);
  const numeros = [...r.text.matchAll(/^--- Page (\d+) ---$/gm)].map((m) => Number(m[1]));
  assert.deepStrictEqual(numeros, [...numeros].sort((a, b) => a - b), "el orden no cambia");
  assert.ok(numeros.includes(8), "el 1040 sigue identificado por su numero de pagina");
});

test("pageLabel devuelve el encabezado, no el marcador", () => {
  assert.strictEqual(pageLabel(F1040), "Form 1040 2025 U.S. Individual Income Tax Return");
  assert.strictEqual(pageLabel("--- Page 3 ---\n\n\n"), "pagina en blanco");
});

test("el texto conservado nunca supera el presupuesto por mas de una pagina", () => {
  for (const budget of [3000, 8000, 20000]) {
    const r = selectPages(PACKAGE, budget);
    if (!r.pageCount) continue;
    assert.ok(r.text.length <= budget, `con presupuesto ${budget} devolvio ${r.text.length}`);
  }
});
