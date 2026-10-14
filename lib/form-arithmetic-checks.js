"use strict";

/**
 * form-arithmetic-checks.js — la cuenta que el propio formulario imprime en el rotulo.
 *
 * Muchos renglones dicen como se calculan: "NOL available to be carried forward (subtract line
 * 7d from 7b)", "Add lines 22 and 23. This is your total tax". Si el importe impreso no es esa
 * cuenta hecha con los importes impresos en la misma pagina, el renglon esta mal, y no hace
 * falta ningun criterio para decirlo.
 *
 * El caso que lo motiva: una C corp de Nueva York con perdidas. El CT-3.4 y el NYC-2.4 imprimian
 * en la linea 7b la perdida disponible (la anterior mas la del año) y en la linea 7, que dice
 * "subtract line 7d from 7b" con la 7d vacia, la perdida anterior sola. El arrastre a NY y a
 * la ciudad quedaba corto por toda la perdida del año, dos años seguidos, y la revision lo dio
 * por bueno.
 *
 * Fail-closed, como todo el directorio, y deliberadamente estrecho:
 *  - solo "add lines X, Y and Z" y "subtract line X from line Y", con al menos dos renglones;
 *  - nada con condiciones, topes, rangos ("through"), columnas o referencias a otro formulario;
 *  - cada renglon citado tiene que estar en la misma pagina, una sola vez, antes del resultado;
 *  - un renglon citado vacio vale cero, pero si TODOS estan vacios el formulario se lleno desde
 *    una hoja de trabajo (el 8606 lo hace) y no se dice nada;
 *  - un resultado negativo impreso como cero es el "if zero or less, enter -0-" de casi todos.
 * Medido sobre trece declaraciones reales: unos 400 renglones comprobados y solo marco los
 * cuatro errores verdaderos (el CT-3.4 y el NYC-2.4 de dos años).
 */

const NUM = "(\\d{1,2}[a-z]?)";
const AMOUNT = "(-?\\(?\\s*(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2}|\\.)?\\s*\\)?-?)";
/** Hasta este margen la diferencia es redondeo de dolares enteros. */
const ROUNDING = 2;
/** Desde aca es HIGH: una cuenta mal hecha por diez mil dolares cambia algo de verdad. */
const HIGH_FROM = 10000;
/** Cuantos renglones se nombran en el hallazgo antes de decir "y N mas". */
const MAX_NAMED = 3;

const ARITHMETIC = /\badd\s+((?:lines?\s+)?[0-9]{1,2}[a-z]?(?:(?:\s*,\s*|\s*,?\s*and\s+)(?:line\s+)?[0-9]{1,2}[a-z]?)+)\b|\bsubtract\s+line\s+([0-9]{1,2}[a-z]?)\s+from\s+(?:line\s+)?([0-9]{1,2}[a-z]?)\b/i;
/** Rotulos con condiciones, topes o referencias que la cuenta simple no cubre. */
const NOT_SIMPLE = /\bif\b|whichever|smaller|larger|greater|lesser|multiply|divide|percent|%|through|see instr|column|enter (?:the )?(?:amount|result)|schedule|\bform\s|\bpart\s|\bless\b|combine|more than|don.t enter|do not enter|\bbut\b/i;
/** Codigo de formulario con su año, como lo imprimen el pie o el encabezado de la pagina. */
const FORM_ON_PAGE = /\b(?:Form\s+)?((?:[A-Z]{1,4}-)?\d[\d.]*[A-Z]?(?:-[A-Z0-9.]+)?)\s*(?:\(\s*(?:Rev\.?[^)]*|20\d{2})\s*\)|-\s*20\d{2}\b)/g;

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function parseAmount(raw) {
  const text = String(raw || "").replace(/\s+/g, "");
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-") || text.endsWith("-");
  const value = Number(text.replace(/[()$,-]/g, "").replace(/\.$/, ""));
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** El importe de un renglon: su numero repetido al final de la linea, y el importe despues. */
function tailOf(line, num) {
  const amount = new RegExp(`(?:^|[\\s@?Z>])${escapeRegex(num)}\\.?\\s+${AMOUNT}\\s*\\.?\\s*$`).exec(line);
  if (amount) {
    const value = parseAmount(amount[1]);
    return value === null ? null : { blank: false, value };
  }
  if (new RegExp(`(?:^|[\\s@?Z>])${escapeRegex(num)}\\.?\\s*$`).test(line)) return { blank: true, value: 0 };
  return null;
}

/** Los renglones numerados de una pagina, con su rotulo y su importe (o vacio, o ilegible). */
function pageRows(page) {
  const lines = String(page || "").split(/\r?\n/);
  const rows = [];
  const startsRow = new RegExp(`^\\s*${NUM}\\s+\\S`);
  lines.forEach((line, index) => {
    const m = new RegExp(`^\\s*${NUM}\\s+(\\S.*)$`).exec(line);
    if (!m) return;
    let tail = tailOf(line, m[1]);
    // Un rotulo de dos lineas deja el importe en la siguiente.
    if (!tail && lines[index + 1] && !startsRow.test(lines[index + 1])) tail = tailOf(lines[index + 1], m[1]);
    rows.push({ num: m[1], label: m[2], line, tail, index });
  });
  return rows;
}

/** El formulario de la pagina: el codigo con año que mas se repite en ella. */
function formOfPage(page) {
  const counts = new Map();
  for (const m of String(page || "").matchAll(FORM_ON_PAGE)) {
    const code = m[1];
    if (!/[A-Z]|\d{3,}/.test(code) || /^20\d{2}$/.test(code)) continue;
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  // La primera pagina de algunos formularios estatales imprime el codigo solo, en su renglon
  // ("CT-3.4"), y el año en otra parte.
  const alone = String(page || "").split(/\r?\n/).slice(1, 9)
    .map((line) => /^\s*(?:Form\s+)?([A-Z]{1,4}-\d[\d.]*[A-Z]?(?:-[A-Z0-9.]+)?|\d{3,4}(?:-[A-Z]{1,4})?)\s*$/.exec(line))
    .find(Boolean);
  return alone ? alone[1] : "";
}

/** Los renglones de una pagina cuyo importe no es la cuenta que su rotulo imprime. */
function arithmeticErrorsOnPage(page) {
  const rows = pageRows(page);
  const byNum = new Map();
  for (const row of rows) byNum.set(row.num, byNum.has(row.num) ? null : row); // repetido: ambiguo
  const out = [];
  for (const row of rows) {
    const m = ARITHMETIC.exec(row.label);
    if (!m || !row.tail || row.tail.blank) continue;
    // Solo la instruccion del propio renglon, antes de la guia de puntos.
    const instruction = row.label.split(/\s(?:\.\s){2,}|…/)[0];
    if (NOT_SIMPLE.test(instruction.replace(m[0], ""))) continue;
    const subtract = Boolean(m[2]);
    const refs = subtract ? [m[3], m[2]] : (m[1].match(/[0-9]{1,2}[a-z]?/g) || []);
    if (refs.length < 2 || refs.includes(row.num)) continue;
    const cited = refs.map((ref) => byNum.get(ref));
    if (cited.some((c) => !c || !c.tail || c.index > row.index)) continue;
    if (cited.every((c) => c.tail.blank)) continue; // se lleno desde una hoja de trabajo
    const values = cited.map((c) => c.tail.value);
    const computed = subtract ? values[0] - values[1] : values.reduce((sum, v) => sum + v, 0);
    const printed = row.tail.value;
    const expected = computed < 0 && printed === 0 ? 0 : computed;
    if (Math.abs(printed - expected) <= Math.max(ROUNDING, Math.abs(expected) * 0.001)) continue;
    out.push({ line: row.num, instruction: m[0], printed, computed: expected });
  }
  return out;
}

const money = (n) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const signed = (n) => (n < 0 ? `-${money(n)}` : money(n));

function checkPrintedArithmetic(text) {
  const errors = [];
  for (const page of String(text || "").split(/\n(?=--- Page \d+ ---)/)) {
    const found = arithmeticErrorsOnPage(page);
    if (!found.length) continue;
    const form = formOfPage(page);
    const pageNo = (/^--- Page (\d+) ---/.exec(page) || [])[1];
    for (const error of found) errors.push({ ...error, form, pageNo });
  }
  if (!errors.length) return [];
  const largest = Math.max(...errors.map((e) => Math.abs(e.printed - e.computed)));
  const where = (e) => `${e.form ? `${e.form} ` : ""}line ${e.line}${e.form ? "" : ` (page ${e.pageNo})`}`;
  const named = errors.slice(0, MAX_NAMED).map((e) => `${where(e)} prints ${signed(e.printed)} where its own instruction ("${e.instruction.toLowerCase()}") gives ${signed(e.computed)}`);
  const more = errors.length > MAX_NAMED ? `; and ${errors.length - MAX_NAMED} more` : "";
  return [{
    severity: largest >= HIGH_FROM ? "HIGH" : "MEDIUM",
    category: "Form arithmetic",
    title: errors.length === 1 ? `${where(errors[0])} — amount does not follow the form's own arithmetic` : "Form lines whose amount does not follow the form's own arithmetic",
    detail: `${named.join("; ")}${more}.`,
    action: "Recompute each line as its label says and correct the return before filing; if a carryforward line is wrong, the next year's return will start from the wrong figure.",
    authority: "The instructions printed on each form line",
    evidence: errors.map((e) => `${where(e)}, page ${e.pageNo}`).join("; "),
  }];
}

function runFormArithmeticChecks(files, meta = {}) {
  const list = Array.isArray(files) ? files : [];
  const current = list.find((f) => String(f?.reviewRole || f?.role || "").toLowerCase().includes("current_return"));
  if (!current) return [];
  const text = String((current.originalText || current.fullText || current.text || current.extractedText) || "");
  if (text.trim().length < 500) return [];
  try {
    return checkPrintedArithmetic(text);
  } catch (error) {
    console.warn(`[form-arithmetic] ${error.message}`);
    return [];
  }
}

module.exports = { runFormArithmeticChecks, checkPrintedArithmetic, arithmeticErrorsOnPage, pageRows, formOfPage, tailOf };
