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
 *
 * Segunda lectura. Sobre una declaracion real de 44 paginas con 23 casillas marcadas, la
 * primera lectura llego a 13. Las que faltaban tenian forma, no eran ilegibles:
 *
 *  - la X impresa DESPUES del rotulo: "If you do not want to claim the EIC, check here . . X";
 *  - un rotulo de una sola palabra, que solo se entiende con lo que tiene delante en el
 *    renglon: "A Filing 1 X Single", "Yes X No Email:";
 *  - la pregunta que termina en el renglon de abajo de su respuesta, en formularios a dos
 *    columnas;
 *  - la misma pregunta que un año arranca con el rotulo del margen ("Digital Assets ...") y el
 *    otro no: se empareja por como termina, que es lo que no cambia.
 *
 * Todo es aditivo: lo que la primera lectura ya contaba se cuenta igual. Lo nuevo solo suma
 * cuando aparece igual en la declaracion del año anterior, o queda como leido sin comparar.
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

/**
 * Como termina una pregunta: sus ultimas ocho palabras hasta el signo de pregunta. Es lo que
 * queda igual cuando el PDF le pega delante, un año si y otro no, el rotulo del margen.
 */
function questionTail(label) {
  const text = String(label || "");
  const end = text.lastIndexOf("?");
  if (end < 0) return "";
  const words = questionKey(text.slice(0, end), 400).split(" ").filter(Boolean);
  const tail = words.slice(-8);
  return tail.filter((w) => w.length >= 3).length >= 4 ? tail.join(" ") : "";
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
    // O terminar en la de abajo, en un formulario a dos columnas: la respuesta queda en un
    // renglon con texto de la otra columna y la pregunta sigue debajo. Solo si ese renglon no
    // trae su propia respuesta, que entonces es otra pregunta.
    if (!label.includes("?") && i + 1 < lines.length && lines[i + 1].includes("?") && !ANSWER.test(lines[i + 1])) label = cleanLabel(lines[i + 1]);
    if (!label.includes("?")) return;
    const key = questionKey(label);
    if (key.split(" ").filter((w) => w.length >= 3).length < 3) return;
    out.push({ key, tail: questionTail(label), label: label.slice(0, 160), answer: hit[1][0].toUpperCase() + hit[1].slice(1).toLowerCase() });
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
  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (ANSWER.test(line)) continue;
    if (tickAnswersNextLine(line, lines[index + 1])) continue;
    const parts = line.split(/(?:^|\s)X(?=\s)/);
    for (let i = 1; i < parts.length; i += 1) {
      const raw = parts[i].replace(/(?:\s*\.){3,}.*$/, "").trim();
      const label = raw.split(/\s+/).slice(0, 8).join(" ");
      if (!/[a-z]/.test(label) || /%|^line\b/i.test(label)) continue;
      // Texto de instrucciones con una X literal: "Mark an X in one box", "(See instructions.)".
      if (/\bbox(?:es)?\b/i.test(label) || /^\(?(?:in|on|an?|the|here|if|see|enter|and|or|of|to)\b/i.test(label)) continue;
      const key = questionKey(label, 5);
      if (key.split(" ").filter((w) => w.length >= 3).length < 2) {
        // Segunda lectura: un rotulo de una sola palabra, con lo que tiene delante.
        const withContext = shortLabelBox(parts[i - 1], label);
        if (withContext) out.push(withContext);
        continue;
      }
      out.push({ key, label: label.slice(0, 120) });
    }
    // Segunda lectura: la X al final del renglon, con el rotulo delante.
    const trailing = trailingBox(line, parts);
    if (trailing) out.push(trailing);
  }
  return out;
}

/**
 * En un formulario a dos columnas la tilde de una pregunta cae en el renglon de arriba, que es
 * la pregunta de la otra columna: "X Queens ... during 2025? . . . Yes No" seguido de
 * "on another taxpayer's federal return? . . . Yes No [ANSWER: No]". pdfPageLines ya le dio esa
 * tilde a la pregunta de abajo, que se cuenta por el otro camino; contarla ademas como casilla
 * de este renglon la contaria dos veces. Se reconoce porque este renglon trae su propio Yes/No
 * sin respuesta y el de abajo trae una respuesta sin ninguna X propia.
 */
function tickAnswersNextLine(line, next) {
  if (!next || !ANSWER.test(next)) return false;
  if (/(?:^|\s)X(?=\s|$)/.test(next.replace(ANSWER, ""))) return false;
  return /\?/.test(line) && /\bYes\b/.test(line) && /\bNo\b/.test(line);
}

/**
 * La palabra justo antes de una X que no es una marca: "Part X", "Schedule X", "Code X", o el
 * texto de las instrucciones ("mark an X").
 */
const NOT_A_MARK = /^(?:parts?|schedules?|sections?|lines?|forms?|box(?:es)?|items?|columns?|col|codes?|types?|class|table|exhibit|appendix|an?|the|mark(?:ed)?|with|by|times|and|or)$/i;

function lastWords(text, count) {
  return String(text || "").replace(/(?:\s*\.){3,}/g, " ").trim().split(/\s+/).filter(Boolean).slice(-count);
}

function isLiteralX(before) {
  // "line 10 X before 4/15/26": una multiplicacion en un renglon de calculo.
  if (/\blines?\s+[\w.()-]+$/i.test(lastWords(before, 2).join(" "))) return true;
  const [last] = lastWords(before, 1);
  return Boolean(last) && NOT_A_MARK.test(last.replace(/[^A-Za-z]/g, ""));
}

/**
 * "A Filing 1 X Single": el rotulo "Single" no alcanza solo, y con "Filing" delante si. La
 * clave guarda de que lado de la X quedo cada parte, para que "Yes X No" y "Yes No X" — dos
 * respuestas distintas — no se lean como la misma casilla.
 */
function shortLabelBox(before, label) {
  if (isLiteralX(before)) return null;
  const after = String(label || "").replace(/(^|\s)X$/, "").trim();
  const afterKey = questionKey(after, 5);
  const beforeKey = questionKey(lastWords(before, 3).join(" "), 3);
  const long = (key) => key.split(" ").filter((w) => w.length >= 3).length;
  if (!long(afterKey) || long(afterKey) + long(beforeKey) < 2) return null;
  return { key: `${beforeKey} ^ ${afterKey}`, label: `${lastWords(before, 3).join(" ")} X ${after}`.trim().slice(0, 120) };
}

/**
 * "If you do not want to claim the EIC, check here . . . . X": la X cierra el renglon y el
 * rotulo es lo que tiene delante. Se toman sus ultimas seis palabras, que son las propias de la
 * casilla: al principio del renglon el PDF suele pegar texto de otra columna.
 */
function trailingBox(line, parts) {
  const text = String(line || "").trimEnd();
  if (!/(?:^|\s)X$/.test(text)) return null;
  const before = parts[parts.length - 1].replace(/(^|\s)X\s*$/, "");
  if (!/[a-z]/.test(before) || isLiteralX(before)) return null;
  const words = lastWords(before, 6);
  const key = questionKey(words.join(" "), 6);
  if (key.split(" ").filter((w) => w.length >= 3).length < 3) return null;
  return { key: `^ ${key}`, label: `${words.join(" ")} X`.slice(0, 120) };
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
  const priorList = yesNoQuestions(priorText);
  const currentList = yesNoQuestions(currentText);
  const priorQuestions = new Map();
  for (const q of priorList) {
    if (!priorQuestions.has(q.key)) priorQuestions.set(q.key, []);
    priorQuestions.get(q.key).push(q);
  }
  // Las que no tienen par por su texto entero se emparejan por como terminan, entre las que
  // quedaron sueltas de los dos lados.
  const currentKeys = new Set(currentList.map((q) => q.key));
  const looseByTail = new Map();
  for (const q of priorList) {
    if (currentKeys.has(q.key) || !q.tail) continue;
    if (!looseByTail.has(q.tail)) looseByTail.set(q.tail, []);
    looseByTail.get(q.tail).push(q);
  }
  const used = new Map();
  for (const q of currentList) {
    const candidates = priorQuestions.get(q.key) || [];
    const n = used.get(q.key) || 0;
    let match = candidates[Math.min(n, candidates.length - 1)];
    used.set(q.key, n + 1);
    if (!match && q.tail) match = (looseByTail.get(q.tail) || []).shift();
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
