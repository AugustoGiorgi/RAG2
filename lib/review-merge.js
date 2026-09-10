"use strict";

/**
 * review-merge.js — unir dos corridas del mismo paquete en un solo informe.
 *
 * Por que existe, medido y no supuesto. Cinco corridas del MISMO paquete JJ&CJ, con el mismo
 * modelo y el mismo prompt, dieron 11, 7, 9, 8 y 4 hallazgos del modelo. La union de las cinco
 * son 28. O sea que **una sola corrida entrega el 28% de lo que el modelo es capaz de encontrar
 * en ese paquete**: no es que no lo vea, es que ve otra cosa cada vez.
 *
 *   corridas   union acumulada
 *      1             11
 *      2             16
 *      3             19
 *      5             28
 *
 * Dos corridas llevan la cobertura de ~28% a ~57%. Y la segunda es barata: pega en el cache de
 * prompt, que cobra la entrada al 10% — con pasadas de dos minutos, la segunda arranca dentro
 * de la ventana de cinco minutos, asi que alcanza el TTL corto y su recargo de escritura chico.
 *
 * Lo dificil no es correr dos veces sino unir sin duplicar. Un hallazgo repetido en las dos
 * corridas tiene que salir UNA vez, y dos hallazgos parecidos sobre cosas distintas tienen que
 * salir los dos. El criterio es el mismo que ya usa el plegado de duplicados contra los cruces
 * deterministas: las cifras materiales compartidas. Dos hallazgos que nombran las mismas dos
 * cifras de mas de mil dolares son el mismo hallazgo, aunque esten redactados distinto.
 */

/** Un importe de mas de mil dolares es una cifra material; menos es ruido de redondeo. */
const MATERIAL_FLOOR = 1000;
const AMOUNT_IN_TEXT = /\$?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\$\d+(?:\.\d{2})?/g;
/** Cuantas cifras compartidas hacen que dos hallazgos sean el mismo. */
const SHARED_FIGURES_FOR_SAME = 2;

const SEVERITY_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };

function materialFigures(text) {
  const out = new Set();
  for (const match of String(text || "").matchAll(AMOUNT_IN_TEXT)) {
    const value = Math.abs(Number(match[0].replace(/[$,\s]/g, "")));
    if (Number.isFinite(value) && value >= MATERIAL_FLOOR) out.add(value);
  }
  return out;
}

function issueText(issue) {
  return `${issue?.formOrSchedule || ""} ${issue?.issueDescription || ""} ${issue?.evidence || ""}`;
}

/** Palabras que no distinguen un tema de otro: estan en casi todos los encabezados. */
const SUBJECT_NOISE = /^(?:form|forms|schedule|schedules|line|lines|part|page|and|the|of|el|la)$/;

/**
 * El tema del hallazgo, normalizado para poder compararlo entre redacciones distintas.
 *
 * Sin orden: dos corridas escriben "Form 1065 Schedule L" o "Schedule L (Form 1065)"
 * indistintamente y son el mismo tema. Ordenar los tokens es lo que hace que se reconozcan.
 * Que la clave coincida solo habilita el camino indulgente —un tema igual mas UNA cifra
 * compartida basta—, asi que un empate de mas es barato y un empate de menos cuesta cobertura.
 */
function subjectKey(issue) {
  return String(issue?.formOrSchedule || issue?.areaReviewed || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !SUBJECT_NOISE.test(token))
    .sort()
    .join("")
    .slice(0, 18);
}

/**
 * Si dos hallazgos son el mismo.
 *
 * Dos cifras materiales compartidas alcanzan por si solas — una sola pasa seguido entre
 * hallazgos distintos sobre la misma declaracion, porque el ingreso ordinario aparece en media
 * docena de lugares. Con el mismo tema alcanza una cifra, porque el tema ya acota.
 */
function sameIssue(a, b) {
  const figuresA = materialFigures(issueText(a));
  const figuresB = materialFigures(issueText(b));
  let shared = 0;
  for (const value of figuresA) if (figuresB.has(value)) shared += 1;
  const keyA = subjectKey(a);
  const keyB = subjectKey(b);
  if (keyA && keyA === keyB) return shared >= 1 || (!figuresA.size && !figuresB.size);
  return shared >= SHARED_FIGURES_FOR_SAME;
}

/** De dos versiones del mismo hallazgo se conserva la mas severa, y a igual severidad la mas larga. */
function betterOf(a, b) {
  const rankA = SEVERITY_RANK[String(a?.priority || "").toUpperCase()] || 0;
  const rankB = SEVERITY_RANK[String(b?.priority || "").toUpperCase()] || 0;
  if (rankA !== rankB) return rankA > rankB ? a : b;
  return issueText(a).length >= issueText(b).length ? a : b;
}

/**
 * Une las listas de hallazgos de varias corridas.
 * Devuelve { issues, merged } — `merged` es cuantos se reconocieron como repetidos.
 */
function mergeIssues(lists) {
  const out = [];
  let merged = 0;
  for (const list of Array.isArray(lists) ? lists : []) {
    for (const issue of Array.isArray(list) ? list : []) {
      if (!issue || typeof issue !== "object") continue;
      const index = out.findIndex((existing) => sameIssue(existing, issue));
      if (index === -1) { out.push(issue); continue; }
      merged += 1;
      out[index] = betterOf(out[index], issue);
    }
  }
  return { issues: out, merged };
}

/** Une filas de tabla (casillas, identificadores, tie-out) por una clave de identidad. */
/**
 * Desde cuantos caracteres una clave contenida en otra es la misma fila.
 *
 * Ocho. Quitar numeros y palabras de ubicacion no alcanzo: la misma casilla salio como
 * "Schedule B Part III Line 7a Foreign account question" y "Schedule B Part III Line 7a -
 * Foreign account", y una sobra un "question" respecto de la otra. Comparar por contencion
 * resuelve esa familia entera sin ir agregando palabras de relleno a mano. El minimo evita que
 * dos claves cortas se fundan por casualidad.
 */
const CONTAINED_KEY_MIN = 8;

function mergeRows(lists, keyOf) {
  const seen = new Map();
  for (const list of Array.isArray(lists) ? lists : []) {
    for (const row of Array.isArray(list) ? list : []) {
      if (!row || typeof row !== "object") continue;
      const key = keyOf(row);
      if (!key) continue;
      const twin = [...seen.keys()].find((existing) => (
        existing === key
        || (existing.length >= CONTAINED_KEY_MIN && key.length >= CONTAINED_KEY_MIN
          && (existing.includes(key) || key.includes(existing)))
      ));
      // La primera version gana: la segunda corrida no tiene mas autoridad que la primera,
      // y alternar entre las dos haria que el informe cambie por donde no debe.
      if (!twin) seen.set(key, row);
    }
  }
  return [...seen.values()];
}

function mergeStrings(lists) {
  const seen = new Map();
  for (const list of Array.isArray(lists) ? lists : []) {
    for (const value of Array.isArray(list) ? list : []) {
      const text = String(value || "").trim();
      if (!text) continue;
      const key = text.toLowerCase().slice(0, 80);
      if (!seen.has(key)) seen.set(key, text);
    }
  }
  return [...seen.values()];
}

/**
 * Palabras de ubicacion que no distinguen una casilla de otra: las dos pasadas nombran la misma
 * casilla con o sin ellas y quedaban como dos filas.
 */
const ROW_NOISE = /\b(?:page|pagina|part|parte|line|linea|item|section|seccion|form|schedule|no|nro|number)\b|\d+/g;

/**
 * La identidad de una fila de tabla, para reconocerla entre las dos pasadas.
 *
 * Sin numeros ni palabras de ubicacion, porque en el informe de un 1040 real la misma casilla
 * salio dos veces escrita "Form 1040 Digital Assets question" y "Form 1040 Page 1 - Digital
 * Assets question", y lo mismo con la 7a del Schedule B y la del Schedule D. Lo que queda —
 * "digitalassets", "foreignaccount", "qualifiedopportunityfunddisposition" — si identifica la
 * fila, y es lo bastante especifico para no fundir dos casillas distintas.
 */
const norm = (value) => String(value || "")
  .toLowerCase()
  .replace(ROW_NOISE, " ")
  .replace(/[^a-z]/g, "")
  .slice(0, 40);

/** La fila de alcance va al final de su tabla, no en el medio. */
const SCOPE_ROW = /verified as correct|verified as matching|boxes verified|identifiers verified/i;

function scopeLast(rows, labelOf) {
  const list = Array.isArray(rows) ? rows : [];
  const scope = list.filter((row) => SCOPE_ROW.test(String(labelOf(row) || "")));
  const rest = list.filter((row) => !SCOPE_ROW.test(String(labelOf(row) || "")));
  return [...rest, ...scope];
}

/**
 * Une varias revisiones del mismo paquete en una.
 *
 * La primera revision manda en todo lo que es prosa — resumen, conclusion, estado de
 * presentacion — porque mezclar dos redacciones produce un texto que no escribio nadie. Lo que
 * se une son las LISTAS, que es donde esta la cobertura que se gana corriendo dos veces.
 */
function mergeReviews(reviews) {
  const list = (Array.isArray(reviews) ? reviews : []).filter((r) => r && typeof r === "object");
  if (!list.length) return { review: null, merged: 0, passes: 0 };
  if (list.length === 1) return { review: list[0], merged: 0, passes: 1 };

  const base = list[0];
  const { issues, merged } = mergeIssues(list.map((r) => r.issues));
  return {
    review: {
      ...base,
      issues,
      checkboxReview: scopeLast(mergeRows(list.map((r) => r.checkboxReview), (row) => norm(row.box)), (row) => row.box),
      infoConsistency: scopeLast(mergeRows(list.map((r) => r.infoConsistency), (row) => norm(row.item)), (row) => row.item),
      tieOutResults: mergeRows(list.map((r) => r.tieOutResults), (row) => norm(row.lineItem)),
      openQuestions: mergeStrings(list.map((r) => r.openQuestions)),
      missingDocuments: mergeStrings(list.map((r) => r.missingDocuments)),
      verifiedItems: mergeStrings(list.map((r) => r.verifiedItems)),
    },
    merged,
    passes: list.length,
  };
}

module.exports = {
  mergeReviews, mergeIssues, mergeRows, mergeStrings, sameIssue, betterOf,
  materialFigures, subjectKey, MATERIAL_FLOOR, SHARED_FIGURES_FOR_SAME,
};
