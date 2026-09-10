"use strict";

/**
 * package-trim.js — decidir QUE se le saca a una declaracion cuando no entra entera.
 *
 * El problema que resuelve, medido y no supuesto. La revision recortaba cada documento por el
 * medio a 160.000 caracteres. Una declaracion 1040 real de este estudio tiene 264 paginas y
 * 795.000 caracteres. El recorte por el medio conserva el principio y el final, asi que lo que
 * llegaba al modelo eran las paginas 1 a 31 y las 232 a 264: la carta al cliente, los resumenes
 * estatales, los consentimientos y las hojas de estimados de 2026. El Formulario 1040 empieza
 * en la pagina 48. Es decir: el modelo nunca vio el 1040, ni el Schedule A, B, C, D o E, ni el
 * 8960, ni el 8582, ni un solo K-1. Se le pidio revisar una declaracion y se le mando la carta
 * de presentacion.
 *
 * Sobre los siete paquetes de prueba, solo el mas chico llegaba completo. Los otros perdian
 * entre el 20% y el 82%. Cualquier medicion de "que tan bien lee el modelo" hecha antes de esto
 * estaba midiendo otra cosa.
 *
 * Que hace este modulo: corta por PAGINA y por PRIORIDAD, nunca por posicion. Primero saca lo
 * que no es materia de revision (vouchers del año que viene, consentimientos, autorizaciones de
 * e-file). Si todavia no entra, saca por orden de menor valor y DEJA CONSTANCIA EXACTA de que
 * saco, con numero de pagina y nombre de formulario, para que el modelo pueda decir "no vi el
 * Schedule E" en vez de inventar que lo vio.
 *
 * Fail-safe, no fail-closed: si el clasificador no reconoce la estructura del documento, o si
 * quisiera sacar mas de lo razonable, no toca nada y devuelve el texto original. Un clasificador
 * que se come la declaracion es peor que ningun clasificador.
 */

/** El marcador que pone el extractor de pdf.js entre paginas. */
const PAGE_MARKER = /^--- Page (\d+) ---$/gm;

/**
 * Prioridad de una pagina. Mas alto se conserva primero.
 *
 *   3 CORE   formularios y anexos federales, K-1, W-2, 1099, depreciacion, statements
 *   2 STATE  declaraciones estatales
 *   1 ADMIN  carta al cliente, resumenes, informacion general
 *   0 DROP   nada de esto es materia de revision de la declaracion del año en curso
 */
const TIER = { CORE: 3, STATE: 2, ADMIN: 1, DROP: 0 };

/**
 * Lo unico que se saca siempre. Todo lo de aca describe el año SIGUIENTE, o es un tramite de
 * presentacion, o es un consentimiento: ninguno puede contener un error de la declaracion que
 * se esta revisando.
 *
 * Ojo con una excepcion que no es obvia: "Record of Estimated Tax Payments" NO entra aca. Esa
 * pagina dice lo que el contribuyente efectivamente pago, y hace falta para el safe harbor del
 * §6654. Lo que se saca es la HOJA DE CALCULO de los estimados del año que viene.
 *
 * Se evaluan contra el ENCABEZADO de la pagina, no contra su cuerpo. La primera version miraba
 * los primeros 900 caracteres y se comio dos cosas que no debia: la carta de presentacion, que
 * dice "mail your payment voucher" y por eso parecia un voucher, y una declaracion de Georgia
 * entera, porque en el cuerpo traia la direccion de envio del estado. Una pagina se clasifica
 * por lo que ES, y eso lo dice su titulo.
 */
const DROP_ALWAYS = [
  { re: /20\d{2}\s+ESTIMATED TAX WORKSHEET|ESTIMATED TAX (?:WORKSHEETS?|COMPUTATION WORKSHEE)/i, why: "hoja de estimados del año siguiente" },
  { re: /FILE ONLY IF YOU ARE MAKING A PAYMENT|^\s*Form 1040-ES\b|^\s*Form 1040-V\b|PAYMENT VOUCHER\s*$/i, why: "voucher de pago" },
  { re: /Agency Disclosure Statement|Consent to (?:Disclose|Use) Tax Return Information/i, why: "consentimiento de divulgacion" },
  { re: /e-file Signature Authorization|^\s*(?:Form\s*)?8879\b|^\s*[A-Z]{2}-8879\b/i, why: "autorizacion de e-file" },
  { re: /^\s*Mail to:/i, why: "instrucciones de envio" },
];

/** Una pagina que no es del año que se revisa y no es del anterior no es materia de revision. */
const STATE_PAGE = /\b(?:ARIZONA|CALIFORNIA|COLORADO|CONNECTICUT|GEORGIA|ILLINOIS|NEW JERSEY|NEW YORK|OREGON|SOUTH CAROLINA|WISCONSIN|MASSACHUSETTS|MARYLAND|VIRGINIA|PENNSYLVANIA|MICHIGAN|MINNESOTA|OHIO|NORTH CAROLINA|MISSOURI|INDIANA|ALABAMA|LOUISIANA|KENTUCKY|IOWA|KANSAS|OKLAHOMA|ARKANSAS|UTAH|IDAHO|MONTANA|NEBRASKA|MAINE|VERMONT|RHODE ISLAND|DELAWARE|HAWAII|WEST VIRGINIA|MISSISSIPPI|NEW MEXICO|DISTRICT OF COLUMBIA)\b|Franchise Tax Board|Department of Taxation and Finance|\bIT-2\d{2}\b|\bCA 540\b|\bAZ 140\b|\bIL-1040\b|\bNJ-1040\b|\bOR-40\b|\bSC1040\b/i;

const ADMIN_PAGE = /INCOME TAX SUMMARY|FINANCIAL TRANSACTION SUMMARY|GENERAL INFORMATION PAGE|TAX SUMMARY PAGE|^\s*Dear /im;

const CORE_PAGE = /\bForm\s*(?:1040|1065|1120|990|709|706|3115|4562|4797|8582|8825|8949|8959|8960|8995|7203|8308|2555|1116|6251|8283|8863|5471|8865|8938|1125)|SCHEDULE\s+[A-Z0-9]|Schedule\s+[A-Z0-9]\s*\(Form|Schedule K-1|\bW-2\b|\b1099-[A-Z]{1,4}\b|Depreciation and Amortization|Statement\s+\d+/;

/**
 * Cuanto puede sacar el paso de limpieza antes de que se lo tome por un error del clasificador.
 * En la muestra el maximo real fue 20%; 45% es holgura, no una expectativa.
 */
const MAX_TRIM_SHARE = 0.45;
/** Debajo de esto no hay estructura de paginas que valga la pena analizar. */
const MIN_PAGES = 8;

/** Corta el texto en paginas conservando el marcador. Devuelve [] si no hay estructura. */
function splitPages(text) {
  const source = String(text || "");
  const marks = [...source.matchAll(PAGE_MARKER)];
  if (marks.length < MIN_PAGES) return [];
  const pages = [];
  // Lo que viene antes de la primera marca es preambulo: se conserva siempre, pegado a la
  // primera pagina, porque ahi suele estar el encabezado del documento.
  const preamble = source.slice(0, marks[0].index);
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : source.length;
    pages.push({
      number: Number(marks[i][1]),
      text: (i === 0 ? preamble : "") + source.slice(start, end),
    });
  }
  return pages;
}

/** Las primeras lineas con contenido de una pagina: su encabezado. */
function headingOf(pageText) {
  const out = [];
  for (const raw of String(pageText || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^--- Page \d+ ---$/.test(line)) continue;
    out.push(line);
    if (out.length >= 3) break;
  }
  return out.join("\n");
}

/**
 * En que se convierte una pagina para el que decide que sacar.
 *
 * Lo que se saca siempre se decide por el encabezado — un titulo dice que ES la pagina. Lo que
 * se conserva se decide mirando mas texto, porque ahi el sesgo tiene que ir hacia conservar: es
 * preferible dejar entrar una pagina administrativa que dejar afuera un Schedule.
 */
function classifyPage(pageText) {
  const heading = headingOf(pageText);
  for (const rule of DROP_ALWAYS) {
    if (rule.re.test(heading)) return { tier: TIER.DROP, why: rule.why };
  }
  const head = String(pageText || "").slice(0, 900);
  if (CORE_PAGE.test(head) && !STATE_PAGE.test(heading)) return { tier: TIER.CORE, why: "formulario federal" };
  if (STATE_PAGE.test(head)) return { tier: TIER.STATE, why: "declaracion estatal" };
  if (ADMIN_PAGE.test(head)) return { tier: TIER.ADMIN, why: "resumen o carta" };
  // Sin señal, se trata como nucleo. El sesgo va siempre hacia conservar.
  return { tier: TIER.CORE, why: "sin clasificar, se conserva" };
}

/** Como se nombra una pagina en el manifiesto, para que el manifiesto sirva de algo. */
function pageLabel(pageText) {
  const lines = String(pageText || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^--- Page \d+ ---$/.test(line)) continue;
    return line.slice(0, 70);
  }
  return "pagina en blanco";
}

/**
 * Elige que paginas entran en el presupuesto.
 *
 * Devuelve siempre { text, removed, trimmed, pageCount }. Si no puede analizar el documento, o
 * si el resultado seria sospechoso, devuelve el texto original con trimmed:false — el que llama
 * decide entonces que hacer, normalmente recortar por el medio como antes.
 */
function selectPages(text, budget) {
  const source = String(text || "");
  const limit = Number(budget || 0);
  const pages = splitPages(source);
  if (!pages.length) return { text: source, removed: [], trimmed: false, pageCount: 0 };

  const classified = pages.map((page) => ({ ...page, ...classifyPage(page.text) }));
  const total = classified.reduce((sum, p) => sum + p.text.length, 0);

  // Paso 1: sacar lo que nunca es materia de revision, entre entero o no.
  const alwaysGone = classified.filter((p) => p.tier === TIER.DROP);
  const goneChars = alwaysGone.reduce((sum, p) => sum + p.text.length, 0);
  const cleanupSuspicious = goneChars > total * MAX_TRIM_SHARE;
  let keep = cleanupSuspicious ? classified.slice() : classified.filter((p) => p.tier !== TIER.DROP);
  const removed = cleanupSuspicious
    ? []
    : alwaysGone.map((p) => ({ page: p.number, why: p.why, label: pageLabel(p.text) }));

  // Paso 2: si todavia no entra, sacar por prioridad — primero lo administrativo, despues lo
  // estatal, y el nucleo federal solo si no queda otra. Dentro de cada nivel, las ultimas
  // paginas primero, que es donde estan los anexos repetidos.
  let kept = keep.reduce((sum, p) => sum + p.text.length, 0);
  if (Number.isFinite(limit) && limit > 0 && kept > limit) {
    const order = keep
      .map((p, index) => ({ p, index }))
      .sort((a, b) => (a.p.tier - b.p.tier) || (b.index - a.index));
    const doomed = new Set();
    for (const { p } of order) {
      if (kept <= limit) break;
      doomed.add(p);
      kept -= p.text.length;
      removed.push({ page: p.number, why: p.tier === TIER.CORE ? "no entraba en el presupuesto" : p.why, label: pageLabel(p.text) });
    }
    keep = keep.filter((p) => !doomed.has(p));
  }

  removed.sort((a, b) => a.page - b.page);
  return {
    text: keep.map((p) => p.text).join(""),
    removed,
    trimmed: removed.length > 0,
    pageCount: classified.length,
  };
}

/**
 * La constancia que va al prompt. No es decorativa: es lo unico que separa "el modelo no vio el
 * Schedule E" de "el modelo dijo que el Schedule E estaba bien". Lista las paginas por numero y
 * por lo que decia su encabezado, agrupadas, y en ingles porque el prompt esta en ingles.
 */
function removalNotice(removed, pageCount) {
  const list = Array.isArray(removed) ? removed : [];
  if (!list.length) return "";
  const byReason = new Map();
  for (const item of list) {
    if (!byReason.has(item.why)) byReason.set(item.why, []);
    byReason.get(item.why).push(item);
  }
  const lines = [];
  for (const [why, items] of byReason) {
    const numbers = items.map((i) => i.page).join(", ");
    const examples = [...new Set(items.map((i) => i.label))].slice(0, 4).join(" | ");
    lines.push(`  - ${items.length} page(s) [${why}]: pages ${numbers}. Headings: ${examples}`);
  }
  return [
    "",
    "",
    `[SERVER NOTE — PAGES NOT INCLUDED. ${list.length} of this document's ${pageCount} pages were not sent to you:`,
    ...lines,
    "You have NOT seen the pages listed above. Do not state or imply anything about their contents.",
    "If a check you were asked to perform depends on one of them, say the page was not provided and stop there — never infer what it contained.]",
  ].join("\n");
}

/**
 * Cuanto pesa el nucleo federal de un documento, y cuanto pesa entero.
 *
 * Sirve para repartir presupuesto entre documentos SIN que el reparto por rol le quite al año
 * anterior paginas del 1040 para darle al corriente paginas de una declaracion estatal. Cada
 * dolar de entrada tiene que comprar primero el formulario federal de todos los documentos, y
 * recien despues lo estatal de cualquiera de ellos.
 */
function sizes(text) {
  const source = String(text || "");
  const pages = splitPages(source);
  if (!pages.length) return { core: source.length, full: source.length, structured: false };
  const classified = pages.map((page) => ({ ...page, ...classifyPage(page.text) }));
  const full = classified.filter((p) => p.tier !== TIER.DROP).reduce((sum, p) => sum + p.text.length, 0);
  const core = classified.filter((p) => p.tier === TIER.CORE).reduce((sum, p) => sum + p.text.length, 0);
  // El mismo resguardo que selectPages: si la limpieza se comeria demasiado, no hubo limpieza.
  const total = classified.reduce((sum, p) => sum + p.text.length, 0);
  const dropped = total - full;
  if (dropped > total * MAX_TRIM_SHARE) return { core, full: source.length, structured: true };
  return { core, full, structured: true };
}

/**
 * Colapsa las guias de puntos de los formularios.
 *
 * Un formulario impreso une la etiqueta con su casilla asi:
 *
 *   Check here if this is a publicly traded partnership . . . . . . . . . . . . . . . . . >
 *
 * Esos puntos son tipografia, no informacion: el modelo lee la etiqueta y lee el valor, la
 * guia no le dice nada. Y se pagan a precio de token de entrada.
 *
 * Medido sobre el paquete mas grande del estudio — dos declaraciones de 610 paginas mas 42
 * PDF de soporte de 500 — las guias son 551.000 caracteres, el 21% de todo lo que se manda.
 * Sacarlas es lo que hace que ese paquete entre entero en la ventana del modelo.
 *
 * Que NO se toca, y por que. La primera version tambien colapsaba las corridas de espacios y
 * las de guiones. Las dos se descartaron: en un formulario una columna vacia ES el espacio
 * que la separa, y una fila de rayas suele significar cero. Ademas, una vez sacadas las guias
 * de puntos, colapsar espacios ahorraba 770 caracteres mas sobre 1.837.000. No valia el riesgo.
 *
 * Comprobado sobre el paquete real: los 53.214 importes sobreviven identicos, y tambien las 48
 * marcas [ANSWER:], las 770 tildes X de casilla y los 1.046 Yes/No. Ver test/package-trim.test.js.
 *
 * Se aplica SOLO al texto que va al modelo. Los cruces deterministas leen originalText, que
 * queda crudo — varios de ellos limpian las guias por su cuenta con su propio criterio.
 */
const LEADER_RUN = /(?:[ \t]*[.·]){4,}/g;

function collapseLeaders(text) {
  return String(text || "").replace(LEADER_RUN, " . ");
}

/**
 * Debajo de esto una pagina no se compara con ninguna otra.
 *
 * Una pagina corta puede repetirse por casualidad, y sacarla no ahorra nada. La version que
 * ademas descartaba paginas casi vacias se comio dos paginas del unico PDF escaneado del
 * paquete: no tenian mas que el numero de lote del escaner, pero eran lo unico que ese
 * documento aportaba. Ahorraba el 0,3% y podia perder algo. Una pagina se saca SOLO si otra
 * pagina del paquete dice exactamente lo mismo.
 */
const DEDUPE_MIN_CHARS = 200;

/** La forma normalizada con la que se comparan dos paginas: sin marca de pagina y sin espaciado. */
function pageFingerprint(pageText) {
  return String(pageText || "")
    .replace(PAGE_MARKER, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Saca las paginas cuyo texto exacto ya aparecio antes en el MISMO paquete.
 *
 * Un paquete de soporte real trae el mismo K-1 dos veces (suelto y dentro de una carpeta), y
 * trae la misma plantilla de formulario en blanco en cada uno de los cuarenta y tres K-1. Sobre
 * el paquete mas grande del estudio son 110 paginas y 225.000 caracteres.
 *
 * La comparacion es por texto EXACTO, cifras incluidas. Una version anterior normalizaba
 * sacando los digitos y con eso dos K-1 con las mismas etiquetas y distintos importes hasheaban
 * igual — justo lo que no se puede perder. Comprobado sobre el paquete real: de las 110 paginas
 * descartadas, ninguna tenia una cifra que no quedara en otra pagina del paquete.
 *
 * El deduplicado es entre documentos, no dentro de uno, asi que corre una vez sobre la lista
 * entera antes de repartir presupuesto. La primera aparicion se queda; las siguientes se van.
 *
 * Recibe [{ name, text }] y devuelve { documents, removedPages, removedChars }, donde cada
 * documento trae ademas `duplicates` con lo que se le saco y de donde ya estaba.
 */
function dedupePages(documents) {
  const list = Array.isArray(documents) ? documents : [];
  const seen = new Map();
  let removedPages = 0;
  let removedChars = 0;

  const out = list.map((doc) => {
    const text = String(doc.text || "");
    const pages = splitPages(text);
    if (!pages.length) return { ...doc, text, duplicates: [] };
    const keep = [];
    const duplicates = [];
    for (const page of pages) {
      const key = pageFingerprint(page.text);
      if (key.length >= DEDUPE_MIN_CHARS) {
        const first = seen.get(key);
        if (first) {
          removedPages += 1;
          removedChars += page.text.length;
          duplicates.push({ page: page.number, label: pageLabel(page.text), sameAs: first });
          continue;
        }
        seen.set(key, { name: doc.name || "", page: page.number });
      }
      keep.push(page.text);
    }
    return { ...doc, text: keep.join(""), duplicates };
  });

  return { documents: out, removedPages, removedChars };
}

/**
 * La constancia de lo deduplicado.
 *
 * Es distinta de removalNotice y no se pueden mezclar: aquella dice "no viste esta pagina, no
 * opines sobre ella", y aca el modelo SI vio el contenido — una sola vez, en otro archivo. Si
 * se le dijera que no lo vio, dejaria de cruzar un K-1 que tiene delante.
 */
function duplicateNotice(duplicates) {
  const list = Array.isArray(duplicates) ? duplicates : [];
  if (!list.length) return "";
  const numbers = list.map((d) => d.page).join(", ");
  const examples = [...new Set(list.map((d) => d.label))].slice(0, 4).join(" | ");
  return [
    "",
    "",
    `[SERVER NOTE — DUPLICATE PAGES SENT ONCE. ${list.length} page(s) of this document are character-for-character identical to pages already included elsewhere in this package, so they were sent a single time: pages ${numbers}. Headings: ${examples}`,
    "You HAVE seen this content — it is present in another document of this package. Treat it as available and cross-check against it normally. Do not report these pages as missing.]",
  ].join("\n");
}

module.exports = {
  selectPages, splitPages, classifyPage, removalNotice, pageLabel, sizes,
  collapseLeaders, dedupePages, duplicateNotice, pageFingerprint,
  TIER, MAX_TRIM_SHARE, MIN_PAGES, DEDUPE_MIN_CHARS,
};