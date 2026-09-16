"use strict";

/**
 * report-delivery.js — lo ultimo que pasa antes de que el informe salga.
 *
 * Todo lo de aca corre UNA vez, sobre el informe ya unido de todas las pasadas, justo antes de
 * mandarlo al navegador y de guardarlo en el historial. Por eso vive aparte de review-guards:
 * aquellas preguntan si lo que dice el informe es cierto; estas deciden que puede salir.
 *
 * El informe no es un documento interno. Se ve en pantalla, se exporta a Word y se comparte con
 * el cliente, y en tres corridas seguidas llevo cosas que no debia: el numero de cuenta bancaria
 * completo de una declaracion anterior, SSN completos en una lista que nadie habia pedido, y
 * formularios de firma reportados como faltantes cuando estaban en la declaracion.
 */

/* ---------------------------------------------------------------------------
 * 1. Identificadores sensibles.
 *
 * Se dejan los ultimos cuatro digitos, que es la forma en que los truncan el IRS y los
 * propios formularios, y alcanza para que el revisor sepa de que numero se habla. Los EIN no
 * se tocan: identifican empresas y el revisor los necesita completos para cruzar K-1.
 * ------------------------------------------------------------------------- */

const keepLast4 = (digits) => {
  const only = String(digits).replace(/\D/g, "");
  return only.length <= 4 ? String(digits) : "*".repeat(only.length - 4) + only.slice(-4);
};

const MASKS = [
  // 123-45-6789: la forma del SSN y del ITIN. Un telefono es 3-3-4 y una fecha 4-2-2, asi que
  // el patron no los alcanza. Tampoco puede estar pegado a otro grupo con guion: el numero de
  // parcela "47-001-02-0084-001" tiene un 001-02-0084 adentro y no es un SSN.
  { re: /(?<![\d-])\d{3}-\d{2}-(\d{4})(?![\d-])/g, to: (_m, last) => `XXX-XX-${last}` },
  // Sin guiones, solo cuando una etiqueta dice que es un SSN: nueve digitos sueltos pueden ser
  // cualquier cosa, incluido un numero de ruta bancaria.
  {
    re: /\b(SSN|ITIN|TIN|social security (?:number|no\.?))(\s*[:#]?\s*)(\d{3})[ ]?(\d{2})[ ]?(\d{4})\b/gi,
    to: (_m, label, sep, _a, _b, last) => `${label}${sep}XXX-XX-${last}`,
  },
  // Cuenta bancaria con etiqueta. Hacen falta cinco o mas digitos: "account ending in 8023" ya
  // esta truncado, y "Accounts receivable 787,444" es un importe, no una cuenta.
  {
    // Corta ante un decimal o un separador de miles ("account 1,234.56" es un importe), pero no
    // ante el punto que cierra una oracion.
    re: /\b((?:bank\s+)?(?:account|acct\.?)(?:\s+(?:number|no\.?|#))?\s*[:#]?\s*)(\d[\d -]{3,}\d)(?!\d|[,.]\d)/gi,
    to: (_m, label, digits) => label + keepLast4(digits),
  },
  // Ruta y cuenta pegadas con un guion: "072000326-580251515". La ruta es publica (ABA) y queda.
  { re: /\b(\d{9})-(\d{6,17})\b/g, to: (_m, routing, account) => `${routing}-${keepLast4(account)}` },
  // Licencia de conducir con etiqueta. Los formatos cambian por estado, asi que solo se toca
  // cuando la etiqueta lo dice.
  {
    re: /\b((?:driver'?s?\s+licen[cs]e|DL)(?:\s+(?:number|no\.?|#))?\s*[:#]?\s*)([A-Z]?\d[A-Z\d -]{4,}\d)\b/gi,
    to: (_m, label, id) => label + keepLast4(id),
  },
];

function maskText(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const { re, to } of MASKS) out = out.replace(re, to);
  return out;
}

/** Aplica maskText a todo string del informe, a cualquier profundidad. No muta. */
function maskSensitiveIdentifiers(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value;
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map((v) => maskSensitiveIdentifiers(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskSensitiveIdentifiers(v, depth + 1);
    return out;
  }
  return value;
}

/**
 * La tabla de identificadores despues de enmascarar.
 *
 * Si dos numeros distintos solo se diferenciaban en los digitos que quedaron tapados, la fila
 * mostraria "XXX-XX-3045 contra XXX-XX-3045 — MISMATCH" y el revisor no entenderia por que.
 * En ese caso se le dice donde mirar.
 */
function explainMaskedMismatches(original, masked) {
  const rows = Array.isArray(masked) ? masked : [];
  const before = Array.isArray(original) ? original : [];
  return rows.map((row, i) => {
    const src = before[i];
    if (!row || !src || String(row.status || "").toUpperCase() !== "MISMATCH") return row;
    const hidden = String(row.returnValue) === String(row.sourceValue)
      && String(src.returnValue) !== String(src.sourceValue);
    if (!hidden) return row;
    const note = "The two numbers differ only in digits hidden in this report — compare them on the documents.";
    return { ...row, note: row.note ? `${row.note} ${note}` : note };
  });
}

/* ---------------------------------------------------------------------------
 * 2. Pedidos que nadie hizo.
 *
 * El prompt maestro ilustra sus "USER REVIEW INSTRUCTIONS" con un ejemplo: "list every EIN and
 * SSN found in the return". El modelo tomo el ejemplo como tarea y dos informes de corrido
 * trajeron una linea "REQUESTED:" con todos los SSN completos sin que el estudio lo pidiera; un
 * tercero trajo "REQUESTED: no specific request was found", que es ruido. Una linea REQUESTED
 * solo tiene sentido si hubo instrucciones.
 * ------------------------------------------------------------------------- */

const REQUESTED = /^\s*REQUESTED\b/i;
const REQUESTED_NOTHING = /^\s*REQUESTED:\s*(?:no\b|none\b|n\/a\b)/i;

function dropUnrequestedLines(items, userNotes) {
  const list = Array.isArray(items) ? items : [];
  const asked = String(userNotes || "").trim().length > 0;
  const kept = list.filter((line) => {
    const text = typeof line === "string" ? line : String((line && (line.text || line.item)) || "");
    if (!REQUESTED.test(text)) return true;
    if (REQUESTED_NOTHING.test(text)) return false;
    return asked;
  });
  return { items: kept, dropped: list.length - kept.length };
}

/* ---------------------------------------------------------------------------
 * 3. Formularios de firma reportados como faltantes.
 *
 * package-trim saca de lo que ve el modelo las autorizaciones de e-file, porque no son materia
 * de revision. Un 1065 y un 1040 seguidos las listaron igual como "documento faltante — page
 * not provided", con el formulario en la pagina 11 de uno y en la 21 del otro. El aviso al
 * modelo ya lo prohibe; esto es la red por si igual lo escribe.
 *
 * Se descarta la linea solo si su tema es el formulario de firma: una linea que ademas pide un
 * W-2 o una liquidacion de cierre queda, porque esa parte si puede faltar.
 * ------------------------------------------------------------------------- */

const FILING_PAPERWORK = /\b(?:[A-Z]{2}-)?8879(?:-?[A-Z]{1,4})?\b|\b8878\b|\b8453(?:-[A-Z]{1,4})?\b|e-?file\s+(?:signature\s+|return\s+)?authori[sz]ation/i;
const REAL_DOCUMENT = /\bW-?2\b|\b1099\b|\bK-1\b|\b1098\b|\b1095\b|\bclosing\b|\bsettlement\b|\bstatement\b|\bappraisal\b|\breceipt\b|\binvoice\b|\bappointment\b/i;
const MISSING_CLAIM = /\bnot\s+(?:provided|included|sent|attached|available|found)\b|\bmissing\b|\bexcluded\b|\bpage range\b|\bcould not (?:be )?(?:reviewed|confirmed)\b/i;

function isFilingPaperworkClaim(line, requireMissingWording) {
  const text = String(line || "");
  if (!FILING_PAPERWORK.test(text) || REAL_DOCUMENT.test(text)) return false;
  return requireMissingWording ? MISSING_CLAIM.test(text) : true;
}

/* ---------------------------------------------------------------------------
 * Todo junto.
 * ------------------------------------------------------------------------- */

function prepareReviewForDelivery(review, { userNotes } = {}) {
  if (!review || typeof review !== "object") return { review, dropped: 0 };
  let dropped = 0;
  const out = { ...review };

  const requested = dropUnrequestedLines(out.verifiedItems, userNotes);
  out.verifiedItems = requested.items;
  dropped += requested.dropped;

  if (Array.isArray(out.missingDocuments)) {
    const kept = out.missingDocuments.filter((line) => !isFilingPaperworkClaim(line, false));
    dropped += out.missingDocuments.length - kept.length;
    out.missingDocuments = kept;
  }
  if (Array.isArray(out.openQuestions)) {
    const kept = out.openQuestions.filter((line) => !isFilingPaperworkClaim(line, true));
    dropped += out.openQuestions.length - kept.length;
    out.openQuestions = kept;
  }

  const masked = maskSensitiveIdentifiers(out);
  if (Array.isArray(out.infoConsistency)) {
    masked.infoConsistency = explainMaskedMismatches(out.infoConsistency, masked.infoConsistency);
  }
  return { review: masked, dropped };
}

module.exports = {
  prepareReviewForDelivery, maskSensitiveIdentifiers, maskText, dropUnrequestedLines,
  isFilingPaperworkClaim, explainMaskedMismatches,
};
