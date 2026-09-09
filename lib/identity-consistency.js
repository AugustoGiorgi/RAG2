"use strict";

/**
 * identity-consistency.js — quien es el contribuyente y de que año es cada declaracion.
 *
 * Por que existe: la pestaña Review tiene treinta y seis cruces deterministicos y treinta y
 * cuatro de ellos comparan el año corriente contra el anterior. Todos parten de una premisa
 * que nadie verificaba: que el archivo marcado prior_return es efectivamente la declaracion
 * del año anterior DEL MISMO contribuyente. Si se adjunta el mismo año dos veces, o la
 * declaracion de otro cliente, cada uno de esos cruces igual corre y devuelve resultados que
 * parecen autoritativos y no lo son — la continuidad del balance "cierra" porque compara un
 * año contra si mismo, y las diferencias reales quedan invisibles.
 *
 * Lo otro que resuelve: nombre, numero de identificacion y año fiscal eran hasta ahora 100%
 * del modelo (el campo infoConsistency). El modelo los lee bien casi siempre, pero "casi
 * siempre" sobre el SSN de un e-file es la clase de error que rechaza la presentacion. Un
 * numero que se repite en el encabezado de cada pagina no necesita un modelo: se cuenta.
 *
 * Fail-closed, igual que el resto del directorio: si el documento no deja leer el ancla con
 * margen suficiente no hay hallazgo. Nunca un hallazgo adivinado.
 */

const { splitReturns, returnYear } = require("./prior-year-bridge");

/** SSN (000-00-0000) o EIN (00-0000000) tal como los imprime una declaracion. */
const IDENTIFIER = /\b(?:\d{3}-\d{2}-\d{4}|\d{2}-\d{7})\b/g;

/**
 * Cuantas veces tiene que aparecer el numero para tomarlo por el del contribuyente. Medido
 * sobre trece declaraciones presentadas: el minimo observado fue veintisiete apariciones.
 */
const IDENTIFIER_MIN_COUNT = 5;
/**
 * Y cuanto tiene que sacarle al segundo. Una declaracion trae numeros de terceros — el EIN
 * del empleador en cada W-2, el de cada sociedad que emite un K-1, el SSN del conyuge en las
 * estatales. El del contribuyente esta en el encabezado de TODAS las paginas, asi que gana
 * por un margen que en esa muestra fue de cuatro a veintidos veces. Con menos de tres no se
 * decide nada.
 */
const IDENTIFIER_MIN_RATIO = 3;

function textOf(file) {
  return String((file && (file.originalText || file.fullText || file.text || file.extractedText)) || "");
}

/**
 * El numero de identificacion del contribuyente: el mas repetido del documento, y solo
 * cuando le saca al segundo el margen de arriba. Devuelve null si la eleccion no es clara.
 */
function dominantIdentifier(text) {
  const counts = new Map();
  for (const hit of String(text || "").matchAll(IDENTIFIER)) {
    counts.set(hit[0], (counts.get(hit[0]) || 0) + 1);
  }
  if (!counts.size) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const value = ranked[0][0];
  const count = ranked[0][1];
  if (count < IDENTIFIER_MIN_COUNT) return null;
  const runnerUp = ranked.length > 1 ? ranked[1][1] : 0;
  if (runnerUp > 0 && count < runnerUp * IDENTIFIER_MIN_RATIO) return null;
  return { value, count };
}

/** Los ultimos cuatro digitos, que es lo unico que corresponde escribir en un informe. */
function masked(identifier) {
  const digits = String(identifier || "").replace(/\D/g, "");
  return digits.length >= 4 ? "***" + digits.slice(-4) : "el numero";
}

/* ---------------------------------------------------------------------------
 * 1. La declaracion adjuntada como año anterior no es del año anterior.
 *
 * Los treinta y cuatro cruces interanuales que corren despues de este dan por sentado que la
 * distancia entre las dos declaraciones es de un año. No lo verificaba nadie. Si son del
 * mismo año, cada continuidad cierra perfecto contra si misma y el informe dice que todo ata.
 * ------------------------------------------------------------------------- */
function checkPriorReturnYearGap(current, prior) {
  if (!current || !prior) return null;
  const currentYear = returnYear(current);
  const priorYear = returnYear(prior);
  if (currentYear === null || priorYear === null) return null;
  const gap = currentYear - priorYear;
  if (gap === 1) return null;

  const same = gap === 0;
  const detail = same
    ? `Las dos declaraciones del paquete son del mismo año fiscal (${currentYear}). Cada cruce interanual de esta revision comparo el año contra si mismo, de modo que toda continuidad de balance, de capital y de arrastres dio por atada una comparacion que nunca se hizo.`
    : `La declaracion corriente es ${currentYear} y la adjuntada como año anterior es ${priorYear}: ${Math.abs(gap)} años de distancia${gap < 0 ? ", y en orden invertido" : ""}. Los cruces interanuales de esta revision compararon saldos que no son consecutivos.`;
  return {
    severity: "HIGH",
    category: "Package integrity",
    title: same
      ? "Ambas declaraciones del paquete son del mismo año"
      : "La declaracion del año anterior no es la del año inmediato anterior",
    detail,
    action: "Reemplazar el archivo del año anterior por la declaracion presentada del año inmediato anterior y volver a correr la revision. Hasta entonces ningun resultado de continuidad de este informe esta verificado, incluidos los que figuran como correctos.",
    authority: "Verificacion de integridad del paquete — precondicion de los cruces interanuales de esta aplicacion",
  };
}

/* ---------------------------------------------------------------------------
 * 2. Las dos declaraciones son de contribuyentes distintos.
 *
 * Mismo problema que arriba y misma consecuencia, por otra via: el archivo correcto del año
 * equivocado se detecta con el año; el archivo de otro cliente, no. Un digito transpuesto en
 * el numero de identificacion tambien cae aca, y ese rechaza el e-file.
 * ------------------------------------------------------------------------- */
function checkIdentifyingNumberMatches(current, prior) {
  if (!current || !prior) return null;
  const currentId = dominantIdentifier(textOf(current));
  const priorId = dominantIdentifier(textOf(prior));
  if (!currentId || !priorId) return null;
  if (currentId.value === priorId.value) return null;

  return {
    severity: "HIGH",
    category: "Package integrity",
    title: "Las dos declaraciones del paquete tienen numeros de identificacion distintos",
    detail: `El numero de identificacion que encabeza la declaracion corriente termina en ${masked(currentId.value)} y aparece ${currentId.count} veces; el de la declaracion del año anterior termina en ${masked(priorId.value)} y aparece ${priorId.count} veces. O una de las dos es de otro contribuyente, o uno de los dos numeros esta mal cargado.`,
    action: "Confirmar cual de los dos numeros es el correcto contra la carta de compromiso o la constancia del IRS. Si el que esta mal es el de la declaracion corriente, el e-file se rechaza; si el archivo del año anterior es de otro cliente, todos los cruces interanuales de este informe son invalidos y hay que volver a correr la revision.",
    authority: "Verificacion de integridad del paquete — precondicion de los cruces interanuales de esta aplicacion",
  };
}

/* ---------------------------------------------------------------------------
 * 3. El año elegido en la aplicacion no es el año de la declaracion.
 *
 * El desplegable de año no es cosmetico: rotula el informe y decide cual archivo se toma como
 * corriente cuando vienen sin rol asignado. Un desajuste no rompe nada de golpe, pero deja el
 * informe con un año que la declaracion no dice.
 * ------------------------------------------------------------------------- */
function checkStatedYearMatchesReturn(current, meta) {
  if (!current) return null;
  const match = String((meta && meta.taxYear) || "").match(/\d{4}/);
  const stated = match ? Number(match[0]) : NaN;
  if (!Number.isFinite(stated) || stated <= 2000) return null;
  const actual = returnYear(current);
  if (actual === null || actual === stated) return null;

  return {
    severity: "MEDIUM",
    category: "Package integrity",
    title: "El año fiscal seleccionado no coincide con el de la declaracion",
    detail: `La revision se corrio para el año ${stated} y la declaracion cargada como corriente es de ${actual}.`,
    action: `Corregir el año en la aplicacion o cargar la declaracion de ${stated}. El año seleccionado rotula el informe y decide cual de los archivos se toma como corriente cuando vienen sin rol asignado.`,
    authority: "Verificacion de integridad del paquete",
  };
}

/**
 * Corre las verificaciones de identidad del paquete. Silencioso por diseño: sin dos
 * declaraciones legibles no hay nada que comparar y no devuelve nada.
 */
function runIdentityChecks(files, meta = {}) {
  const split = splitReturns(files, meta);
  return [
    checkStatedYearMatchesReturn(split.current, meta),
    checkPriorReturnYearGap(split.current, split.prior),
    checkIdentifyingNumberMatches(split.current, split.prior),
  ].filter(Boolean);
}

module.exports = {
  runIdentityChecks,
  checkPriorReturnYearGap,
  checkIdentifyingNumberMatches,
  checkStatedYearMatchesReturn,
  dominantIdentifier,
  masked,
};
