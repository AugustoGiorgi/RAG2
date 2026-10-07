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
/* --- Lo que se saca a proposito no es un faltante ----------------------- */
//
// Un 1065 y un 1040 seguidos listaron el 8879 como "documento faltante — page not provided",
// con el formulario en la pagina 11 de uno y en la 21 del otro. El aviso decia lo mismo para lo
// que se saca por ser tramite que para lo que no entra en el presupuesto.

test("lo que se saca por ser tramite se marca como intencional", () => {
  const r = selectPages(PACKAGE, Infinity);
  const efile = r.removed.find((i) => i.page === 6);
  assert.strictEqual(efile.intentional, true);
});

test("el aviso de lo intencional dice que existe y que no se reporta como faltante", () => {
  const r = selectPages(PACKAGE, Infinity);
  const aviso = removalNotice(r.removed, r.pageCount);
  assert.match(aviso, /LEFT OUT ON PURPOSE/);
  assert.match(aviso, /These pages EXIST in the return/);
  assert.match(aviso, /Do NOT list them in missingDocuments/);
  assert.doesNotMatch(aviso, /You have NOT seen the pages listed above/, "sin recorte por presupuesto no hay aviso de hueco");
});

test("lo que no entra en el presupuesto conserva el aviso de siempre", () => {
  const r = selectPages(PACKAGE, 6000);
  const aviso = removalNotice(r.removed, r.pageCount);
  assert.match(aviso, /LEFT OUT ON PURPOSE/, "los tramites van en su propio bloque");
  assert.match(aviso, /PAGES NOT INCLUDED/);
  assert.match(aviso, /You have NOT seen the pages listed above/);
  const huecos = aviso.slice(aviso.indexOf("PAGES NOT INCLUDED"));
  assert.doesNotMatch(huecos, /autorizacion de e-file/, "el 8879 no figura entre los huecos");
});

/* --- El ZIP de soporte ---------------------------------------------------- */
//
// Un paquete real de 79 archivos y 936 paginas, mas grande que lo que entra en una revision.
// Se recortaba desde el final del ZIP: los dos W-2 y nueve de dieciseis K-1 no se mandaron,
// dos contratos de 55.000 caracteres cada uno si, y el informe no decia una palabra de eso.
// Todos los nombres, importes y textos de aca son inventados.

const {
  splitUnits, classifyDocument, returnStates, omittedFiles, omissionNote, sizes,
} = require("../lib/package-trim");

/** Un PDF como lo deja el navegador: paginas separadas por una linea en blanco. */
const pdf = (...bodies) => bodies.map((body, i) => `--- Page ${i + 1} ---\n${body}`).join("\n\n");
/** El ZIP como lo arma el navegador: un encabezado por archivo y una linea en blanco entre archivos. */
const zip = (...entries) => entries.map(([name, text]) => `--- ZIP ENTRY: ${name} ---\n${text}`).join("\n\n");

const CONTRACT_TEXT = Array.from({ length: 40 }, (_, i) => `${i + 1}. WHEREAS the parties hereto agree that notice is deemed given on the recipient's next business day, and the terms hereof bind the Stockholders as set forth herein.`).join("\n");
const K1_FACE = "Schedule K-1 (Form 1065) 2025\nPartner's Share of Income, Deductions, Credits, etc.\nHARBOR RIDGE FUND LP 98-7654321\nOrdinary business income 41,250\n" + filler(20);
const K1_STATEMENT = "HARBOR RIDGE FUND LP 98-7654321\nStatement 1 - Line 13, code ZZ other deductions 7,310\n" + filler(20);
const K3 = (n) => `Schedule K-3 (Form 1065) 2025 Page ${n}\nPartner's Share of Income, Deductions, Credits, etc. - International\n` + filler(20);
const NY_K1 = "Department of Taxation and Finance\nNew York Partner's Schedule K-1 IT-204-IP\nPartner's share of income 41,250\n" + filler(20);
const NJ_K1 = "Schedule NJK-1 State of New Jersey\nPartner's Share of Income Form NJ-1065\nDistributive share 3,120\n" + filler(20);
const W2_FACE = "a Employee's social security number 000-00-0000\nc Employer's name, address\nNORTHGATE SUPPLY CO 400 BROADWAY NEW YORK NY 10013\n1 Wages, tips, other compensation 88,400.00 2 Federal income tax withheld 13,260.00\nForm W-2 Wage and Tax Statement 2025\n" + filler(8);
const INT_1099 = "PAYER'S name RIVERBEND SAVINGS BANK\nForm 1099-INT Interest Income 2025\n1 Interest income 1,204.18\n" + filler(8);

const FUND_K1 = pdf(K1_FACE, K1_STATEMENT, K3(1), K3(2), K3(3), NJ_K1, NY_K1);
// El orden es el de una carpeta de cliente: el contrato primero y el W-2 al final.
const SUPPORT = zip(
  ["Docs/Agreements/Stock Purchase Agreement.pdf", pdf(CONTRACT_TEXT.slice(0, 3000), CONTRACT_TEXT.slice(3000))],
  ["Docs/K-1/Harbor Ridge K-1.pdf", FUND_K1],
  ["Docs/1099/Riverbend 1099-INT.pdf", pdf(INT_1099)],
  ["Docs/W-2/Northgate W-2.pdf", pdf(W2_FACE, "Instructions for Employee\n" + filler(10))],
);
const weightOf = (units, keepIf) => units.filter(keepIf).reduce((n, u) => n + u.text.length, 0);
/** El presupuesto justo para todo menos los contratos y las paginas K-3. */
const WITHOUT_LOW = SUPPORT.length - weightOf(classifyDocument(SUPPORT), (u) => u.tier === TIER.LEGAL || u.tier === TIER.K3) + 300;
const sectionOf = (text, name) => text.split(/\n(?=--- ZIP ENTRY: )/).find((s) => s.startsWith(`--- ZIP ENTRY: ${name} ---`)) || "";

test("ZIP: cada pagina sabe de que archivo es, y unidas dan el original", () => {
  const units = splitUnits(SUPPORT);
  assert.strictEqual(units.length, 12);
  assert.strictEqual(new Set(units.map((u) => u.entry)).size, 4);
  assert.strictEqual(units.map((u) => u.header + u.text).join(""), SUPPORT, "encabezados y paginas son el original, caracter por caracter");
  assert.strictEqual(selectPages(SUPPORT, Infinity).text, SUPPORT, "sin presupuesto que apriete no se toca nada");
});

test("ZIP: un paquete de pocas paginas no se analiza, igual que un documento chico", () => {
  const chico = zip(["a.pdf", pdf(W2_FACE)], ["b.pdf", pdf(INT_1099)]);
  assert.deepStrictEqual(splitUnits(chico), []);
  assert.strictEqual(selectPages(chico, 100).pageCount, 0);
});

test("ZIP: la cara de un W-2 con direccion en Nueva York es nucleo, no una declaracion estatal", () => {
  const w2 = classifyDocument(SUPPORT).find((u) => /Northgate W-2/.test(u.entry) && u.number === 1);
  assert.strictEqual(w2.tier, TIER.CORE);
  // Con las reglas de una declaracion la misma pagina es estatal: de ahi venia el problema.
  assert.strictEqual(classifyPage(`--- Page 1 ---\n${W2_FACE}`).tier, TIER.STATE);
});

test("ZIP: lo primero que se resigna son los contratos y el Schedule K-3; el W-2 del final se queda", () => {
  const r = selectPages(SUPPORT, WITHOUT_LOW);
  assert.ok(!r.text.includes("WHEREAS"), "el contrato se va entero");
  assert.ok(!r.text.includes("Schedule K-3 (Form 1065)"), "y las paginas K-3");
  assert.ok(r.text.includes("88,400.00"), "el W-2 esta al final del ZIP, que era lo primero que se perdia");
  assert.ok(r.text.includes("1,204.18") && r.text.includes("41,250") && r.text.includes("7,310"), "el 1099 y la cara y el anexo del K-1 siguen");
  assert.ok(r.text.includes("NJK-1") && r.text.includes("IT-204-IP"), "lo estatal todavia entraba");
  assert.deepStrictEqual([...new Set(r.removed.map((i) => i.why))].sort(), ["Schedule K-3", "contrato o documento societario"]);
  assert.ok(r.text.length <= WITHOUT_LOW, "y lo que queda entra en el presupuesto");
});

test("ZIP: el encabezado de un archivo no se despega de sus paginas", () => {
  // Viajaba pegado a la ultima pagina del archivo anterior. Al sacar esa pagina se iba con
  // ella, y el modelo leia el 1099 debajo del nombre del K-1.
  const r = selectPages(SUPPORT, WITHOUT_LOW);
  assert.ok(sectionOf(r.text, "Docs/1099/Riverbend 1099-INT.pdf").includes("1,204.18"));
  assert.ok(sectionOf(r.text, "Docs/W-2/Northgate W-2.pdf").includes("88,400.00"));
  const k1 = sectionOf(r.text, "Docs/K-1/Harbor Ridge K-1.pdf");
  assert.ok(k1.includes("41,250") && !k1.includes("1,204.18") && !k1.includes("88,400.00"));
});

test("ZIP: debajo del encabezado queda dicho que paginas de ese archivo no se mandaron", () => {
  const r = selectPages(SUPPORT, WITHOUT_LOW);
  assert.match(sectionOf(r.text, "Docs/K-1/Harbor Ridge K-1.pdf"), /\[SERVER NOTE: not sent to you from this file — pages 3-5 of 7 \(Schedule K-3 pages\)\. See the note at the end of this document\.\]/);
  assert.strictEqual(sectionOf(r.text, "Docs/Agreements/Stock Purchase Agreement.pdf"), "", "de un archivo del que no queda nada no va ni el encabezado");
  const aviso = removalNotice(r.removed, r.pageCount);
  assert.match(aviso, /"Docs\/Agreements\/Stock Purchase Agreement\.pdf" \(all 2 pages\)/, "a ese lo nombra el aviso del final");
  assert.match(aviso, /"Docs\/K-1\/Harbor Ridge K-1\.pdf" \(pages 3-5 of 7\)/);
  assert.match(aviso, /These pages ARE in the client's package/);
  assert.match(aviso, /Do NOT list them in missingDocuments and do NOT ask the client for them/, "no es un documento que falte: el cliente ya lo mando");
  assert.match(aviso, /You have NOT seen them/);
});

test("ZIP: si hay que sacar K-1 estatales, los del estado de la declaracion son los ultimos", () => {
  const RETURN = [
    page(1, "Form 1040 2025 U.S. Individual Income Tax Return\n" + filler(30)),
    ...Array.from({ length: 4 }, (_, i) => page(i + 2, "Department of Taxation and Finance\nResident Income Tax Return IT-201\n" + filler(30))),
    ...Array.from({ length: 4 }, (_, i) => page(i + 6, "SCHEDULE D Capital Gains and Losses\n" + filler(30))),
  ].join("");
  const home = returnStates([RETURN, SUPPORT]);
  assert.deepStrictEqual([...home], ["NEW YORK"], "el paquete presenta declaracion por Nueva York");
  const units = classifyDocument(SUPPORT, { homeStates: home });
  assert.strictEqual(units.find((u) => u.text.includes("IT-204-IP")).tier, TIER.HOME_STATE);
  assert.strictEqual(units.find((u) => u.text.includes("NJK-1")).tier, TIER.STATE);
  const r = selectPages(SUPPORT, SUPPORT.length - weightOf(units, (u) => u.tier < TIER.HOME_STATE) + 300, { homeStates: home });
  assert.ok(r.text.includes("IT-204-IP"), "el K-1 de Nueva York se queda");
  assert.ok(!r.text.includes("NJK-1"), "el de Nueva Jersey sale antes");
  // La carta que nombra California y una sola pagina de resumen no alcanzan: hacen falta dos
  // paginas que lleven el estado en el encabezado.
  assert.deepStrictEqual([...returnStates([PACKAGE])], []);
});

test("ZIP: una declaracion que viene adentro se clasifica como cualquier declaracion", () => {
  const inside = pdf(
    "Form 1040 2025 U.S. Individual Income Tax Return\n" + filler(30),
    "2025 CALIFORNIA INCOME TAX SUMMARY PAGE 1\nFranchise Tax Board\n" + filler(30),
    "Dear client,\n" + filler(10),
    "Form 8879 IRS e-file Signature Authorization\n" + filler(10),
  );
  const units = classifyDocument(zip(["Return/2025 return.pdf", inside], ["Docs/K-1/Harbor Ridge K-1.pdf", FUND_K1]));
  assert.deepStrictEqual(units.filter((u) => u.entry === "Return/2025 return.pdf").map((u) => u.tier), [TIER.CORE, TIER.STATE, TIER.ADMIN, TIER.DROP]);
});

test("ZIP: un contrato se reconoce por como esta escrito, y un K-1 con notas legales sigue siendo un K-1", () => {
  const padding = ["a/relleno.pdf", pdf(...Array.from({ length: 8 }, (_, i) => `${K1_STATEMENT}\nitem ${i}`))];
  const kind = (text) => classifyDocument(zip(["a/uno", text], padding))[0].kind;
  assert.strictEqual(kind(pdf(CONTRACT_TEXT)), "legal");
  // "On the recipient's next business day" no es la casilla RECIPIENT'S de un 1099: la primera
  // version se quedaba con cualquier "recipient's" y los contratos mas largos pasaban por comprobantes.
  assert.match(CONTRACT_TEXT, /recipient's next business day/);
  // Las notas al pie de un fondo usan las mismas palabras, pero pesan mas las marcas del formulario.
  const footnotes = "The terms hereof are set forth herein and in the agreement attached hereto.\nSchedule K-1 (Form 1065) OMB No. 1545-0123\nSchedule K-1 (Form 1065)\n";
  assert.strictEqual(kind(pdf(K1_FACE + "\n" + footnotes, K1_STATEMENT)), "support");
  // Una nota del cliente no es un contrato por venir en Word.
  assert.strictEqual(kind("We sold the rental on June 3 for 410,000 and bought the new one in August.\n" + filler(20)), "support");
});

test("ZIP: un Word no tiene paginas, se parte en tramos y pierde el final antes que el principio", () => {
  const memo = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}: a note about the year, nothing a form would print.`).join("\n");
  const text = zip(["Notes/memo.docx", memo], ["Docs/1099/Riverbend.pdf", pdf(...Array.from({ length: 8 }, (_, i) => `${INT_1099}\naccount ${i}`))]);
  const parts = splitUnits(text).filter((u) => u.entry === "Notes/memo.docx");
  assert.ok(parts.length > 2 && parts.every((u) => u.pseudo), "varios tramos");
  assert.strictEqual(parts.map((u) => u.text).join("").trimEnd(), memo, "que unidos son el archivo");
  assert.strictEqual(selectPages(text, Infinity).text, text);
  const r = selectPages(text, text.length - 4000);
  assert.ok(r.text.includes("Line 1:"), "el principio queda");
  assert.ok(!r.text.includes("Line 200:"), "el final sale");
  assert.match(sectionOf(r.text, "Notes/memo.docx"), /\[SERVER NOTE: not sent to you from this file — part/);
});

test("ZIP: el encabezado sobrevive aunque todas sus paginas ya esten en otro archivo", () => {
  const twice = zip(["K-1/Harbor Ridge K-1.pdf", FUND_K1], ["Duplicates/Harbor Ridge K-1 (1).pdf", FUND_K1], ["1099/Riverbend 1099-INT.pdf", pdf(INT_1099)]);
  const r = dedupePages([{ name: "Docs.zip", text: twice }]);
  assert.strictEqual(r.removedPages, 7, "el segundo K-1 es el primero, pagina por pagina");
  const text = r.documents[0].text;
  assert.ok(text.includes("--- ZIP ENTRY: Duplicates/Harbor Ridge K-1 (1).pdf ---"), "el archivo sigue nombrado");
  assert.ok(sectionOf(text, "1099/Riverbend 1099-INT.pdf").includes("1,204.18"), "y el siguiente sigue debajo de su propio encabezado");
  assert.ok(!sectionOf(text, "Duplicates/Harbor Ridge K-1 (1).pdf").includes("1,204.18"));
  const aviso = duplicateNotice(r.documents[0].duplicates);
  assert.match(aviso, /"Duplicates\/Harbor Ridge K-1 \(1\)\.pdf" \(all 7 pages\)/, "en un ZIP se nombra el archivo, no el numero de pagina");
  assert.match(aviso, /You HAVE seen this content/);
});

test("ZIP: el informe dice que archivos no se mandaron y a cuales les faltan paginas", () => {
  const r = selectPages(SUPPORT, WITHOUT_LOW);
  const nota = omissionNote(omittedFiles(r.removed, r.pageCount, "Docs.zip"));
  assert.match(nota, /^NOT READ BY THIS REVIEW: the package is larger than one review can read, so 5 pages of 2 files were left out, least important first\./);
  assert.match(nota, /Not sent at all — contracts and corporate documents, which are not tax forms: Stock Purchase Agreement\.pdf\./);
  assert.match(nota, /Sent without some pages — Schedule K-3 pages, 3 pages of Harbor Ridge K-1\.pdf\./);
  assert.match(nota, /Check these by hand if they bear on the return\.$/);
  // Lo que se saca a proposito no es algo que el revisor tenga que abrir.
  const paperwork = selectPages(PACKAGE, Infinity);
  assert.ok(paperwork.removed.length > 0);
  assert.strictEqual(omissionNote(omittedFiles(paperwork.removed, paperwork.pageCount, "return.pdf")), "");
  assert.strictEqual(omissionNote([]), "");
});

test("una declaracion recortada por tamaño tambien queda dicha en el informe", () => {
  const r = selectPages(PACKAGE, 6000);
  const nota = omissionNote(omittedFiles(r.removed, r.pageCount, "Returns/2025 return.pdf"));
  assert.match(nota, /Sent without some pages — /);
  assert.match(nota, /state return pages, 3 pages of 2025 return\.pdf/);
  assert.doesNotMatch(nota, /e-file/, "el 8879 no es parte de lo que falto revisar");
});

test("ZIP: los contratos y el K-3 no son algo que el reparto entre documentos tenga que asegurar", () => {
  const measured = sizes(SUPPORT);
  const units = classifyDocument(SUPPORT);
  assert.strictEqual(measured.full, SUPPORT.length);
  assert.strictEqual(measured.main, SUPPORT.length - weightOf(units, (u) => u.tier === TIER.LEGAL || u.tier === TIER.K3));
  assert.ok(measured.core < measured.main, "lo estatal no es nucleo");
  // En un documento que no es un ZIP no hay escalon de abajo: main y full son el mismo numero.
  const plain = sizes(PACKAGE);
  assert.strictEqual(plain.main, plain.full);
});
