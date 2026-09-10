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
  collapseLeaders, dedupePages, duplicateNotice,
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
/* --- Sacar lo que no es informacion ------------------------------------- */
//
// Dos pasos que existen por una razon economica concreta: sobre el paquete mas grande del
// estudio sacan el 33% de lo que se manda, y ese 33% es la diferencia entre un paquete que no
// entra en la ventana del modelo y uno que entra entero con dos pasadas.
//
// Lo unico que estas pruebas tienen que garantizar es que no se pierda un dato. Un ahorro que
// se come un importe no es un ahorro, es un error que ademas es barato.

const LEADER_LINE = "Check here if this is a publicly traded partnership . . . . . . . . . . . . . . . . . . >  X  [ANSWER: No]";

test("la guia de puntos se va y la casilla queda", () => {
  const out = collapseLeaders(LEADER_LINE);
  assert.doesNotMatch(out, /(?:[ \t]*\.){4,}/, "no puede quedar una guia de puntos");
  assert.ok(out.length < LEADER_LINE.length - 30, "tiene que achicar de verdad");
  assert.match(out, /publicly traded partnership/);
  assert.match(out, /\[ANSWER: No\]/, "la marca de casilla es justamente lo que no se puede perder");
  assert.match(out, /X/, "y la tilde tampoco");
});

test("no toca los importes ni los decimales", () => {
  const linea = "Ordinary business income . . . . . . . . . . . . . 1,234,567.89   2.5   0.075";
  const out = collapseLeaders(linea);
  for (const importe of ["1,234,567.89", "2.5", "0.075"]) {
    assert.ok(out.includes(importe), `desaparecio ${importe}`);
  }
});

test("tres puntos seguidos son puntos suspensivos, no una guia", () => {
  assert.strictEqual(collapseLeaders("pendiente... continua"), "pendiente... continua");
});

test("una columna de decimales no se confunde con una guia", () => {
  const linea = "1.5 2.5 3.5 4.5 5.5 6.5";
  assert.strictEqual(collapseLeaders(linea), linea);
});

/* --- Paginas repetidas --------------------------------------------------- */

const K1_PAGE = page(3, "Schedule K-1 (Form 1065) 2025\nPartner: CCD HOLDINGS LLC\nOrdinary business income 412,880\n" + filler(30));
const OTRO_K1 = page(3, "Schedule K-1 (Form 1065) 2025\nPartner: CCD HOLDINGS LLC\nOrdinary business income 517,004\n" + filler(30));
const INSTRUCCIONES = page(4, "Partner's Instructions for Schedule K-1\nThis list identifies the codes used on Schedule K-1\n" + filler(30));
// Ocho paginas es el minimo que splitPages considera estructura, asi que el armador tiene que
// llegar a ocho aunque no se le pase ninguna pagina extra.
const paquete = (...paginas) => [page(1, "Cover" + filler(20)), page(2, "Index" + filler(20)), ...paginas,
  page(5, "Tail A" + filler(20)), page(6, "Tail B" + filler(20)), page(7, "Tail C" + filler(20)),
  page(8, "Tail D" + filler(20)), page(9, "Tail E" + filler(20)), page(10, "Tail F" + filler(20))].join("");

test("el mismo K-1 mandado dos veces se manda una", () => {
  const r = dedupePages([
    { name: "K1 suelto.pdf", text: paquete(K1_PAGE, INSTRUCCIONES) },
    { name: "carpeta/K1 suelto.pdf", text: paquete(K1_PAGE, INSTRUCCIONES) },
  ]);
  assert.strictEqual(r.removedPages, 10, "el segundo archivo es identico entero");
  assert.strictEqual(r.documents[0].text.length, paquete(K1_PAGE, INSTRUCCIONES).length, "el primero queda intacto");
  assert.strictEqual(r.documents[1].text, "", "del segundo no queda nada");
});

test("dos K-1 con las mismas etiquetas y distintos importes NO se funden", () => {
  // Es el error que hay que no cometer: normalizar sacando los digitos hacia que estos dos
  // hashearan igual, y el segundo K-1 desaparecia con su importe adentro.
  const r = dedupePages([
    { name: "a.pdf", text: paquete(K1_PAGE) },
    { name: "b.pdf", text: paquete(OTRO_K1) },
  ]);
  assert.ok(r.documents[1].text.includes("517,004"), "el importe del segundo tiene que sobrevivir");
});

test("una pagina corta no se compara con nada", () => {
  // Dos paginas de un PDF escaneado que solo traen el numero de lote del escaner. Son cortas,
  // se parecen, y son lo unico que ese documento aporta.
  const corta = (n, id) => page(n, "010815 MS9COA01 " + id);
  const doc = [page(1, "A" + filler(20)), page(2, "B" + filler(20)), corta(3, "054074"), corta(4, "054075"),
    page(5, "C" + filler(20)), page(6, "D" + filler(20)), page(7, "E" + filler(20)), page(8, "F" + filler(20))].join("");
  const r = dedupePages([{ name: "escaneado.pdf", text: doc }]);
  assert.strictEqual(r.removedPages, 0);
  assert.ok(r.documents[0].text.includes("054074") && r.documents[0].text.includes("054075"));
});

test("ninguna cifra del paquete desaparece al deduplicar", () => {
  const docs = [
    { name: "a.pdf", text: paquete(K1_PAGE, INSTRUCCIONES) },
    { name: "b.pdf", text: paquete(OTRO_K1, INSTRUCCIONES) },
    { name: "c.pdf", text: paquete(K1_PAGE, INSTRUCCIONES) },
  ];
  const cifras = (t) => new Set(String(t).match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\b\d{2,}\b/g) || []);
  const antes = cifras(docs.map((d) => d.text).join("\n"));
  const r = dedupePages(docs.map((d) => ({ ...d, text: collapseLeaders(d.text) })));
  const despues = cifras(r.documents.map((d) => d.text).join("\n"));
  const perdidas = [...antes].filter((x) => !despues.has(x));
  assert.deepStrictEqual(perdidas, [], "la limpieza no puede perder un valor");
});

test("un documento sin estructura de paginas pasa sin tocarse", () => {
  const suelto = "una nota corta sin marcas de pagina";
  const r = dedupePages([{ name: "nota.txt", text: suelto }]);
  assert.strictEqual(r.documents[0].text, suelto);
  assert.strictEqual(r.removedPages, 0);
});

test("el aviso de duplicados dice que el modelo SI vio el contenido", () => {
  // Es lo contrario de removalNotice, y confundirlos tiene consecuencias: si al modelo se le
  // dice que no vio un K-1 que tiene delante, deja de cruzarlo.
  const aviso = duplicateNotice([{ page: 7, label: "Schedule K-1 (Form 1065)", sameAs: { name: "a.pdf", page: 3 } }]);
  assert.match(aviso, /You HAVE seen this content/);
  assert.doesNotMatch(aviso, /have NOT seen/);
  assert.match(aviso, /pages 7/);
  assert.strictEqual(duplicateNotice([]), "", "sin duplicados no se agrega ruido al prompt");
});
