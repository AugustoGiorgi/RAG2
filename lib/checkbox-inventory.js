"use strict";

/**
 * checkbox-inventory.js — las casillas de la declaracion, leidas y comparadas por codigo.
 *
 * Por que existe: el cuadro de casillas lo armaba el modelo con lo que alcanzaba a mirar, y en
 * una declaracion de 264 paginas fueron 7, 10 o 22 segun la corrida. Dos cosas se pueden leer
 * sin modelo y se comparan contra la declaracion del año anterior:
 *
 *  1. Las preguntas Si/No. pdfPageLines (app.js) ya anota la respuesta marcada como
 *     " [ANSWER: Yes]" / " [ANSWER: No]" sobre la linea de la pregunta.
 *  2. Las casillas sueltas marcadas: el texto del PDF trae una "X" delante del rotulo de la
 *     casilla marcada ("X Married filing jointly").
 *
 * Lo que da igual que el año anterior se cuenta como verificado. Un cambio en una pregunta
 * Si/No va al cuadro para confirmar: no siempre es un error, pero es lo primero que hay que
 * mirar. Lo que no tiene par en el otro año se cuenta aparte, sin comparar.
 *
 * Las casillas sueltas solo suman al conteo, nunca una fila de cambio. Probado sobre una
 * declaracion real de 264 paginas: de diez "cambios" que salian, siete eran falsos — una X
 * suelta en el texto de las instrucciones ("place an X in the box"), un rotulo que el PDF
 * corta en otra palabra un año y otro, el rotulo de un formulario estatal que existe en otro
 * formulario. Una casilla marcada igual los dos años, en cambio, es un acierto aunque algun
 * rotulo sea imperfecto.
 *
 * Fail-closed: un rotulo que no se puede leer con seguridad (muy corto, solo numeros, un
 * encabezado de planilla en mayusculas, texto de instrucciones) no se cuenta.
 */

const { splitReturns } = require("./prior-year-bridge");

const ANSWER = /\s*\[ANSWER:\s*(Yes|No)\]/i;
/** Tope de filas con cambios: el cuadro del informe muestra a lo sumo diez. */
const MAX_ROWS = 10;
const SOURCE = "Computed by RAG Tax AI from the filed returns";

function textOf(file) {
  return String((file && (file.originalText || file.fullText || file.text || file.extractedText)) || "");
}

/** Lo que identifica una pregunta o un rotulo en los dos años: letras, sin años ni numeros. */
function questionKey(label, words = 12) {
  return String(label || "")
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z() ]+/g, " ")
    .replace(/\(([a-z])\)/g, " $1 ")
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 || /^[a-z]$/.test(w))
    .slice(0, words)
    .join(" ")
    .trim();
}

/** El texto de una pregunta tal como se muestra: sin lineas de puntos, Yes/No ni marcas. */
function cleanLabel(line) {
  return String(line || "")
    .replace(ANSWER, "")
    .replace(/(?:\s*\.){3,}/g, " ")
    .replace(/[@>]/g, " ")
    .replace(/\b(?:Yes|No)\b/g, " ")
    .replace(/(^|\s)X(?=\s|$)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Las preguntas Si/No de una declaracion, con su respuesta, en orden. */
function yesNoQuestions(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    const hit = line.match(ANSWER);
    if (!hit) return;
    let label = cleanLabel(line);
    // La pregunta puede empezar en la linea de arriba; sin signo de pregunta no se toma.
    if (!label.includes("?") && i > 0 && lines[i - 1].includes("?")) label = `${cleanLabel(lines[i - 1])} ${label}`.trim();
    if (!label.includes("?")) return;
    const key = questionKey(label);
    if (key.split(" ").filter((w) => w.length >= 3).length < 3) return;
    out.push({ key, label: label.slice(0, 160), answer: hit[1][0].toUpperCase() + hit[1].slice(1).toLowerCase() });
  });
  return out;
}

/**
 * Las casillas sueltas marcadas: el rotulo que sigue a una "X" aislada, hasta la proxima X.
 * Se descartan las que no se pueden leer con seguridad: menos de dos palabras de tres letras,
 * rotulos en mayusculas (encabezados de planillas del software, no formularios), cuentas
 * ("LINE 3 X .9%") y lineas de pregunta Si/No, que van por el otro camino.
 */
function checkedBoxes(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (ANSWER.test(line)) continue;
    const parts = line.split(/(?:^|\s)X(?=\s)/);
    for (let i = 1; i < parts.length; i += 1) {
      const raw = parts[i].replace(/(?:\s*\.){3,}.*$/, "").trim();
      const label = raw.split(/\s+/).slice(0, 8).join(" ");
      if (!/[a-z]/.test(label) || /%|^line\b/i.test(label)) continue;
      // Texto de instrucciones con una X literal: "Mark an X in one box", "(See instructions.)".
      if (/\bbox(?:es)?\b/i.test(label) || /^\(?(?:in|on|an?|the|here|if|see|enter|and|or|of|to)\b/i.test(label)) continue;
      const key = questionKey(label, 5);
      if (key.split(" ").filter((w) => w.length >= 3).length < 2) continue;
      out.push({ key, label: label.slice(0, 120) });
    }
  }
  return out;
}

/**
 * Las filas que el codigo agrega a checkboxReview: una por cambio contra el año anterior (a lo
 * sumo diez) y una fila de alcance final con lo que dio igual.
 */
function checkboxInventoryRows(files, meta = {}) {
  const { current, prior } = splitReturns(Array.isArray(files) ? files : [], meta);
  if (!current || !prior) return [];
  const currentText = textOf(current);
  const priorText = textOf(prior);
  const rows = [];
  let sameAnswers = 0;
  let sameBoxes = 0;
  let notCompared = 0;

  // 1. Preguntas Si/No, emparejadas por texto y, si se repiten, por orden de aparicion.
  const priorQuestions = new Map();
  for (const q of yesNoQuestions(priorText)) {
    if (!priorQuestions.has(q.key)) priorQuestions.set(q.key, []);
    priorQuestions.get(q.key).push(q);
  }
  const used = new Map();
  for (const q of yesNoQuestions(currentText)) {
    const candidates = priorQuestions.get(q.key) || [];
    const n = used.get(q.key) || 0;
    const match = candidates[Math.min(n, candidates.length - 1)];
    used.set(q.key, n + 1);
    if (!match) { notCompared += 1; continue; }
    if (match.answer === q.answer) { sameAnswers += 1; continue; }
    rows.push({
      box: q.label,
      currentState: q.answer,
      shouldBe: `${match.answer} (prior year) — confirm`,
      explanation: `Answered ${match.answer} on the prior-year return and ${q.answer} on this one. Confirm the change is intended.`,
    });
  }

  // 2. Casillas sueltas marcadas: solo suman las que estan marcadas igual los dos años.
  const priorKeys = new Set(checkedBoxes(priorText).map((b) => b.key));
  const seen = new Set();
  for (const box of checkedBoxes(currentText)) {
    if (seen.has(box.key)) continue;
    seen.add(box.key);
    if (priorKeys.has(box.key)) sameBoxes += 1;
    else notCompared += 1;
  }

  const shown = rows.slice(0, MAX_ROWS);
  if (rows.length > MAX_ROWS) {
    const last = shown[shown.length - 1];
    last.explanation = `${last.explanation} (${rows.length - MAX_ROWS} more change(s) not listed.)`;
  }
  const total = sameAnswers + sameBoxes;
  if (total > 0) {
    shown.push({
      // No puede contener ni estar contenido en "Boxes verified as correct" (la fila del modelo):
      // lib/review-merge.js uniria las dos al juntar las pasadas y se perderia esta.
      box: "Boxes verified by code (same as the prior year)",
      currentState: String(total),
      shouldBe: "No action",
      explanation: `${SOURCE}: same as the prior-year return — ${sameAnswers} Yes/No question(s) and ${sameBoxes} marked box(es).${notCompared ? ` ${notCompared} more read with nothing to compare against on the prior-year return.` : ""}`,
    });
  }
  return shown;
}

module.exports = { checkboxInventoryRows, yesNoQuestions, checkedBoxes, questionKey, MAX_ROWS };
