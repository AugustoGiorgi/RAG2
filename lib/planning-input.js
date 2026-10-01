"use strict";

/**
 * planning-input.js — lo que lee el modelo en el Analyze de Tax Planning, sin pagar dos veces.
 *
 * Por que existe: el Analyze mandaba cada PDF dos veces, como documento (el texto y una imagen
 * de cada pagina) y ademas como texto extraido. La imagen de cada pagina es lo caro: una
 * planificacion con dos declaraciones de 40 paginas costaba $1,67, y casi todo era eso. Para
 * sacar los datos de una declaracion armada por un software de impuestos alcanza con el texto,
 * que es lo que usa la Review para un trabajo mucho mas exigente.
 *
 * Ahora:
 * - Un PDF con texto se manda solo como texto, pagina por pagina y entero (antes el texto se
 *   cortaba en 60.000 caracteres y lo demas solo llegaba como imagen).
 * - Se sacan las paginas que no aportan nada a una planificacion: autorizaciones de e-file,
 *   pedidos de prorroga, comprobantes de pago con datos bancarios.
 * - Se sacan las lineas de puntos de los formularios ("Wages . . . . . . 1a 85,000"), que son
 *   la mitad de los caracteres y no dicen nada.
 * - Un PDF escaneado (sin texto) se sigue mandando como documento, hasta un tope de paginas.
 * - Hay un tope total de texto; si se pasa, se recorta y el modelo lo sabe.
 *
 * Nada de esto toca los otros archivos (Excel, Word, imagenes): siguen el camino de siempre.
 */

/**
 * Paginas que no aportan nada a una planificacion. Se mira solo el titulo de la pagina (sus dos
 * primeras lineas): la carta del contador menciona el 8879 en el cuerpo y una hoja de
 * informacion general lista "7004" entre los formularios, y las dos se quedan.
 */
const BOILERPLATE_PAGE = [
  /Form 8879\b|e-file (Signature )?Authorization/i,
  /Form 8453\b/i,
  /Form 9325\b|Acknowledgement and General Information for Taxpayers Who File Returns Electronically/i,
  /Form 7004\b|Application for Automatic Extension/i,
  /Form 4868\b/i,
  /PAYMENT RECORD|ELECTRONIC FUNDS WITHDRAWAL/i,
  /Extension of Time to File|-EXT\b/i,
  /Form 1040-V\b|Payment Voucher/i,
];

/** Las lineas de puntos de los formularios: tres o mas puntos separados por espacios. */
function stripDotLeaders(text) {
  return String(text || "")
    .replace(/(?:\s*\.){3,}/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function pageTitle(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2).join(" | ");
}

function isBoilerplatePage(text) {
  const title = pageTitle(text);
  return BOILERPLATE_PAGE.some((re) => re.test(title));
}

/**
 * Si un PDF tiene texto de verdad o es un escaneo. Con menos de 100 caracteres por pagina en
 * promedio no hay nada que leer como texto.
 */
function hasTextLayer(pages) {
  if (!Array.isArray(pages) || !pages.length) return false;
  const chars = pages.reduce((sum, p) => sum + String(p?.text || "").trim().length, 0);
  return chars >= 100 * pages.length;
}

/**
 * Arma el texto de un PDF con texto: paginas utiles, sin lineas de puntos, con marcas de
 * pagina. Devuelve { text, kept, dropped }.
 */
function pdfPagesToText(pages) {
  const kept = [];
  const dropped = [];
  (Array.isArray(pages) ? pages : []).forEach((page, i) => {
    const num = Number(page?.num) || i + 1;
    const text = String(page?.text || "").trim();
    if (!text) return;
    if (isBoilerplatePage(text)) { dropped.push(num); return; }
    kept.push(`--- Page ${num} ---\n${stripDotLeaders(text).trim()}`);
  });
  return { text: kept.join("\n\n"), kept: kept.length, dropped };
}

/**
 * Reparte un tope de caracteres entre varios textos. Los que entran se quedan enteros; el
 * sobrante se reparte entre los largos, que se cortan por el final con un aviso.
 */
function fitTextBudget(items, maxChars) {
  const total = items.reduce((sum, item) => sum + item.text.length, 0);
  if (total <= maxChars) return items.map((item) => ({ ...item, cut: false }));
  let budget = maxChars;
  let pending = [...items].sort((a, b) => a.text.length - b.text.length);
  const allowance = new Map();
  while (pending.length) {
    const share = Math.floor(budget / pending.length);
    const small = pending.filter((item) => item.text.length <= share);
    if (!small.length) { pending.forEach((item) => allowance.set(item, share)); break; }
    small.forEach((item) => { allowance.set(item, item.text.length); budget -= item.text.length; });
    pending = pending.filter((item) => !small.includes(item));
  }
  return items.map((item) => {
    const limit = allowance.get(item);
    if (item.text.length <= limit) return { ...item, cut: false };
    const cutAt = item.text.lastIndexOf("\n--- Page ", limit);
    const body = item.text.slice(0, cutAt > 0 ? cutAt : limit);
    return { ...item, text: `${body}\n\n[Remaining pages of this file omitted for length.]`, cut: true };
  });
}

/** Tope de texto de los PDF de un Analyze: ~165.000 tokens, unos $0,50 con Sonnet 4.6. */
const TEXT_BUDGET_CHARS = 360000;
/** Tope de paginas escaneadas que se mandan como documento: ~40 paginas, unos $0,50. */
const SCANNED_PAGE_CAP = 40;

/**
 * Decide como viaja cada PDF. Recibe [{ name, role, content, pages, total, failed }] — pages es
 * lo que devuelve el extractor, pagina por pagina — y devuelve:
 *   texts:   [{ name, text }] para el bloque de texto, ya ajustados al tope
 *   scanned: [{ name, content, pages }] para mandar como documento
 *   skipped: [name] escaneos que no entraron en el tope
 *   dropped: [{ name, pages }] paginas sacadas por no aportar
 * Un PDF que no se pudo leer se trata como escaneo y cuenta como 20 paginas.
 */
function packPlanningPdfs(pdfs, { textBudget = TEXT_BUDGET_CHARS, scannedPageCap = SCANNED_PAGE_CAP } = {}) {
  const texts = [];
  const scanned = [];
  const skipped = [];
  const dropped = [];
  let scannedPages = 0;
  for (const pdf of Array.isArray(pdfs) ? pdfs : []) {
    const name = String(pdf?.name || "Uploaded file");
    if (!pdf?.failed && hasTextLayer(pdf?.pages)) {
      const packed = pdfPagesToText(pdf.pages);
      if (packed.dropped.length) dropped.push({ name, pages: packed.dropped });
      texts.push({ name, text: `FILE: ${name}\nROLE: ${pdf.role || "other"}\n${packed.text}` });
      continue;
    }
    const pages = pdf?.failed ? 20 : Math.max(1, Number(pdf?.total) || (pdf?.pages || []).length || 1);
    if (scannedPages + pages <= scannedPageCap) {
      scanned.push({ name, content: pdf.content, pages });
      scannedPages += pages;
    } else {
      skipped.push(name);
    }
  }
  return { texts: fitTextBudget(texts, textBudget), scanned, skipped, dropped };
}

module.exports = {
  BOILERPLATE_PAGE, TEXT_BUDGET_CHARS, SCANNED_PAGE_CAP,
  stripDotLeaders, isBoilerplatePage, hasTextLayer, pdfPagesToText, fitTextBudget, packPlanningPdfs,
};
