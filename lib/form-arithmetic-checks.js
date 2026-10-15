"use strict";

/**
 * form-arithmetic-checks.js — la cuenta que el propio formulario imprime en el rotulo.
 *
 * Muchos renglones dicen como se calculan: "NOL available to be carried forward (subtract line
 * 7d from 7b)", "Add lines 22 and 23. This is your total tax", "Total deductions. Add lines 12
 * through 26". Si el importe impreso no es esa cuenta hecha con los importes impresos en la
 * misma pagina, el renglon esta mal, y no hace falta ningun criterio para decirlo. Sirve igual
 * para el 1040, el 1040-NR, el 1065, el 1120, el 1120-S, el 990 y los formularios estatales:
 * lo que se lee es la instruccion impresa, no una tabla de renglones por formulario.
 *
 * El caso que lo motiva: una C corp de Nueva York con perdidas. El CT-3.4 y el NYC-2.4 imprimian
 * en la linea 7b la perdida disponible (la anterior mas la del año) y en la linea 7, que dice
 * "subtract line 7d from 7b" con la 7d vacia, la perdida anterior sola. El arrastre a NY y a
 * la ciudad quedaba corto por toda la perdida del año, dos años seguidos, y la revision lo dio
 * por bueno. El mismo software hace lo mismo en otras corporaciones del estudio.
 *
 * Las cuentas que se entienden: "add lines X, Y and Z", rangos ("lines 9 through 21", "1a
 * through 1h", "14 through 17a"), "combine", "subtract line X from line Y", "add ... then
 * subtract line Z", "line X less line Y", "add line X to line Y" y "multiply line X by 80%".
 * Con varias columnas (principio y fin del año, federal y estatal, varias propiedades) se
 * compara columna por columna.
 *
 * Fail-closed, como todo el directorio:
 *  - nada con condiciones, topes, referencias a otro formulario o "see instructions"; el unico
 *    condicional aceptado es el piso en cero ("if zero or less, enter -0-");
 *  - cada renglon citado tiene que leerse en la misma pagina, una sola vez, antes del resultado;
 *    un rango con un renglon que no se lee no se comprueba;
 *  - un renglon citado vacio vale cero, pero si TODOS estan vacios el formulario se lleno desde
 *    una hoja de trabajo (el 8606 lo hace) y no se dice nada; vacio con una nota al lado ("SEE
 *    STATEMENT 1") no vale cero, el importe esta en la nota;
 *  - un resultado vacio no se juzga, ni uno con una nota del preparador al lado ("SEC 41(G)",
 *    "SEE STATEMENT 3"), ni uno que la pagina manda saltear ("skip line 8 and line 9"); un
 *    resultado negativo impreso como cero es el piso;
 *  - una perdida o una deduccion que el formulario imprime sin parentesis (varios estatales lo
 *    hacen) puede ir con cualquier signo, y "combine" acepta cualquier signo en todos;
 *  - con varias columnas, todas las cifras tienen que tener la misma cantidad de columnas.
 * Medido sobre cuarenta declaraciones reales (1040, 1065, 1120, 1120-S y sus estatales): solo
 * marca errores verdaderos.
 */

const REF = "[0-9]{1,2}[a-z]?";
const NUM = `(${REF})`;
/** Hasta este margen la diferencia es redondeo de dolares enteros. */
const ROUNDING = 2;
/** Desde aca es HIGH: una cuenta mal hecha por diez mil dolares cambia algo de verdad. */
const HIGH_FROM = 10000;
/**
 * Por debajo es LOW: unos dolares de multa que el formulario de NJ suma aparte y el software
 * compenso con el saldo a favor son una cuenta que no cierra, pero no un error que importe.
 */
const LOW_UNDER = 100;
/** Cuantos renglones se nombran en el hallazgo antes de decir "y N mas". */
const MAX_NAMED = 3;
/** Cuantas lineas de continuacion puede tener un rotulo antes de su importe. */
const MAX_CONTINUATION = 2;
/** Cuantos importes de signo dudoso se prueban con los dos signos (2^N combinaciones). */
const MAX_FLEXIBLE = 10;

/** Un renglon citado, o un rango de renglones. */
const ITEM = `(?:lines?\\s+)?${REF}(?:\\s*(?:through|thru|–|—|'|\\s-)\\s*(?:lines?\\s+)?${REF})?`;
const LIST = `${ITEM}(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)${ITEM})*`;
const OPERATIONS = [
  { kind: "subtract", re: new RegExp(`\\bsubtract\\s+(${LIST})\\s+from\\s+(${ITEM})\\b`) },
  { kind: "addTo", re: new RegExp(`\\badd\\s+(${ITEM})\\s+to\\s+(${ITEM})\\b`) },
  { kind: "add", re: new RegExp(`\\badd\\s+(?:the\\s+amounts?\\s+(?:shown\\s+)?(?:on|in|for)\\s+(?:the\\s+far\\s+right\\s+column\\s+for\\s+)?)?(${LIST})\\b(?:\\s*,?\\s*(?:and\\s+)?(?:then\\s+)?subtract\\s+(${LIST})\\b)?`) },
  { kind: "combine", re: new RegExp(`\\bcombine\\s+(${LIST})\\b`) },
  { kind: "less", re: new RegExp(`\\b(lines?\\s+${REF})\\s+(?:less|minus)\\s+((?:lines?\\s+)?${REF})\\b`) },
  { kind: "multiply", re: new RegExp(`\\bmultiply\\s+(?:line\\s+)?(${REF})\\s+by\\s+(\\d{1,2}(?:\\.\\d+)?)\\s*%(?:\\s*\\((?:0?\\.\\d+)\\))?`) },
  { kind: "multiply", re: new RegExp(`\\bmultiply\\s+(?:line\\s+)?(${REF})\\s+by\\s+(0?\\.\\d+)\\b(?!\\s*%)`) },
];
/** El piso en cero, el unico condicional que se acepta. */
const FLOOR = new RegExp(`\\(?\\s*(?:if\\s+(?:the\\s+result\\s+is\\s+)?(?:zero\\s+or\\s+less|less\\s+than\\s+(?:zero|0))\\s*,?\\s*enter\\s+(?:-0-|-0|0|zero|"0")(?:\\s+here)?|(?:do\\s+not|don.t)\\s+enter\\s+less\\s+than\\s+(?:zero|0|-0-)|if\\s+line\\s+${REF}\\s+(?:exceeds|is\\s+more\\s+than|is\\s+greater\\s+than)\\s+line\\s+${REF}\\s*,?\\s*enter\\s+(?:zero|-0-|0)(?:\\s+here)?)\\s*\\)?`, "g");
/** Lo que el rotulo agrega despues de la cuenta sin cambiarla. */
const HARMLESS = [
  /\bthis\s+is\s+(?:your|the)\b[^.;]*/g,
  /\b(?:also\s+)?enter\s+(?:the\s+(?:result|total)\s+|this\s+amount\s+|each\s+total\s+)?(?:here\s+)?and\s+(?:on|in)\b[^.;]*/g,
  /\bcontinue\s+to\s+part\s+\w+/g,
  // "Subtract line 20 from line 6 (see instructions)": la remision en su propio parentesis, al
  // final; "(add lines 4 and 8; see instructions)" no es esto y sigue sin comprobarse.
  /\(see\s+instructions\)\s*\.?\s*$/g,
  /\bin\s+(?:each\s+column|columns?\s+[(a-z0-9)]{1,3}(?:\s*,\s*(?:and\s+)?[(a-z0-9)]{1,3}|\s+and\s+[(a-z0-9)]{1,3})*)/g,
];
/** Lo que, si queda en el rotulo despues de sacar la cuenta, la vuelve otra cosa. */
const NOT_SIMPLE = /\bif\b|whichever|smaller|larger|greater|lesser|multiply|divide|percent|%|through|see instr|column|enter (?:the )?(?:amount|result)|schedule|\bform\s|\bpart\s|\bless\b|combine|more than|don.t enter|do not enter|\bbut\b|\badd\b|\bsubtract\b|\bthen\b|\bminus\b|\bplus\b|\btimes\b|\bexcept\b|\bexclud|\bworksheet\b|\bratio\b|\baverage\b/;
/** Los renglones cuyo importe impreso puede venir sin el signo de la perdida. */
const LOSS_WORDS = /\bloss(?:es)?\b|\bdeduct|\bexpense|\bnegative\b|\bdecrease/i;
/** El titulo de un cuadro: "Schedule M-2 Analysis of Partners' Capital Accounts". */
const HEADING = /^\s*(?:schedule\s+[A-Z](?:-\d)?\b(?!\s*,)|analysis\s+of\b)/i;
/** Codigo de formulario con su año, como lo imprimen el pie o el encabezado de la pagina. */
const FORM_ON_PAGE = /\b(?:Form\s+)?((?:[A-Z]{1,4}-)?\d[\d.]*[A-Z]?(?:-[A-Z0-9.]+)?)\s*(?:\(\s*(?:Rev\.?[^)]*|20\d{2})\s*\)|-\s*20\d{2}\b)/g;

/** Un importe como palabra: "1,234." "(4,000.)" "-1,250,000" "1,234-" "0.00". */
const AMOUNT_TOKEN = /^-?\(?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2}|\.)?\)?-?$/;
/** Los centavos aparte de Nueva York: "25300 .00", y ".00" solo en la casilla vacia. */
const CENTS_TOKEN = /^\.\d{2}$/;
/** Sin el numero de casilla al lado, solo vale un importe con formato de importe. */
const FORMATTED_TOKEN = /,\d{3}|\.\d{0,2}\)?-?$/;
const AMOUNT_RAW = "-?\\(?\\s*(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2}|\\.)?\\s*\\)?-?";

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function parseAmount(raw) {
  const text = String(raw || "").replace(/\s+/g, "");
  // La columna de centavos sola ("00") de algunos formularios estatales no es un importe.
  if (/^0{2}$/.test(text)) return null;
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-") || text.endsWith("-");
  const value = Number(text.replace(/[()$,-]/g, "").replace(/\.$/, ""));
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * La linea como la imprime cada formulario, llevada a un solo formato: los centavos de
 * Illinois ("0. 00") se pegan al importe, los parentesis se cierran sobre el importe y las
 * flechas (">") de algunos formularios se sacan.
 */
function normalizeLine(line) {
  return String(line || "")
    .replace(/(\d)\.\s+00(?=\s*$)/, "$1.00")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/(^|\s)>(?=\s)/g, "$1")
    .replace(/[’‘]/g, "'");
}

const tokensOf = (line) => String(line || "").trim().split(/\s+/).filter(Boolean);
const isLeader = (token) => /^\.+$/.test(token);

/**
 * Los importes al final de una linea despues de la casilla del renglon: "24 7,900.", "@ 7
 * 1,250,000", "7e. 125,000", "17 180000 .00 17 65000 .00" (una casilla por columna), "15
 * 400,000. 20,000." (una casilla, varias columnas), o la casilla sola (vacio).
 */
function amountsAfter(line, num, from = 0) {
  const tokens = tokensOf(line);
  const bare = (token) => token.replace(/^[@?Z>]+/, "");
  const isBox = (i) => bare(tokens[i]) === num || bare(tokens[i]) === `${num}.`;
  for (let start = from; start < tokens.length; start += 1) {
    if (!isBox(start)) continue;
    const groups = [];
    let previous = "";
    let ok = true;
    for (let i = start; i < tokens.length && ok; i += 1) {
      const token = tokens[i];
      if (isBox(i) && previous === "box") {
        // "11 11.": la casilla y un importe de 11; "12 12" no se sabe.
        if (!token.endsWith(".")) return null;
      } else if (isBox(i)) { groups.push([]); previous = "box"; continue; }
      if (CENTS_TOKEN.test(token) && (previous === "box" || previous === "whole")) { previous = "cents"; continue; }
      if (AMOUNT_TOKEN.test(token)) { groups[groups.length - 1].push(token); previous = /\./.test(token) ? "decimal" : "whole"; continue; }
      ok = false;
    }
    if (!ok) continue;
    let raws;
    if (groups.length > 1) {
      if (groups.some((g) => g.length > 1)) return null;
      raws = groups.map((g) => g[0] || "0");
      if (groups.every((g) => !g.length)) raws = [];
    } else raws = groups[0];
    const values = raws.map(parseAmount);
    if (values.some((v) => v === null)) return null;
    return { blank: !values.length, values, before: tokens.slice(0, start) };
  }
  return null;
}

/** Los importes del final que vienen despues de la guia de puntos, sin casilla. */
function amountsAfterLeaders(line) {
  const tokens = tokensOf(line);
  let i = tokens.length - 1;
  const raws = [];
  while (i >= 0 && (AMOUNT_TOKEN.test(tokens[i]) || (CENTS_TOKEN.test(tokens[i]) && i > 0 && /^\D*\d+$/.test(tokens[i - 1])))) {
    if (!CENTS_TOKEN.test(tokens[i])) raws.unshift(tokens[i]);
    i -= 1;
  }
  if (!raws.length || i < 1 || !isLeader(tokens[i]) || !isLeader(tokens[i - 1])) return null;
  if (!raws.every((raw) => FORMATTED_TOKEN.test(raw))) return null;
  const values = raws.map(parseAmount);
  return values.every((v) => v !== null) ? { blank: false, values, before: tokens.slice(0, i + 1) } : null;
}

/** Una linea que no es mas que importes (con la casilla del renglon adelante o sin ella). */
function onlyAmounts(line, num) {
  const tokens = tokensOf(line);
  const start = tokens.length && (tokens[0] === num || tokens[0] === `${num}.`) ? 1 : 0;
  const raws = tokens.slice(start).filter((t) => !CENTS_TOKEN.test(t));
  if (!raws.length || !raws.every((t) => AMOUNT_TOKEN.test(t) && FORMATTED_TOKEN.test(t))) return null;
  const values = raws.map(parseAmount);
  return values.every((v) => v !== null) ? { blank: false, values, before: [] } : null;
}

/** El importe de un renglon: su numero repetido al final de la linea, y el importe despues. */
function tailOf(line, num) {
  const tail = amountsAfter(normalizeLine(line), num);
  return tail ? { blank: tail.blank, value: tail.blank ? 0 : tail.values[0] } : null;
}

/**
 * Entre la guia de puntos y la casilla, una nota del preparador ("SEE STATEMENT 1", "SEC
 * 41(G)"): el importe no sale de la cuenta del rotulo, o esta en otra hoja.
 */
function annotated(before) {
  const list = before || [];
  // La guia son dos puntos seguidos o mas; "Illinois base income . Subtract" no es guia.
  let last = -1;
  list.forEach((token, i) => { if (isLeader(token) && (isLeader(list[i - 1] || "") || /^\.{2,}$/.test(token))) last = i; });
  if (last < 0) return false;
  return list.slice(last + 1).some((token) => /[A-Za-z]{2,}/.test(token));
}

/** La casilla de signo de Ohio: "- . 9 20000" es un importe negativo. */
const signBox = (before) => (before || []).filter((t) => !isLeader(t)).slice(-1)[0] === "-";

/**
 * Dos renglones en la misma linea (el M-1 y el M-2 se imprimen en dos columnas): se cortan
 * despues del importe, o de la guia de puntos, que cierra el de la izquierda.
 */
function splitSideBySide(line) {
  const boundary = new RegExp(`((?:\\.\\s){2,}\\s*(?:${REF}\\.?\\s+)?(?:${AMOUNT_RAW})?)\\s+(?=${REF}\\s+[A-Z][a-z])`, "g");
  return line.replace(boundary, "$1\n").split("\n");
}

/** Las letras verticales del margen ("I 4 Ordinary income", "S E 10 Guaranteed payments"). */
const stripSideLetters = (line) => line.replace(new RegExp(`^\\s*(?:[A-Z]\\s+){1,3}(?=${REF}\\s+[A-Za-z(])`), "");

/** Las lineas de la pagina, normalizadas y con los renglones de dos columnas separados. */
function pageLines(page) {
  const out = [];
  for (const line of String(page || "").split(/\r?\n/)) for (const part of splitSideBySide(normalizeLine(line))) out.push(stripSideLetters(part));
  return out;
}

/** Los renglones numerados de una pagina, con su rotulo y su importe (o vacio, o ilegible). */
function pageRows(page) {
  const lines = Array.isArray(page) ? page : pageLines(page);
  const rows = [];
  const startsRow = new RegExp(`^\\s*${NUM}\\s+\\S`);
  const consumed = new Set();
  lines.forEach((line, index) => {
    if (consumed.has(index)) return;
    const m = new RegExp(`^\\s*${NUM}\\s+(\\S.*)$`).exec(line);
    if (!m) return;
    const num = m[1];
    // "58 58": el numero a los dos lados y nada mas; el rotulo quedo en otra parte.
    if (m[2].trim() === num) { rows.push({ num, label: "", line, tail: null, index }); return; }
    let label = m[2];
    // El primer numero de la linea es el del renglon, no su casilla ("18  18 300,000.").
    let tail = amountsAfter(line, num, 1) || amountsAfterLeaders(line);
    // El importe en la linea siguiente, solo ("22 ... 22" y abajo "1,800,000."), o con el
    // numero repetido ("See Statement 1" y abajo "21 450,000.").
    if (!tail || tail.blank) {
      const next = lines[index + 1];
      const below = next !== undefined ? onlyAmounts(next, num) : null;
      if (below && (!startsRow.test(next) || new RegExp(`^\\s*${escapeRegex(num)}\\.?\\s`).test(next))) {
        tail = { ...below, before: tail ? tail.before : tokensOf(line) };
        consumed.add(index + 1);
      }
    }
    // Un rotulo de varias lineas deja la cuenta y el importe en las siguientes.
    for (let k = 1; !tail && k <= MAX_CONTINUATION; k += 1) {
      const next = lines[index + k];
      if (next === undefined || startsRow.test(next) || /^--- Page/.test(next)) break;
      label = `${label} ${next}`;
      tail = amountsAfter(next, num) || amountsAfterLeaders(next);
      // "15 Other (list) SEE STM 1,500" y abajo "15" solo: el importe quedo en el rotulo.
      if (tail && tail.blank && FORMATTED_TOKEN.test(tokensOf(line).slice(-1)[0] || "")) tail = null;
    }
    const note = tail ? annotated(tail.before) : false;
    // Vacio con una nota al lado: el importe esta en la nota, no es cero.
    if (tail && tail.blank && note) tail = null;
    rows.push({ num, label, line, tail, index, note, signUnknown: Boolean(tail && signBox(tail.before)) });
  });
  return rows;
}

/**
 * Las casillas sueltas: "2a 1,200. b Taxable interest ... 2b 5,600." deja el 2a y el 2b en una
 * sola linea, y "b Less depreciation ... 16b 16c" deja el 16c vacio al final. Solo valen si el
 * numero aparece una sola vez como casilla en la pagina; una casilla sin letra, solo despues de
 * la guia de puntos.
 */
function pageCells(lines) {
  const found = new Map();
  const add = (ref, cell) => found.set(ref, found.has(ref) ? null : cell);
  const withAmount = new RegExp(`(?:(?<=\\.\\s)(\\d{1,2})|(?<=^|[\\s@?>])(\\d{1,2}[a-z])\\.?)\\s+(${AMOUNT_RAW})(?=\\s*$|\\s+[a-z]\\s+[A-Z(])`, "g");
  // Vacia solo despues de la guia de puntos o de otra casilla: "line 7a" al final de un rotulo
  // es una cita, no una casilla.
  const blankLettered = new RegExp(`(?<=(?:\\.|\\d|\\d[a-z])\\s)(\\d{1,2}[a-z])(?=\\s*$|\\s+[a-z]\\s+[A-Z(]|\\s+\\d{1,2}[a-z]\\s*$)`, "g");
  lines.forEach((line, index) => {
    for (const m of line.matchAll(withAmount)) {
      const value = parseAmount(m[3]);
      if (value !== null) add(m[1] || m[2], { tail: { blank: false, values: [value] }, index });
    }
    for (const m of line.matchAll(blankLettered)) add(m[1], { tail: { blank: true, values: [] }, index });
  });
  return found;
}

/** Como se arma la cuenta del rotulo: los renglones con su signo, el piso y la operacion. */
function parseInstruction(label, num) {
  let text = String(label || "").replace(/[’‘]/g, "'").split(/\s(?:\.\s?){2,}|…/)[0];
  text = text.replace(new RegExp(`\\s${escapeRegex(num)}\\.?(?:\\s+${AMOUNT_RAW}(?:\\s+\\.\\d{2})?)*\\s*$`), "").replace(/\s+/g, " ").trim().toLowerCase();
  for (const { kind, re } of OPERATIONS) {
    const m = re.exec(text);
    if (!m) continue;
    let rest = text.replace(m[0], " ");
    const floor = FLOOR.test(rest);
    FLOOR.lastIndex = 0;
    rest = rest.replace(FLOOR, " ");
    for (const harmless of HARMLESS) rest = rest.replace(harmless, " ");
    if (NOT_SIMPLE.test(rest)) return null;
    const base = { text: m[0], floor, farRight: /far\s+right\s+column/.test(m[0]), combine: kind === "combine" };
    const plus = (list) => splitList(list).map((item) => ({ item, sign: 1 }));
    const minus = (list) => splitList(list).map((item) => ({ item, sign: -1 }));
    if (kind === "subtract") return { ...base, kind: "sum", terms: [...plus(m[2]), ...minus(m[1])] };
    if (kind === "addTo") return { ...base, kind: "sum", terms: [...plus(m[1]), ...plus(m[2])] };
    if (kind === "add") return { ...base, kind: "sum", terms: [...plus(m[1]), ...(m[2] ? minus(m[2]) : [])] };
    if (kind === "combine") return { ...base, kind: "sum", terms: plus(m[1]) };
    if (kind === "less") return { ...base, kind: "sum", terms: [...plus(m[1]), ...minus(m[2])] };
    if (kind === "multiply") {
      const factor = /%/.test(m[0]) ? Number(m[2]) / 100 : Number(m[2]);
      return { ...base, kind: "multiply", factor, terms: plus(m[1]) };
    }
  }
  return null;
}

/** "lines 1z, 2b and 9 through 12" -> [{from: "1z"}, {from: "2b"}, {from: "9", to: "12"}]. */
function splitList(list) {
  return String(list).replace(/\blines?\s+/g, "").split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).filter(Boolean).map((part) => {
    const range = new RegExp(`^(${REF})\\s*(?:through|thru|–|—|'|-)\\s*(${REF})$`).exec(part.trim());
    return range ? { from: range[1], to: range[2] } : { from: part.trim() };
  });
}

const splitRef = (ref) => { const m = /^(\d{1,2})([a-z]?)$/.exec(ref); return m ? { n: Number(m[1]), letter: m[2] } : null; };
const lettersBetween = (from, to) => { const out = []; for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c += 1) out.push(String.fromCharCode(c)); return out; };

/**
 * Los renglones de un rango, o null si no se puede saber cuales son. Un numero sin letra
 * arrastra sus renglones con letra ("33 through 39" incluye el 38a); un numero que solo existe
 * con letras ("16a", "16b", "16c") vale por la ultima letra si el rotulo dice "far right
 * column", y si no, el rango no se comprueba.
 */
function expandItem(item, find, farRight) {
  if (!item.to) return [item.from];
  const a = splitRef(item.from);
  const b = splitRef(item.to);
  if (!a || !b || b.n < a.n || b.n - a.n > 40) return null;
  if (a.n === b.n) return a.letter && b.letter && b.letter >= a.letter ? lettersBetween(a.letter, b.letter).map((l) => `${a.n}${l}`) : null;
  if (a.letter) return null;
  const refs = [];
  const lettered = (n) => lettersBetween("a", "z").map((l) => `${n}${l}`).filter((r) => find(r) !== undefined);
  for (let n = a.n; n <= b.n; n += 1) {
    if (n === b.n && b.letter) {
      if (find(String(n)) !== undefined) refs.push(String(n));
      refs.push(...lettersBetween("a", b.letter).map((l) => `${n}${l}`));
      continue;
    }
    if (find(String(n)) !== undefined) { refs.push(String(n), ...lettered(n).filter((r) => find(r)?.row)); continue; }
    const parts = lettered(n);
    if (farRight && parts.length) refs.push(parts[parts.length - 1]);
    else return null;
  }
  return refs;
}

/** Los renglones que la pagina manda saltear: "skip line 8 and line 9", "skip lines 25 through 31". */
function skippedOnPage(lines) {
  const out = new Set();
  for (const m of lines.join(" ").matchAll(/\bskip\s+(lines?\s+[^.;:]*)/gi)) {
    for (const item of splitList(m[1].toLowerCase().replace(/\bline\s+/g, "").match(new RegExp(`${REF}(?:\\s*(?:through|and|,|&)\\s*${REF})*`))?.[0] || "")) {
      const a = splitRef(item.from);
      const b = item.to ? splitRef(item.to) : a;
      if (!a || !b) continue;
      if (!item.to) out.add(item.from);
      else for (let n = a.n; n <= b.n && n - a.n <= 40; n += 1) out.add(String(n));
    }
  }
  return out;
}

/** La cuenta, columna por columna, probando los dos signos en los importes de signo dudoso. */
function columnAgrees(rule, values, signs, flexible, printed, signUnknown) {
  const fits = (total) => {
    const expected = total < 0 && (printed === 0 || rule.floor) ? 0 : total;
    const tolerance = Math.max(ROUNDING, Math.abs(expected) * 0.001);
    return Math.abs(printed - expected) <= tolerance || (signUnknown && Math.abs(Math.abs(printed) - Math.abs(expected)) <= tolerance);
  };
  if (rule.kind === "multiply") return fits(values[0] * rule.factor);
  const canonical = values.reduce((sum, v, i) => sum + signs[i] * v, 0);
  if (fits(canonical)) return true;
  const fixed = values.reduce((sum, v, i) => sum + (flexible[i] ? 0 : signs[i] * v), 0);
  const loose = values.filter((v, i) => flexible[i] && v !== 0);
  if (!loose.length || loose.length > MAX_FLEXIBLE) return false;
  for (let mask = 0; mask < 1 << loose.length; mask += 1) {
    const total = loose.reduce((sum, v, i) => sum + ((mask >> i) & 1 ? -v : v), fixed);
    if (fits(total)) return true;
  }
  return false;
}

/** Los renglones de una pagina cuyo importe no es la cuenta que su rotulo imprime. */
function arithmeticErrorsOnPage(page, stats) {
  const lines = pageLines(page);
  const rows = pageRows(lines);
  // Cada cuadro de la pagina numera desde 1 (el 1065 trae el Analysis of Net Income, el L, el
  // M-1 y el M-2 en la misma hoja): un renglon se busca primero en su cuadro.
  const blockOf = [];
  lines.reduce((block, line, i) => { const b = HEADING.test(line) ? block + 1 : block; blockOf[i] = b; return b; }, 0);
  const byNum = new Map();
  const byBlock = new Map();
  for (const row of rows) {
    byNum.set(row.num, byNum.has(row.num) ? null : row); // repetido: ambiguo
    const key = `${blockOf[row.index]}|${row.num}`;
    byBlock.set(key, byBlock.has(key) ? null : row);
  }
  let cells = null;
  const asCited = (row) => (row && row.tail ? { row, tail: row.tail, index: row.index, label: row.label, signUnknown: row.signUnknown } : null);
  // undefined: no esta en la pagina; null: esta pero no se lee, o esta dos veces.
  const findIn = (block) => (ref) => {
    const key = `${block}|${ref}`;
    if (byBlock.has(key)) return asCited(byBlock.get(key));
    if (byNum.has(ref)) return asCited(byNum.get(ref));
    cells = cells || pageCells(lines);
    if (!cells.has(ref)) return undefined;
    return cells.get(ref);
  };
  let skipped = null;
  const out = [];
  for (const row of rows) {
    if (!row.tail || row.tail.blank || row.note) continue;
    const find = findIn(blockOf[row.index]);
    const rule = parseInstruction(row.label, row.num);
    if (!rule) continue;
    // "If line 7 is a loss, skip line 8 and line 9": la condicion no se evalua, pero un renglon
    // en cero que la pagina manda saltear se salteo.
    skipped = skipped || skippedOnPage(lines);
    if (skipped.has(row.num) && row.tail.values.every((v) => v === 0)) continue;
    const refs = [];
    const signs = [];
    let ok = true;
    for (const term of rule.terms) {
      const expanded = expandItem(term.item, find, rule.farRight);
      if (!expanded) { ok = false; break; }
      for (const ref of expanded) { refs.push(ref); signs.push(term.sign); }
    }
    if (!ok || refs.length < (rule.kind === "multiply" ? 1 : 2) || refs.includes(row.num) || new Set(refs).size !== refs.length) continue;
    const cited = refs.map(find);
    if (cited.some((c) => !c || c.index > row.index)) continue;
    if (cited.every((c) => c.tail.blank)) continue; // se lleno desde una hoja de trabajo
    const columns = row.tail.values.length;
    const valuesOf = (c) => (c.tail.blank ? new Array(columns).fill(0) : c.tail.values);
    if (cited.some((c) => valuesOf(c).length !== columns)) continue;
    const flexible = cited.map((c) => rule.combine || Boolean(c.signUnknown) || LOSS_WORDS.test(c.label || ""));
    if (stats) stats.checked = (stats.checked || 0) + 1;
    for (let col = 0; col < columns; col += 1) {
      const values = cited.map((c) => valuesOf(c)[col]);
      const printed = row.tail.values[col];
      if (columnAgrees(rule, values, signs, flexible, printed, row.signUnknown)) continue;
      const computed = rule.kind === "multiply" ? values[0] * rule.factor : values.reduce((sum, v, i) => sum + signs[i] * v, 0);
      out.push({ line: row.num, instruction: rule.text, printed, computed: computed < 0 && rule.floor ? 0 : computed, column: columns > 1 ? col + 1 : 0 });
      break;
    }
  }
  return out;
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

const money = (n) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const signed = (n) => (n < 0 ? `-${money(n)}` : money(n));

function checkPrintedArithmetic(text, stats) {
  const errors = [];
  for (const page of String(text || "").split(/\n(?=--- Page \d+ ---)/)) {
    const found = arithmeticErrorsOnPage(page, stats);
    if (!found.length) continue;
    const form = formOfPage(page);
    const pageNo = (/^--- Page (\d+) ---/.exec(page) || [])[1];
    for (const error of found) errors.push({ ...error, form, pageNo });
  }
  if (!errors.length) return [];
  const largest = Math.max(...errors.map((e) => Math.abs(e.printed - e.computed)));
  const where = (e) => `${e.form ? `${e.form} ` : ""}line ${e.line}${e.column ? ` (column ${e.column})` : ""}${e.form ? "" : ` (page ${e.pageNo})`}`;
  const named = errors.slice(0, MAX_NAMED).map((e) => `${where(e)} prints ${signed(e.printed)} where its own instruction ("${e.instruction}") gives ${signed(e.computed)}`);
  const more = errors.length > MAX_NAMED ? `; and ${errors.length - MAX_NAMED} more` : "";
  return [{
    severity: largest >= HIGH_FROM ? "HIGH" : largest < LOW_UNDER ? "LOW" : "MEDIUM",
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

module.exports = { runFormArithmeticChecks, checkPrintedArithmetic, arithmeticErrorsOnPage, pageRows, pageLines, pageCells, parseInstruction, formOfPage, tailOf };
