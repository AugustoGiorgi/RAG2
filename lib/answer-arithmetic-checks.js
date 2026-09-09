"use strict";

/**
 * answer-arithmetic-checks.js — cuando una casilla marcada contradice la aritmetica de la
 * misma declaracion.
 *
 * Esto es posible desde hace poco y conviene decir por que: el extractor de la app resuelve la
 * posicion del tilde y escribe " [ANSWER: Yes]" / " [ANSWER: No]" sobre la linea de la pregunta
 * (app.js, pdfPageLines). Hasta que note eso, las casillas eran territorio exclusivo del modelo
 * — y el modelo se equivoca justamente ahi: sobre un 1120-S real razono en circulo sobre la
 * pregunta 11 del Schedule B, que es la comparacion de dos numeros contra $250.000.
 *
 * Una casilla cuya respuesta correcta se deduce de cifras impresas en la misma declaracion no
 * necesita criterio profesional: necesita una resta. Este modulo hace la resta.
 *
 * Regla de oro del archivo: solo se reporta la direccion que se puede PROBAR. En el 1065 la
 * pregunta tiene cuatro condiciones y solo dos son aritmeticas, asi que un "Yes" con una
 * condicion aritmetica fallada es un error demostrable, mientras que un "No" con las dos
 * aritmeticas cumplidas no prueba nada — las otras dos condiciones pueden ser las que fallan.
 */

/** El marcador que deja el extractor sobre la linea de la pregunta. */
const ANSWER_MARK = /\[ANSWER:\s*(Yes|No)\]/i;

function linesOf(text) {
  return String(text || "").split(/\r?\n/);
}

function parseAmount(raw) {
  const cleaned = String(raw || "").replace(/[$,\s]/g, "").replace(/\.$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** La respuesta marcada en la primera linea que coincide con la pregunta, o null. */
function printedAnswer(text, questionPattern) {
  for (const line of linesOf(text)) {
    if (!questionPattern.test(line)) continue;
    const hit = ANSWER_MARK.exec(line);
    if (hit) return hit[1].toLowerCase() === "yes" ? "Yes" : "No";
    // La pregunta esta pero el tilde no se resolvio: no se adivina.
    return null;
  }
  return null;
}

/** El ultimo importe de la primera linea que coincide. */
function amountFrom(text, pattern) {
  for (const line of linesOf(text)) {
    if (!pattern.test(line)) continue;
    const hits = line.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d{2}/g);
    if (!hits || !hits.length) continue;
    return parseAmount(hits[hits.length - 1]);
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * La exencion de armar Schedule L y M-1 en una declaracion chica.
 *
 * 1120-S, Schedule B linea 11: dos condiciones, ambas aritmeticas — ingresos totales bajo
 * $250.000 y activos totales al cierre bajo $250.000. Se pueden verificar las dos, asi que se
 * verifican las dos direcciones.
 *
 * 1065, Schedule B linea 4: cuatro condiciones, y solo dos son aritmeticas — ingresos bajo
 * $250.000 y activos bajo $1.000.000. Las otras dos son de procedimiento (los K-1 presentados
 * en termino, el anexo de titularidad). Por eso aca solo se reporta el "Yes" con una condicion
 * aritmetica fallada, que es demostrable; un "No" no prueba nada porque puede estar fallando
 * una de las condiciones que este modulo no ve.
 * ------------------------------------------------------------------------- */

const EXEMPTION_QUESTION = {
  "1120-S": {
    question: /^\s*11\s+Does the corporation satisfy both of the following conditions\?/i,
    receiptsCap: 250000,
    assetsCap: 250000,
    bothDirections: true,
    schedules: "Schedules L and M-1",
    line: "Form 1120-S Schedule B line 11",
  },
  "1065": {
    question: /^\s*4\s+Does the partnership satisfy all four of the following conditions\?/i,
    receiptsCap: 250000,
    assetsCap: 1000000,
    bothDirections: false,
    schedules: "Schedules L, M-1 and M-2",
    line: "Form 1065 Schedule B line 4",
  },
};

/** Ingresos totales: la linea 1c del frente de la declaracion. */
const TOTAL_RECEIPTS = /^\s*1\s*a\s+Gross receipts or sales\b/i;
/** Activos totales al cierre: Schedule L, linea 14 en el 1065 y 15 en el 1120-S. */
const TOTAL_ASSETS = /^\s*1[45]\s+Total assets\b/i;

function exemptionSpecFor(returnType) {
  const type = String(returnType || "").replace(/\s+/g, "").toUpperCase();
  if (/^1120-?S/.test(type)) return EXEMPTION_QUESTION["1120-S"];
  if (/^1065/.test(type)) return EXEMPTION_QUESTION["1065"];
  return null;
}

/** La ultima cifra de la linea de activos es la del CIERRE; la primera es la de apertura. */
function endingAssets(text) {
  for (const line of linesOf(text)) {
    if (!TOTAL_ASSETS.test(line)) continue;
    const hits = line.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g);
    if (!hits || !hits.length) continue;
    return parseAmount(hits[hits.length - 1]);
  }
  return null;
}

const money = (n) => `$${Number(n).toLocaleString("en-US")}`;

function checkSmallReturnExemption(text, meta = {}) {
  const spec = exemptionSpecFor(meta.returnType);
  if (!spec) return null;
  const answer = printedAnswer(text, spec.question);
  if (!answer) return null;

  const receipts = amountFrom(text, TOTAL_RECEIPTS);
  const assets = endingAssets(text);
  if (receipts === null || assets === null) return null;

  const receiptsOk = receipts < spec.receiptsCap;
  const assetsOk = assets < spec.assetsCap;

  // Direccion demostrable: se dijo que si y una condicion aritmetica no se cumple.
  if (answer === "Yes" && (!receiptsOk || !assetsOk)) {
    const failed = [];
    if (!receiptsOk) failed.push(`total receipts are ${money(receipts)}, over the ${money(spec.receiptsCap)} limit`);
    if (!assetsOk) failed.push(`ending total assets are ${money(assets)}, over the ${money(spec.assetsCap)} limit`);
    return {
      severity: "HIGH",
      category: "Required schedules",
      title: `The return claims an exemption from ${spec.schedules} that its own figures do not support`,
      detail: `${spec.line} is answered "Yes", which is what excuses the return from completing ${spec.schedules}. But ${failed.join(", and ")} — read off this same return.`,
      action: `Answer the question "No" and complete ${spec.schedules}. A return that omits them on a exemption it does not qualify for is incomplete as filed, and the balance sheet is the first thing an examiner asks for.`,
      authority: `${spec.line} and its instructions`,
      dedupe: /schedule b (?:line )?(?:11|4)\b|exempt\w*.{0,30}schedule|\$250,000/i,
    };
  }

  // La otra direccion solo se reporta cuando TODAS las condiciones son aritmeticas y se
  // cumplen: no hay error de impuesto, pero el preparador armo anexos que no debia.
  if (spec.bothDirections && answer === "No" && receiptsOk && assetsOk) {
    return {
      severity: "LOW",
      category: "Required schedules",
      title: `The return qualifies for the ${spec.schedules} exemption and did not take it`,
      detail: `${spec.line} is answered "No", but total receipts are ${money(receipts)} and ending total assets are ${money(assets)} — both under ${money(spec.receiptsCap)}, which is exactly the condition the question asks about.`,
      action: `No tax consequence: ${spec.schedules} were completed anyway and the return is not wrong. Worth confirming the answer matches the figures before filing, since the question is matched against the return's own numbers.`,
      authority: `${spec.line} and its instructions`,
      dedupe: /schedule b (?:line )?(?:11|4)\b|exempt\w*.{0,30}schedule|\$250,000/i,
    };
  }

  return null;
}

/**
 * Corre los cruces de casilla contra aritmetica sobre la declaracion del año en curso.
 */
function runAnswerArithmeticChecks(files, meta = {}) {
  const list = Array.isArray(files) ? files : [];
  const current = list.find((file) => String(file?.reviewRole || file?.role || "").toLowerCase().includes("current_return"));
  if (!current) return [];
  const text = String((current.originalText || current.fullText || current.text || current.extractedText) || "");
  if (text.trim().length < 500) return [];
  return [checkSmallReturnExemption(text, meta)].filter(Boolean);
}

module.exports = {
  runAnswerArithmeticChecks, checkSmallReturnExemption,
  printedAnswer, amountFrom, endingAssets,
  ANSWER_MARK, EXEMPTION_QUESTION, TOTAL_RECEIPTS, TOTAL_ASSETS,
};
