"use strict";

/**
 * identity-inventory.js — los SSN y EIN de todo el paquete, cruzados por codigo.
 *
 * Por que existe: la tabla de datos informativos la armaba el modelo con lo que alcanzaba a
 * mirar. En una declaracion de 264 paginas comparo doce datos, casi todos del encabezado, y el
 * resto del paquete (W-2, 1099, 5498, K-1) quedaba sin cruzar. Un SSN o un EIN no necesita un
 * modelo: se encuentra con un patron y se compara. Este modulo cruza:
 *
 *  1. Las personas de la declaracion: cada SSN de la declaracion corriente contra los del año
 *     anterior. Uno que esta a un digito de otro conocido es casi seguro un error de tipeo; uno
 *     que estaba el año pasado y desaparecio es un conyuge o dependiente que falta.
 *  2. Los documentos: el SSN que trae cada documento tiene que ser de alguien de la
 *     declaracion, y el apellido con que la declaracion imprime a esa persona tiene que
 *     aparecer en el documento.
 *  3. Los K-1: algun EIN del K-1 tiene que figurar en la declaracion. Si ninguno figura, el
 *     ingreso de ese K-1 puede no estar en el Schedule E.
 *
 * Fail-closed, como el resto del directorio: lo que no se afirma con un patron no produce fila.
 * Un SSN nuevo que no se parece a ninguno conocido (un dependiente nuevo, el de un tercero) se
 * cuenta como "nuevo, sin comparar", no como un error.
 */

const { splitReturns } = require("./prior-year-bridge");
const { dominantIdentifier, masked } = require("./identity-consistency");

const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
/** SSN enmascarado como lo imprimen los 1099 y los 5498: XXX-XX-1234 o ***-**-1234. */
const MASKED_SSN = /(?:\*{3}|X{3}|x{3})[- ]?(?:\*{2}|X{2}|x{2})[- ]?(\d{4})\b/g;
const EIN = /\b\d{2}-\d{7}\b/g;
const K1_DOCUMENT = /Schedule K-1/i;
const K1_SHARE = /(?:Partner|Shareholder|Beneficiary)['’]?s\s+Share/i;
/**
 * Veces que tiene que aparecer un SSN en la declaracion del año anterior para ser de una
 * persona de esa declaracion (titular, conyuge, dependiente) y no de un tercero nombrado una
 * sola vez.
 */
const PERSON_MIN_COUNT = 2;
/** Tope de filas con diferencias: una avalancha de filas esconde la que importa. */
const MAX_ROWS = 10;
const SOURCE = "Computed by RAG Tax AI from the documents in the package";

function textOf(file) {
  return String((file && (file.originalText || file.fullText || file.text || file.extractedText)) || "");
}

function docName(file) {
  return String((file && (file.name || file.fileName)) || "document").split(/[\\/]/).pop();
}

function tally(text, pattern) {
  const counts = new Map();
  for (const hit of String(text || "").matchAll(pattern)) counts.set(hit[0], (counts.get(hit[0]) || 0) + 1);
  return counts;
}

/** Dos numeros que difieren en un solo digito, o en dos digitos vecinos intercambiados. */
function oneSlipApart(a, b) {
  const x = String(a).replace(/\D/g, "");
  const y = String(b).replace(/\D/g, "");
  if (x.length !== y.length || x === y) return false;
  const diff = [];
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) diff.push(i);
  if (diff.length === 1) return true;
  return diff.length === 2 && diff[1] === diff[0] + 1 && x[diff[0]] === y[diff[1]] && x[diff[1]] === y[diff[0]];
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NOT_A_NAME = /^(and|of|the|son|daughter|spouse|ssn|tin|form|page|your|name|first|last)$/i;

/**
 * El nombre con que la declaracion imprime a una persona: lo que mas se repite pegado delante
 * de su SSN, en dos lineas o mas. Devuelve el primer nombre y el apellido, o null si no se
 * puede decir. ("JOHN Q AND JANE R SAMPLE 000-00-0000" da JOHN y SAMPLE.)
 */
function nameFor(text, ssn) {
  const pattern = new RegExp("^(.{3,80}?)\\s+" + escapeRegex(ssn) + "\\b", "gm");
  const counts = new Map();
  for (const hit of String(text || "").matchAll(pattern)) {
    const words = hit[1].replace(/[^A-Za-z&' -]/g, " ").trim().split(/\s+/)
      .filter((w) => /^[A-Za-z][A-Za-z'-]+$/.test(w) && !NOT_A_NAME.test(w));
    if (words.length < 2) continue;
    const key = `${words[0].toUpperCase()} ${words[words.length - 1].toUpperCase()}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (!counts.size) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] < 2) return null;
  const [first, last] = ranked[0][0].split(" ");
  return { first, last };
}

/** La linea donde aparece algo, con los numeros de identificacion enmascarados. */
function maskedLine(text, test) {
  const line = String(text || "").split(/\r?\n/).find((l) => test(l)) || "";
  return line.replace(SSN, (s) => masked(s)).replace(EIN, (e) => masked(e)).replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Las filas que el codigo agrega a infoConsistency: una por diferencia encontrada (a lo sumo
 * diez) y una fila de alcance final con la cantidad exacta de cruces que dieron bien.
 */
function identityInventoryRows(files, meta = {}) {
  const list = Array.isArray(files) ? files : [];
  const { current, prior } = splitReturns(list, meta);
  if (!current) return [];
  const currentText = textOf(current);
  const priorText = prior ? textOf(prior) : "";
  const currentSsns = tally(currentText, SSN);
  const priorSsns = tally(priorText, SSN);
  const currentEins = new Set(tally(currentText, EIN).keys());
  const timesSeen = (ssn) => (currentSsns.get(ssn) || 0) + (priorSsns.get(ssn) || 0);
  const priorName = (prior && prior.name) || "prior_return";

  const rows = [];
  const verified = { people: 0, documents: 0, names: 0, k1: 0 };
  const newThisYear = [];

  // 1. Las personas de la declaracion, contra las del año anterior.
  if (prior) {
    for (const [ssn, count] of currentSsns) {
      if (priorSsns.has(ssn)) { verified.people += 1; continue; }
      const near = [...currentSsns.keys(), ...priorSsns.keys()].find((other) => other !== ssn && oneSlipApart(ssn, other) && timesSeen(other) > count);
      if (near) {
        rows.push({
          item: `SSN ${masked(ssn)} on the return`,
          returnValue: masked(ssn),
          sourceValue: masked(near),
          source: priorName,
          status: "MISMATCH",
          note: `Printed ${count} time(s) and one digit away from ${masked(near)}, which appears ${timesSeen(near)} times in the returns — almost certainly a typo. A wrong SSN rejects the e-file or the credit it supports.`,
        });
      } else {
        newThisYear.push(masked(ssn));
      }
    }
    for (const [ssn, count] of priorSsns) {
      if (count < PERSON_MIN_COUNT || currentSsns.has(ssn)) continue;
      if ([...currentSsns.keys()].some((other) => oneSlipApart(other, ssn))) continue;
      rows.push({
        item: `SSN ${masked(ssn)} from the prior-year return`,
        returnValue: "Not on this return",
        sourceValue: masked(ssn),
        source: priorName,
        status: "MISMATCH",
        note: `Printed ${count} times on the prior-year return and absent from this one: a spouse or dependent who is no longer on the return. Confirm it is intended.`,
      });
    }
  }

  // 2 y 3. Los documentos del paquete: su SSN, el apellido y, si son K-1, su EIN.
  const returnFiles = new Set([current, prior].filter(Boolean));
  const byLast4 = new Map();
  for (const ssn of currentSsns.keys()) {
    const last4 = ssn.slice(-4);
    byLast4.set(last4, byLast4.has(last4) ? null : ssn); // dos SSN con los mismos cuatro: no se usa
  }
  const names = new Map();
  const nameOf = (ssn) => {
    if (!names.has(ssn)) names.set(ssn, nameFor(currentText, ssn));
    return names.get(ssn);
  };
  const taxpayer = dominantIdentifier(currentText);

  for (const file of list) {
    if (!file || returnFiles.has(file)) continue;
    const text = textOf(file);
    if (!text.trim()) continue;
    const name = docName(file);

    const people = new Set();
    for (const ssn of tally(text, SSN).keys()) {
      if (currentSsns.has(ssn)) { people.add(ssn); continue; }
      const near = [...currentSsns.keys()].find((other) => oneSlipApart(other, ssn));
      if (near) {
        rows.push({
          item: `SSN on ${name}`,
          returnValue: masked(near),
          sourceValue: masked(ssn),
          source: name,
          status: "MISMATCH",
          note: `The document shows ${masked(ssn)} where the return has ${masked(near)} — one digit apart. Either the document or the return is wrong.`,
        });
      }
    }
    for (const hit of text.matchAll(MASKED_SSN)) {
      const ssn = byLast4.get(hit[1]);
      if (ssn) people.add(ssn);
    }
    const isK1 = K1_DOCUMENT.test(text) && K1_SHARE.test(text);
    if (people.size) {
      verified.documents += 1;
      // El nombre no se exige en un K-1: los que recibe un grantor trust salen a nombre del
      // trust con el SSN del titular, y eso es correcto. Los K-1 se cruzan por EIN, abajo.
      for (const ssn of isK1 ? [] : people) {
        const person = nameOf(ssn);
        if (!person) continue;
        if (new RegExp("\\b" + escapeRegex(person.last) + "\\b", "i").test(text)) { verified.names += 1; continue; }
        const firstNameRe = new RegExp("\\b" + escapeRegex(person.first) + "\\b", "i");
        rows.push({
          item: `Name on ${name}`,
          returnValue: person.last,
          sourceValue: maskedLine(text, (l) => firstNameRe.test(l)) || `No "${person.last}" in the document`,
          source: name,
          status: "MISMATCH",
          note: `The document carries the SSN ending ${ssn.slice(-4)} but not the name ${person.last} that the return prints for it. A different name on an information return (a maiden name, a typo) has to agree with what the IRS holds for that SSN.`,
        });
      }
    }

    if (isK1) {
      const eins = [...tally(text, EIN).keys()].filter((ein) => !taxpayer || ein !== taxpayer.value);
      if (!eins.length) continue;
      if (eins.some((ein) => currentEins.has(ein))) { verified.k1 += 1; continue; }
      rows.push({
        item: `K-1 ${name}`,
        returnValue: "Not on the return",
        sourceValue: eins.slice(0, 3).map(masked).join(", "),
        source: name,
        status: "MISMATCH",
        note: "None of the EINs on this K-1 appears anywhere on the return. If the K-1 belongs to this taxpayer, its income may be missing from Schedule E.",
      });
    }
  }

  const shown = rows.slice(0, MAX_ROWS);
  if (rows.length > MAX_ROWS) {
    const last = shown[shown.length - 1];
    last.note = `${last.note} (${rows.length - MAX_ROWS} more difference(s) of the same kinds not listed.)`;
  }
  const total = verified.people + verified.documents + verified.names + verified.k1;
  if (total > 0) {
    shown.push({
      item: "Identifiers verified by code",
      returnValue: "",
      sourceValue: "",
      source: SOURCE,
      status: "MATCH",
      note: `${total} — SSNs matching the prior-year return: ${verified.people}; documents whose SSN is on the return: ${verified.documents}; documents carrying the name the return prints: ${verified.names}; K-1s whose EIN is on the return: ${verified.k1}.${newThisYear.length ? ` New this year, not compared: ${newThisYear.join(", ")}.` : ""}`,
    });
  }
  return shown;
}

module.exports = { identityInventoryRows, oneSlipApart, nameFor, MAX_ROWS };
