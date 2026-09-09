"use strict";

/**
 * state-return-checks.js — cruzar las declaraciones estatales sin un parser por estado.
 *
 * Por que en codigo y no en el modelo: los cruces deterministas leen el texto COMPLETO del
 * paquete, sin pasar por el presupuesto de entrada ni por el techo de gasto. Sobre un paquete
 * con doce estados el modelo llega a leer cuatro; el codigo los lee los doce, siempre, y no
 * cuesta un centavo. Todo lo estatal que se pueda decidir con una comparacion conviene que
 * viva de este lado.
 *
 * Por que sin parser por estado: escribir un lector para cada uno de los cincuenta formularios
 * es inmantenible y envejece cada año. Lo que se aprovecha aca es lo unico que TODOS comparten
 * por construccion — una declaracion estatal arranca de una cifra federal y la vuelve a
 * imprimir. Si esa cifra no es la que dice la declaracion federal, el estatal se preparo contra
 * otra version del federal y todo lo que sigue en esa hoja esta mal. Es un error caro, silencioso
 * y frecuente cuando el federal se corrige despues de armar los estados.
 *
 * Lo mismo para los identificadores: el codigo NAICS, la actividad principal, la fecha de inicio
 * y el domicilio se reimprimen en el encabezado de cada estatal. Una declaracion estatal armada
 * sobre una plantilla del año pasado se delata ahi.
 *
 * Fail-closed, como el resto del directorio: un ancla que no se puede leer con confianza no
 * produce hallazgo. Y el sesgo va siempre a callar: una diferencia que puede explicarse por la
 * estructura del formulario estatal no se reporta.
 */

const AMOUNT = /-?\(?\$?\s?(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d{2})?\)?-?/;

function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-") || text.endsWith("-");
  const cleaned = text.replace(/[()$,\s-]/g, "").replace(/\.$/, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function linesOf(text) {
  return String(text || "").split(/\r?\n/);
}

/** El ultimo importe de una linea, que es donde los formularios imprimen la respuesta. */
function lastAmount(line) {
  const hits = String(line || "").match(new RegExp(AMOUNT.source, "g"));
  if (!hits) return null;
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const value = parseAmount(hits[i]);
    // Un año suelto no es un importe.
    if (value !== null && !(value >= 1900 && value <= 2100 && !/[,.]/.test(hits[i]))) return value;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * 1. Una estatal que arranca de una cifra federal distinta a la del federal.
 * ------------------------------------------------------------------------- */

/** De donde sale la cifra de arranque, segun el tipo de declaracion. */
const FEDERAL_ANCHOR = {
  "1040": {
    // 1040 linea 11: "Subtract line 10 from line 9. This is your adjusted gross income".
    onFederal: /this is your adjusted gross income/i,
    onState: /federal adjusted gross income/i,
    label: "federal adjusted gross income",
    federalLine: "Form 1040 line 11",
  },
  "1120": {
    onFederal: /^\s*(?:[A-Z] )?30\s+Taxable income\.\s*Subtract line 29c/i,
    onState: /federal taxable income/i,
    label: "federal taxable income",
    federalLine: "Form 1120 line 30",
  },
};

function anchorFor(returnType) {
  const type = String(returnType || "").replace(/\s+/g, "").toUpperCase();
  if (/^1040/.test(type)) return FEDERAL_ANCHOR["1040"];
  if (/^1120S/.test(type) || /^1120-S/.test(type)) return null; // el 1120-S no tiene una cifra unica de arranque
  if (/^1120/.test(type)) return FEDERAL_ANCHOR["1120"];
  return null;
}

/**
 * La cifra federal, leida de la propia declaracion federal.
 * Devuelve null si la linea no se puede leer, que es la unica respuesta honesta.
 */
function federalFigure(text, anchor) {
  for (const line of linesOf(text)) {
    if (!anchor.onFederal.test(line)) continue;
    const value = lastAmount(line);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Toda vez que una hoja estatal reimprime la cifra federal, con TODOS los numeros de la linea.
 *
 * Todos y no solo el ultimo, porque muchos formularios estatales son de dos columnas — una con
 * la cifra federal y otra con la parte del estado — y en esos la linea trae las dos: "19 Federal
 * adjusted gross income 19 13836722 .00 19 10030 .00". Tomando el ultimo se leia la columna
 * estatal y se reportaba una diferencia que no existe.
 *
 * Se descartan tres clases de linea que mencionan la cifra federal sin reexpresarla: las
 * "recomputed", que varios estados piden calcular con sus propias reglas y por definicion
 * difieren; las adiciones y sustracciones A esa cifra, que son otra cosa; y las que no traen
 * ningun importe, que son encabezados de seccion.
 */
const RECOMPUTED = /recomputed|as recomputed|recalculated/i;
const MODIFICATION_TO = /\b(?:additions?|subtractions?|adjustments?|modifications?)\s+(?:to|from)\b/i;

function amountsOn(line) {
  const hits = String(line || "").match(new RegExp(AMOUNT.source, "g")) || [];
  const out = [];
  for (const hit of hits) {
    const value = parseAmount(hit);
    if (value === null) continue;
    if (value >= 1900 && value <= 2100 && !/[,.]/.test(hit)) continue; // un año suelto
    out.push(value);
  }
  return out;
}

function stateFigures(text, anchor) {
  const found = [];
  linesOf(text).forEach((line, index) => {
    if (!anchor.onState.test(line)) return;
    if (RECOMPUTED.test(line) || MODIFICATION_TO.test(line)) return;
    const values = amountsOn(line);
    if (!values.length) return;
    found.push({ values, line: line.trim().slice(0, 140), lineNumber: index + 1 });
  });
  return found;
}

/** Debajo de esta diferencia es redondeo del formulario estatal, no un error. */
const FIGURE_TOLERANCE = 1;

function checkStateFederalStartingFigure(currentText, meta = {}) {
  const anchor = anchorFor(meta.returnType);
  if (!anchor) return null;
  const federal = federalFigure(currentText, anchor);
  if (federal === null) return null;

  // Solo es un desajuste cuando NINGUN numero de la linea es la cifra federal. En un formulario
  // de dos columnas la cifra correcta esta en la linea aunque no sea la ultima.
  const differing = stateFigures(currentText, anchor)
    .filter((row) => !row.values.some((value) => Math.abs(value - federal) <= FIGURE_TOLERANCE));
  if (!differing.length) return null;

  const money = (n) => `$${Number(n).toLocaleString("en-US")}`;
  const unique = [...new Map(differing.map((row) => [row.values[row.values.length - 1], row])).values()].slice(0, 3);
  const list = unique.map((row) => `${money(row.values[row.values.length - 1])} ("${row.line}")`).join("; ");
  return {
    severity: "HIGH",
    category: "State returns",
    title: "A state return starts from a different federal figure than the federal return reports",
    detail: `The federal return reports ${money(federal)} of ${anchor.label} on ${anchor.federalLine}, and ${differing.length} state line(s) in this package restate it as something else: ${list}.`,
    action: `Find out which figure is current. A state return that starts from a stale ${anchor.label} carries that error through every line below it — the state's own income, its modifications, its tax and its payments are all computed off the wrong opening number, so the state return has to be redone rather than patched.`,
    authority: "Every state income tax return begins from the federal figure; the state and federal returns must report the same one",
    dedupe: /federal (?:adjusted gross income|taxable income)|state return.{0,40}federal/i,
  };
}

/* ---------------------------------------------------------------------------
 * 2. Identificadores del encabezado que no coinciden entre el federal y un estatal.
 * ------------------------------------------------------------------------- */

/**
 * Como se normaliza cada cosa para poder compararla entre formularios distintos.
 *
 * Solo esta el codigo de actividad, y es a proposito. Para que un campo entre aca su etiqueta
 * federal y su etiqueta estatal tienen que poder distinguirse en el texto plano, y casi ninguna
 * puede: la fecha de inicio, por ejemplo, se imprime "E Date business started" en el 1065 y
 * "...Principal product or service Date business started" en el IT-204, y cualquier patron que
 * agarre una agarra la otra — con lo cual el valor "federal" termina siendo los dos valores y
 * el cruce se apaga solo. El codigo de actividad si se distingue: el federal encabeza su linea
 * ("C Business code number") y el estatal siempre lleva NAICS adelante.
 *
 * Es el campo que mas sirve de todos modos: un formulario estatal arrastrado de una plantilla
 * del año anterior se delata en el codigo antes que en cualquier otro dato del encabezado.
 */
const IDENTIFIER_FIELDS = [
  {
    key: "NAICS business code",
    federal: /^\s*C?\s*Business code number\b/i,
    state: /NAICS business code number|Principal Business Activity Code/i,
    normalize: (raw) => (String(raw).match(/\b\d{6}\b/) || [])[0] || null,
  },
];

/**
 * Los valores que rodean a una etiqueta. Los formularios parten la etiqueta y el dato en
 * lineas distintas segun el ancho de la columna, asi que se mira la linea y la siguiente.
 */
function valueNear(lines, index, normalize) {
  for (let offset = 0; offset <= 2; offset += 1) {
    const candidate = normalize(lines[index + offset] || "");
    if (candidate) return candidate;
  }
  return null;
}

function collectField(text, pattern, normalize) {
  const lines = linesOf(text);
  const values = new Map();
  lines.forEach((line, index) => {
    if (!pattern.test(line)) return;
    const value = valueNear(lines, index, normalize);
    if (value) values.set(value, (values.get(value) || 0) + 1);
  });
  return values;
}

function checkStateIdentifiersAgainstFederal(currentText) {
  const problems = [];
  for (const field of IDENTIFIER_FIELDS) {
    const federal = collectField(currentText, field.federal, field.normalize);
    const state = collectField(currentText, field.state, field.normalize);
    if (federal.size !== 1 || !state.size) continue; // sin un valor federal claro no se opina
    const federalValue = [...federal.keys()][0];
    const mismatched = [...state.keys()].filter((value) => value !== federalValue);
    if (mismatched.length) problems.push({ field: field.key, federal: federalValue, state: mismatched.slice(0, 2) });
  }
  if (!problems.length) return null;

  const list = problems
    .map((p) => `${p.field}: the federal return says ${p.federal} and a state return says ${p.state.join(", ")}`)
    .join("; ");
  return {
    severity: "MEDIUM",
    category: "State returns",
    title: "A state return carries a different header identifier than the federal return",
    detail: `${list}.`,
    action: "Reconcile the header on every state return with the federal. A state form that disagrees on the business code, the activity or the date the business started is usually a form rolled forward from a prior year whose header was never refreshed, and the same staleness tends to reach the numbers below it.",
    authority: "State return header data must agree with the federal return it is built from",
    dedupe: /naics|business code|date business started|state return.{0,40}header/i,
  };
}

/* ---------------------------------------------------------------------------
 * 3. Un porcentaje de asignacion imposible.
 * ------------------------------------------------------------------------- */

const APPORTIONMENT_LINE = /(?:business allocation percentage|apportionment (?:fraction|percentage|factor)|allocation percentage)\b/i;
/**
 * Una linea que USA el porcentaje para calcular un importe no es la linea del porcentaje.
 * "5 Multiply Line 4 by the business allocation percentage ... 5. 14,255" es un monto en
 * dolares, y de ahi salio un "255%" que no existe.
 */
const APPLIES_PERCENT = /\bmultiply|\btimes\b|\bapply\b/i;
/**
 * Un porcentaje impreso como 100, 100.0000 o 1.000000 segun el estado, con el signo % pegado
 * al final. Exigir el signo es lo que separa un porcentaje de los ultimos tres digitos de un
 * importe, y el caracter previo tiene que no ser digito ni coma para no morder "14,255".
 */
const PERCENT_ON_LINE = /(?:^|[^\d,.])(\d{1,3}(?:\.\d{1,6})?)\s*%\s*$/;
/** Por encima de esto no es un porcentaje sino otra cosa que quedo en la linea. */
const IMPOSSIBLE_PERCENT = 100;

function checkApportionmentOutOfRange(currentText) {
  const bad = [];
  for (const raw of linesOf(currentText)) {
    const line = raw.trim();
    if (!APPORTIONMENT_LINE.test(line) || APPLIES_PERCENT.test(line)) continue;
    const hit = PERCENT_ON_LINE.exec(line);
    if (!hit) continue;
    const value = Number(hit[1]);
    // El numero de la casilla NO es un porcentaje. Una linea vacia reimprime su propio numero
    // antes del campo — "126 Business allocation percentage (divide line 125 por tres) 126 %" —
    // y eso se leia como 126%. Es la cuarta vez que este archivo tropieza con lo mismo en
    // formularios distintos, asi que la comparacion es explicita.
    const boxNumber = Number((line.match(/^(\d{1,3})\b/) || [])[1]);
    if (Number.isFinite(boxNumber) && value === boxNumber) continue;
    // Solo se reporta lo que no puede ser: por encima del 100%. Un porcentaje bajo es normal
    // y uno en blanco tambien — muchas hojas imprimen la etiqueta sin dato.
    if (Number.isFinite(value) && value > IMPOSSIBLE_PERCENT && value <= 100000) {
      bad.push({ value, line: line.slice(0, 130) });
    }
  }
  if (!bad.length) return null;
  const first = bad[0];
  return {
    severity: "HIGH",
    category: "State returns",
    title: "An apportionment percentage is above 100%",
    detail: `A state return reports an allocation of ${first.value}%: "${first.line}". A share of income assigned to one state cannot exceed the whole.`,
    action: "Recheck the apportionment factor. A percentage above 100 is normally a numerator and denominator that were entered the wrong way round, or a factor entered as a dollar amount.",
    authority: "State apportionment: the percentage assigned to a jurisdiction cannot exceed 100%",
    dedupe: /apportion|allocation percentage/i,
  };
}

/**
 * Corre los cruces estatales sobre la declaracion del año en curso.
 * Silencioso por diseño: un paquete sin declaraciones estatales no produce nada.
 */
function runStateReturnChecks(files, meta = {}) {
  const list = Array.isArray(files) ? files : [];
  const current = list.find((file) => String(file?.reviewRole || file?.role || "").toLowerCase().includes("current_return"));
  if (!current) return [];
  const text = String((current.originalText || current.fullText || current.text || current.extractedText) || "");
  if (text.trim().length < 500) return [];
  return [
    checkStateFederalStartingFigure(text, meta),
    checkStateIdentifiersAgainstFederal(text),
    checkApportionmentOutOfRange(text),
  ].filter(Boolean);
}

module.exports = {
  runStateReturnChecks,
  checkStateFederalStartingFigure,
  checkStateIdentifiersAgainstFederal,
  checkApportionmentOutOfRange,
  federalFigure, stateFigures, collectField, lastAmount, parseAmount,
  FEDERAL_ANCHOR, IDENTIFIER_FIELDS, FIGURE_TOLERANCE,
};
