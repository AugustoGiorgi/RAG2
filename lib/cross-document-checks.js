"use strict";

/**
 * cross-document-checks.js — cruces que necesitan dos documentos a la vez.
 *
 * Por que existe. Medido contra revisiones manuales de declaraciones reales, lo que la app
 * pierde no es un calculo dentro de un formulario: es lo que solo aparece al poner un papel
 * al lado de otro. Una liquidacion de venta en el paquete y ningun Form 4797 en la
 * declaracion. Una propiedad alquilada todo el año que dejo de depreciarse. Un saldo a pagar
 * que se paga cinco meses tarde sin que nadie mencione el recargo. Un K-1 que la declaracion
 * usa y que no esta en el paquete, o que esta pero es una estimacion. El modelo encuentra
 * algunos de estos en algunas corridas; estos cruces los encuentran siempre o nunca.
 *
 * Como el resto de los modulos deterministas, todo falla CERRADO: si un formulario no se deja
 * leer, no hay hallazgo, nunca uno adivinado. Y cada hallazgo se redacta para que una persona
 * lo confirme contra el formulario, no como una conclusion cerrada.
 */

const { splitReturns, parseMoney } = require("./prior-year-bridge");

/* ---------------------------------------------------------------------------
 * Lectura comun
 * ------------------------------------------------------------------------- */

const textOf = (f) => String((f && (f.originalText || f.fullText || f.text || f.extractedText)) || "");
const linesOf = (text) => String(text || "").split(/\r?\n/);
const fmt = (n) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dateText = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

// Importes con separador de miles o con decimales; el punto final es tipografia del formulario.
const MONEY = /-?\$?\(?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\)?\.?/g;

/** Los importes de un tramo de texto, sin años ni numeros de renglon sueltos. */
function amountsIn(text) {
  const out = [];
  for (const m of String(text || "").matchAll(MONEY)) {
    const raw = m[0].replace(/\.$/, "");
    if (/^(19|20)\d{2}$/.test(raw)) continue;
    const n = parseMoney(raw);
    if (n !== null) out.push(n);
  }
  return out;
}

/** Lo que sigue al rotulo de un renglon, sin la guia de puntos ni el numero de renglon repetido. */
function valuesAfterLabel(line, label, lineNo) {
  const at = line.search(label);
  if (at < 0) return [];
  let rest = line.slice(at).replace(label, "").replace(/(?:\s*\.){2,}/g, " ");
  if (lineNo) rest = rest.replace(new RegExp(`^\\s*${lineNo}\\b`), "");
  return amountsIn(rest);
}

/**
 * Cada documento del paquete que no es una declaracion, con su nombre. Un ZIP llega como un
 * solo archivo con secciones "--- ZIP ENTRY: nombre ---", y cada seccion es un documento.
 */
function packageEntries(files, exclude = new Set()) {
  const out = [];
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || exclude.has(f)) continue;
    const text = textOf(f);
    if (!text.trim()) continue;
    if (/(^|\n)--- ZIP ENTRY: /.test(text)) {
      for (const part of text.split(/\n(?=--- ZIP ENTRY: )/)) {
        const m = /^--- ZIP ENTRY: (.+?) ---/.exec(part);
        if (m) out.push({ name: m[1].split("/").pop(), text: part.slice(m[0].length), file: f });
      }
    } else {
      out.push({ name: String(f.name || ""), text, file: f });
    }
  }
  return out;
}

function roleOf(f) {
  return String((f && (f.reviewRole || f.role)) || "").toLowerCase();
}

function isIndividualReturn(text) {
  return /U\.S\. Individual Income Tax Return|\bForm 1040\b/i.test(String(text || "").slice(0, 400000));
}

function isPartnershipReturn(text) {
  return /U\.S\. Return of Partnership Income/i.test(String(text || "").slice(0, 400000));
}

/** Lo que la declaracion trae como formularios de venta. Si hay uno, no se afirma que falte. */
function hasDispositionForms(text) {
  return /Sales of Business Property/i.test(text) || /Sales and Other Dispositions of Capital Assets/i.test(text);
}

/* ---------------------------------------------------------------------------
 * Schedule E, Part I
 * ------------------------------------------------------------------------- */

/** "100 Maple Rd, ..." -> "100 maple": numero y primera palabra de la calle. */
function streetKey(address) {
  const m = /^\s*(\d{1,6})\s+([A-Za-z][A-Za-z'-]*)(?:\s+([A-Za-z0-9][A-Za-z0-9'-]*))?/.exec(String(address || ""));
  if (!m) return "";
  // "120 N 5th St": un punto cardinal solo no distingue una calle de otra; va con la siguiente.
  const first = m[2].toLowerCase();
  const cardinal = /^(?:n|s|e|w|ne|nw|se|sw|north|south|east|west)$/.test(first);
  return cardinal && m[3] ? `${m[1]} ${first} ${m[3].toLowerCase()}` : `${m[1]} ${first}`;
}

/**
 * Las propiedades de la Parte I del Schedule E: direccion, dias de alquiler, depreciacion.
 *
 * Los programas no imprimen igual. Uno pone "A 1 ... A 365" y otro "A 1 ... 366 0"; los dos
 * empiezan con la letra de la columna y el codigo de tipo, y el primer numero que sigue son
 * los dias de alquiler a valor de mercado. La depreciacion va en el renglon 18 con un importe
 * por columna, pero una columna vacia no deja rastro en el texto: si hay menos importes que
 * propiedades no se sabe de cual es cada uno, y entonces solo se usa el total del 23d.
 */
function scheduleEProperties(text) {
  const lines = linesOf(text);
  const start = lines.findIndex((l) => /^\s*1a\s+Physical address of each property/i.test(l));
  if (start < 0) return null;
  const props = [];
  let i = start + 1;
  for (; i < Math.min(lines.length, start + 12); i += 1) {
    const line = lines[i];
    if (/^\s*1b\b|Type of Property/i.test(line)) break;
    const m = /^\s*([A-C])\s+(\d{1,6}\s+\S.*)$/.exec(line);
    if (m && streetKey(m[2])) props.push({ letter: m[1], address: m[2].trim(), key: streetKey(m[2]), fairDays: null });
  }
  if (!props.length) return null;

  // Dias de alquiler: entre "1b Type of Property" y la leyenda "Type of Property:".
  for (let j = i; j < Math.min(lines.length, i + 16); j += 1) {
    const line = lines[j];
    if (/^\s*Type of Property\s*:/i.test(line)) break;
    const m = /^\s*([A-C])\s+([1-8])\b(.*)$/.exec(line);
    if (!m) continue;
    const prop = props.find((p) => p.letter === m[1]);
    if (!prop || prop.fairDays !== null) continue;
    const days = (m[3].match(/\b\d{1,3}\b/g) || []).map(Number).filter((n) => n <= 366);
    if (days.length) prop.fairDays = days[0];
  }

  // Depreciacion por propiedad (solo si hay un importe por propiedad) y el total del 23d.
  const block = lines.slice(start, start + 90);
  const deprLine = block.find((l) => /^\s*18\s+Depreciation expense or depletion/i.test(l));
  const values = deprLine ? valuesAfterLabel(deprLine, /18\s+Depreciation expense or depletion/i, "18") : [];
  if (values.length === props.length) props.forEach((p, k) => { p.depreciation = values[k]; });
  const totalLine = block.find((l) => /Total of all amounts reported on line 18 for all properties/i.test(l));
  const totalValues = totalLine ? valuesAfterLabel(totalLine, /Total of all amounts reported on line 18 for all properties/i, "23d") : [];
  let totalDepreciation = totalValues.length ? totalValues[totalValues.length - 1] : null;
  if (totalDepreciation === null && deprLine) totalDepreciation = values.length ? values.reduce((a, b) => a + b, 0) : 0;
  return { properties: props, totalDepreciation, depreciationByProperty: values.length === props.length };
}

/* ---------------------------------------------------------------------------
 * 1. Venta de una propiedad alquilada sin Form 4797
 * ------------------------------------------------------------------------- */

const SETTLEMENT = /settlement statement|closing disclosure|closing statement|\bHUD-1\b|seller'?s statement/i;
const SELLER_STOP = new Set(["TRUST", "TRUSTEE", "LLC", "INC", "CORP", "COMPANY", "PROPERTY", "PROPERTIES", "HOLDINGS", "DELAWARE", "STATUTORY", "LIMITED", "PARTNERSHIP", "ESTATE", "HOMES", "GROUP", "FUND", "THE", "AND", "SELLER", "SELLERS"]);

function parseDate(raw) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(String(raw || ""));
  if (!m) return null;
  const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  const d = new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Lo que dice una liquidacion: que se vendio, quien vendio, cuando y por cuanto. */
function readSettlement(entry) {
  const text = entry.text;
  if (!SETTLEMENT.test(text.slice(0, 4000)) || !/\bSeller\b/i.test(text)) return null;
  const address = /Property(?:\s+Address|\s+Location)?\s*:\s*(\d{1,6}\s+[^\n]+)/i.exec(text);
  const seller = /\bSellers?(?:\(s\))?\s*:\s*([^\n]+)/i.exec(text);
  const date = /(?:Settlement|Closing|Sale)\s+Date\s*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(text);
  const priceLine = linesOf(text).find((l) => /contract sales? price|sales? price of (?:the )?property|gross amount due to seller/i.test(l));
  const prices = priceLine ? amountsIn(priceLine).filter((n) => n >= 1000) : [];
  if (!address || !seller || !date) return null;
  const when = parseDate(date[1]);
  if (!when || !streetKey(address[1])) return null;
  return {
    name: entry.name,
    address: address[1].trim().replace(/\s+/g, " "),
    key: streetKey(address[1]),
    seller: seller[1].trim(),
    date: when,
    price: prices.length ? Math.max(...prices) : null,
  };
}

/** Las palabras de los nombres que la declaracion imprime como contribuyente. */
function taxpayerNameWords(text) {
  const lines = linesOf(text);
  const words = new Set();
  lines.forEach((line, i) => {
    if (!/Name\(s\) shown on (?:the )?return/i.test(line)) return;
    const next = lines.slice(i + 1, i + 3).find((l) => /[A-Za-z]{3}/.test(l)) || "";
    for (const w of next.toUpperCase().match(/[A-Z][A-Z'-]{3,}/g) || []) words.add(w);
  });
  return words;
}

/** El arrastre de perdidas suspendidas que el 8582 le deja a una actividad. */
function suspendedLossFor(text, key) {
  const lines = linesOf(text);
  const start = lines.findIndex((l) => /Part VII\s+Allocation of Unallowed Losses/i.test(l));
  if (start < 0) return null;
  for (let i = start + 1; i < Math.min(lines.length, start + 40); i += 1) {
    const line = lines[i];
    if (/^\s*Total\b/i.test(line)) break;
    if (streetKey(line) === key || line.toLowerCase().includes(key)) {
      const values = amountsIn(line.replace(/^\s*\d{1,6}\s+/, ""));
      return values.length ? values[values.length - 1] : null;
    }
  }
  return null;
}

function dayOfYear(d) {
  return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

function checkRentalSaleNotReported(files, meta = {}) {
  const { current, prior } = splitReturns(files, meta);
  if (!current) return [];
  const text = textOf(current);
  if (!isIndividualReturn(text) || hasDispositionForms(text)) return [];
  const taxYear = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]) || null;
  const names = taxpayerNameWords(text);
  if (!names.size) return [];
  const currentE = scheduleEProperties(text);
  const priorE = prior ? scheduleEProperties(textOf(prior)) : null;
  const onScheduleE = (key) => (currentE && currentE.properties.find((p) => p.key === key))
    || (priorE && priorE.properties.find((p) => p.key === key)) || null;

  const findings = [];
  const seen = new Set();
  for (const entry of packageEntries(files, new Set([current, prior]))) {
    const sale = readSettlement(entry);
    if (!sale || seen.has(sale.key)) continue;
    if (taxYear && sale.date.getUTCFullYear() !== taxYear) continue;
    const sellerWords = (sale.seller.toUpperCase().match(/[A-Z][A-Z'-]{3,}/g) || []).filter((w) => !SELLER_STOP.has(w));
    if (!sellerWords.some((w) => names.has(w))) continue;
    const property = onScheduleE(sale.key);
    if (!property) continue;
    seen.add(sale.key);

    const currentProp = currentE && currentE.properties.find((p) => p.key === sale.key);
    const suspended = suspendedLossFor(text, sale.key);
    const parts = [
      `A settlement statement in the package (${sale.name}) shows the taxpayer selling ${sale.address} on ${dateText(sale.date)}${sale.price ? ` for a contract price of ${fmt(sale.price)}` : ""}.`,
      currentProp
        ? `The property is on this year's Schedule E as a rental${currentProp.fairDays !== null ? ` (${currentProp.fairDays} fair rental days)` : ""}`
        : "The property was on last year's Schedule E as a rental",
      "but the return has no Form 4797 or Form 8949, so the sale — gain or loss, depreciation recapture — is not reported.",
    ];
    if (suspended && suspended > 0) {
      parts.push(`Form 8582 still carries ${fmt(suspended)} of this property's suspended passive losses to next year; a fully taxable disposition releases them (§469(g)).`);
    }
    if (currentProp && currentProp.fairDays !== null && currentProp.fairDays > dayOfYear(sale.date)) {
      parts.push(`Schedule E also shows more rental days (${currentProp.fairDays}) than days owned before the sale (${dayOfYear(sale.date)}).`);
    }
    findings.push({
      severity: "HIGH",
      category: "Rental property sale",
      title: `Form 4797 — sale of ${sale.address} not reported`,
      detail: parts.join(" "),
      action: "Report the disposition on Form 4797 (amount realized from the settlement statement, adjusted basis, depreciation allowed or allowable), mark the activity as fully disposed so Form 8582 releases its suspended losses, and take the property off future Schedules E.",
      authority: "IRC §1001, §1231, §1250; IRC §469(g); Form 4797 and Form 8582 instructions",
      evidence: `Settlement statement: ${sale.name}. Schedule E Part I; the current return has no Form 4797 or Form 8949.`,
    });
  }
  return findings;
}

/* ---------------------------------------------------------------------------
 * 2. Propiedades que desaparecen o dejan de depreciarse
 * ------------------------------------------------------------------------- */

const FULL_YEAR_DAYS = 300;

function checkRentalPropertyContinuity(files, meta = {}) {
  const { current, prior } = splitReturns(files, meta);
  if (!current || !prior) return [];
  const text = textOf(current);
  if (!isIndividualReturn(text)) return [];
  const now = scheduleEProperties(text);
  const before = scheduleEProperties(textOf(prior));
  if (!now || !before) return [];
  const sold = new Set(packageEntries(files, new Set([current, prior])).map(readSettlement).filter(Boolean).map((s) => s.key));
  const findings = [];

  // a) Estaba el año pasado y este año no esta, sin venta en el paquete ni formulario de venta.
  if (!hasDispositionForms(text)) {
    for (const p of before.properties) {
      if (now.properties.some((q) => q.key === p.key) || sold.has(p.key)) continue;
      findings.push({
        severity: "MEDIUM",
        category: "Rental property continuity",
        title: `Schedule E — ${p.address} dropped from the return`,
        detail: `${p.address} was a rental on last year's Schedule E${p.fairDays !== null ? ` (${p.fairDays} fair rental days)` : ""}${p.depreciation ? `, with ${fmt(p.depreciation)} of depreciation` : ""}, and it is not on this year's Schedule E. The return has no Form 4797 or Form 8949 and the package has no settlement statement for it, so nothing says what happened to it.`,
        action: "Confirm whether the property was sold, transferred, or converted to personal use. A sale goes on Form 4797 and releases its suspended passive losses; a conversion stops depreciation and carries the basis forward.",
        authority: "IRC §1001, §469(g); Treas. Reg. §1.168(i)-4; Schedule E instructions",
        evidence: "Last year's Schedule E Part I against this year's; no Form 4797, Form 8949 or settlement statement for the property.",
      });
    }
  }

  // b) Sigue alquilada todo el año y la depreciacion cae a menos de la mitad.
  const continuing = now.properties
    .filter((p) => p.fairDays !== null && p.fairDays >= FULL_YEAR_DAYS)
    .map((p) => ({ now: p, before: before.properties.find((q) => q.key === p.key) }))
    .filter((pair) => pair.before && before.depreciationByProperty && pair.before.depreciation > 500);
  if (!continuing.length) return findings;

  const shortfall = [];
  if (now.depreciationByProperty) {
    for (const pair of continuing) {
      if (pair.now.depreciation < pair.before.depreciation * 0.5) shortfall.push(pair);
    }
    if (shortfall.length) {
      findings.push({
        severity: "MEDIUM",
        category: "Rental depreciation",
        title: "Schedule E line 18 — depreciation dropped on a property rented all year",
        detail: shortfall.map((s) => `${s.now.address} was rented ${s.now.fairDays} days and shows ${fmt(s.now.depreciation)} of depreciation, against ${fmt(s.before.depreciation)} last year.`).join(" "),
        action: "Check the depreciation schedule for the property: a building still in service keeps depreciating until its basis is recovered. If it is fully depreciated, disregard this.",
        authority: "IRC §167, §168; Form 4562 instructions",
        evidence: "Schedule E line 18 and line 2, this year and last year.",
      });
    }
    return findings;
  }

  const expected = continuing.reduce((sum, pair) => sum + pair.before.depreciation, 0);
  if (now.totalDepreciation !== null && now.totalDepreciation < expected * 0.5) {
    findings.push({
      severity: "MEDIUM",
      category: "Rental depreciation",
      title: "Schedule E line 23d — depreciation dropped on a property rented all year",
      detail: `${continuing.map((pair) => `${pair.now.address} was rented ${pair.now.fairDays} days this year and depreciated ${fmt(pair.before.depreciation)} last year`).join("; ")}, but the whole Schedule E reports ${fmt(now.totalDepreciation)} of depreciation this year (line 23d).`,
      action: "Check the depreciation schedule: a rental still in service keeps depreciating until its basis is recovered. If the building is fully depreciated, disregard this.",
      authority: "IRC §167, §168; Form 4562 instructions",
      evidence: "Schedule E lines 2, 18 and 23d, this year and last year.",
    });
  }
  return findings;
}

/* ---------------------------------------------------------------------------
 * 2b. Gastos de año entero en una propiedad alquilada unas semanas
 *
 * Una propiedad que se vendio en febrero, o que se empezo a alquilar en noviembre, no puede
 * cargar al Schedule E los gastos de todo el año: solo los del periodo en que estuvo alquilada
 * o disponible. Cuando los dias de alquiler son pocos y los gastos multiplican las rentas, lo
 * que falta es la otra mitad del razonamiento: que parte de esos gastos corresponde a ese
 * periodo. Se compara por propiedad solo si cada renglon trae un importe por columna.
 * ------------------------------------------------------------------------- */

const SHORT_RENTAL_DAYS = 90;

function checkRentalExpensesOutOfProportion(files, meta = {}) {
  const { current } = splitReturns(files, meta);
  if (!current) return [];
  const text = textOf(current);
  if (!isIndividualReturn(text)) return [];
  const sched = scheduleEProperties(text);
  if (!sched) return [];
  const lines = linesOf(text);
  const start = lines.findIndex((l) => /^\s*1a\s+Physical address of each property/i.test(l));
  const block = lines.slice(start, start + 90);
  const row = (label, lineNo) => {
    const line = block.find((l) => label.test(l));
    return line ? valuesAfterLabel(line, label, lineNo) : [];
  };
  const rents = row(/\b3\s+Rents received/i, "3");
  const expenses = row(/\b20\s+Total expenses\.?\s*Add lines 5 through 19/i, "20");
  if (rents.length !== sched.properties.length || expenses.length !== sched.properties.length) return [];

  const flagged = sched.properties
    .map((p, k) => ({ ...p, rents: rents[k], expenses: expenses[k] }))
    .filter((p) => p.fairDays !== null && p.fairDays < SHORT_RENTAL_DAYS && p.expenses > Math.max(5000, p.rents * 5));
  if (!flagged.length) return [];
  return [{
    severity: "MEDIUM",
    category: "Rental expenses",
    title: "Schedule E line 20 — full-year expenses on a property rented a few weeks",
    detail: flagged.map((p) => `${p.address} was rented ${p.fairDays} days and reports ${fmt(p.rents)} of rents against ${fmt(p.expenses)} of expenses (line 20).`).join(" "),
    action: "Keep on Schedule E only the expenses of the period the property was rented or held for rent. Expenses after a sale, or of a period of personal use, are not rental expenses; costs paid at closing belong to the sale (Form 4797).",
    authority: "IRC §212, §280A; Treas. Reg. §1.212-1(h); Schedule E instructions",
    evidence: "Schedule E lines 2, 3 and 20, by property.",
  }];
}

/* ---------------------------------------------------------------------------
 * 3. Saldo a pagar pagado despues del vencimiento
 * ------------------------------------------------------------------------- */

// Tasa de interes por pago tardio para personas (§6621(a)(2)). La fija el IRS cada trimestre;
// el hallazgo la nombra para que el revisor la confirme.
const UNDERPAYMENT_RATE = 0.07;

/**
 * El importe de un renglon del 1040. Algunos programas lo imprimen en el renglon siguiente,
 * con el numero de linea repetido ("... instructions . . . 37 40,000."), porque el rotulo
 * ocupa dos renglones.
 */
function formLineAmount(lines, label, lineNo) {
  const i = lines.findIndex((l) => label.test(l));
  if (i < 0) return null;
  // El importe va despues del numero de linea repetido. Un renglon vacio termina en ese numero
  // solo ("... extension to file . . . 10"), y ese 10 no es un importe.
  const tail = new RegExp(`\\b${lineNo}\\s+(-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?)\\.?\\s*$`);
  for (const line of lines.slice(i, i + 3)) {
    const m = tail.exec(line.slice(line === lines[i] ? line.search(label) + 1 : 0));
    if (m) return parseMoney(m[1]);
  }
  // Sin numero repetido: solo un importe con separador de miles al final del propio renglon.
  const own = /((?:\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?)\.?\s*$/.exec(lines[i]);
  return own ? parseMoney(own[1]) : null;
}

/** La fecha de la carta al cliente, que es la fecha en que la declaracion sale. */
function letterDate(text) {
  const head = linesOf(text).slice(0, 60);
  for (const line of head) {
    const m = new RegExp(`^\\s*(${MONTHS.join("|")})\\s+(\\d{1,2}),\\s+(20\\d{2})\\s*$`).exec(line);
    if (m) return new Date(Date.UTC(Number(m[3]), MONTHS.indexOf(m[1]), Number(m[2])));
  }
  return null;
}

function dueDate(taxYear) {
  const d = new Date(Date.UTC(taxYear + 1, 3, 15));
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(17);
  if (dow === 0) d.setUTCDate(16);
  return d;
}

/** Meses o fraccion de mes entre dos fechas, como cuenta el §6651. */
function monthsLate(due, paid) {
  let months = (paid.getUTCFullYear() - due.getUTCFullYear()) * 12 + (paid.getUTCMonth() - due.getUTCMonth());
  if (paid.getUTCDate() > due.getUTCDate()) months += 1;
  return Math.max(months, 1);
}

function checkLatePaymentExposure(files, meta = {}, { now = new Date() } = {}) {
  const { current } = splitReturns(files, meta);
  if (!current) return [];
  const text = textOf(current);
  if (!isIndividualReturn(text)) return [];
  const lines = linesOf(text);
  const totalTax = formLineAmount(lines, /\b24\s+Add lines 22 and 23\.\s*This is your total tax/i, "24");
  const payments = formLineAmount(lines, /\b33\s+Add lines 25d, 26, and 32\.\s*These are your total payments/i, "33");
  const owed = formLineAmount(lines, /\b37\s+Subtract line 33 from line 24\.\s*This is the amount you owe/i, "37");
  if (totalTax === null || payments === null || owed === null || owed < 1000) return [];

  const taxYear = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
  if (!Number.isFinite(taxYear) || taxYear < 2000) return [];
  const due = dueDate(taxYear);
  const stated = letterDate(text);
  const paid = stated || now;
  if (paid <= due) return [];

  // La prorroga se presenta aparte y muchas veces no queda impresa en la declaracion, asi que
  // no encontrarla no prueba que no la hubo: sin ella no se calcula el recargo por presentar
  // tarde, solo se lo nombra. El recargo por pagar tarde y los intereses corren desde el 15 de
  // abril con prorroga o sin ella.
  const extensionPaid = formLineAmount(lines, /\b10\s+Amount paid with request for extension to file/i, "10");
  const extension = (extensionPaid !== null && extensionPaid > 0) || /^\s*FEDERAL\s*:.*\b4868\b/im.test(text);
  const months = monthsLate(due, paid);
  const days = Math.round((paid - due) / 86400000);
  const share = totalTax > 0 ? payments / totalTax : 1;
  const excused = extension && share >= 0.9;
  const latePayment = excused ? 0 : owed * Math.min(0.005 * months, 0.25);
  const interest = owed * (Math.pow(1 + UNDERPAYMENT_RATE / 365, days) - 1);
  const total = latePayment + interest;

  const when = stated ? `At the date on the client letter (${dateText(stated)})` : `As of this review (${dateText(paid)})`;
  const parts = [
    `The return shows ${fmt(owed)} owed on ${fmt(totalTax)} of tax, with ${fmt(payments)} paid by ${dateText(due)} (${Math.round(share * 100)}%).`,
    `${when} the balance is ${months} month${months === 1 ? "" : "s"} past due:`,
  ];
  const pieces = [];
  if (latePayment) pieces.push(`about ${fmt(latePayment)} of late-payment penalty (§6651(a)(2), 0.5% a month)`);
  pieces.push(`about ${fmt(interest)} of interest (§6601, at ~${Math.round(UNDERPAYMENT_RATE * 100)}% a year; the rate is set quarterly)`);
  parts.push(`${pieces.join(" and ")}.`);
  if (excused) parts.push("The late-payment penalty does not apply because at least 90% of the tax was paid by the due date on an extended return.");
  parts.push(`None of it is in the amount owed on the return; the IRS bills it separately (about ${fmt(total)} in total).`);
  if (!extension) parts.push("The return does not show an extension (no Form 4868, no extension payment); if none was filed, the failure-to-file penalty — 5% a month, up to 25% — applies on top.");

  return [{
    severity: "MEDIUM",
    category: "Late payment",
    title: "Form 1040 line 37 — balance due paid after the due date",
    detail: parts.join(" "),
    action: `Tell the client before filing that about ${fmt(total)} of penalty and interest will follow the ${fmt(owed)} balance, or pay it with the return; interest and the late-payment penalty keep running until the balance is paid.${extension ? "" : " Confirm the extension was filed."}`,
    authority: "IRC §6651(a)(1), §6651(a)(2), §6601, §6621; Treas. Reg. §301.6651-1(c)(3)",
    evidence: `Form 1040 lines 24, 33 and 37; ${stated ? "the date on the client letter" : "the date of this review"}; ${extension ? "the extension on the return" : "no extension found in the return"}.`,
  }];
}

/* ---------------------------------------------------------------------------
 * 4. K-1 que la declaracion usa y el paquete no trae
 * ------------------------------------------------------------------------- */

/** Las entidades de la Parte II del Schedule E: nombre, tipo (P o S) y EIN. */
function scheduleEPartTwoEntities(text) {
  const lines = linesOf(text);
  const start = lines.findIndex((l) => /^\s*28\s+\(a\)\s+Name/i.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < Math.min(lines.length, start + 16); i += 1) {
    if (/Passive Income and Loss/i.test(lines[i])) break;
    const m = /^\s*([A-D])\s+(.+?)\s+([PS])\s+(\d{2}-\d{7})\b/.exec(lines[i]);
    if (m) out.push({ letter: m[1], name: m[2].trim(), type: m[3], ein: m[4] });
  }
  return out;
}

function checkK1WithoutSupport(files, meta = {}) {
  const { current, prior } = splitReturns(files, meta);
  if (!current) return [];
  const text = textOf(current);
  if (!isIndividualReturn(text)) return [];
  const entities = scheduleEPartTwoEntities(text);
  if (!entities.length) return [];
  const entries = packageEntries(files, new Set([current, prior])).filter((e) => /Schedule K-1|\bK-1\b/i.test(e.text) || /k-?1/i.test(e.name));
  const missing = entities.filter((ent) => {
    const digits = ent.ein.replace(/\D/g, "");
    const firstWords = ent.name.toUpperCase().split(/\s+/).filter((w) => w.length >= 3 && !SELLER_STOP.has(w)).slice(0, 2);
    return !entries.some((e) => {
      const flat = e.text.replace(/\D/g, "");
      if (flat.includes(digits)) return true;
      const upper = `${e.name} ${e.text.slice(0, 20000)}`.toUpperCase();
      return firstWords.length > 0 && firstWords.every((w) => upper.includes(w));
    });
  });
  if (!missing.length) return [];
  const kind = (t) => (t === "S" ? "S corporation" : "partnership");
  return [{
    severity: "MEDIUM",
    category: "Missing K-1",
    title: "Schedule E Part II — K-1 not in the package",
    detail: `Schedule E Part II reports ${missing.map((m) => `${m.name} (${kind(m.type)}, EIN ${m.ein})`).join("; ")}, but no Schedule K-1 from ${missing.length === 1 ? "it" : "them"} is in the package, so every figure carried from ${missing.length === 1 ? "that K-1" : "those K-1s"} — income, W-2 wages for the QBI deduction, credits, distributions and basis — cannot be checked.`,
    action: "Get the K-1s and tie them to Schedule E Part II, Form 8995/8995-A and Form 7203 (or the partner basis worksheet) before filing.",
    authority: "IRC §6037, §6031(b); Schedule E instructions",
    evidence: "Schedule E Part II line 28 against the documents in the package.",
  }];
}

/* ---------------------------------------------------------------------------
 * 5. K-1 estimados
 * ------------------------------------------------------------------------- */

const ESTIMATE = /\bestimated\s+(?:schedule\s+)?k-?1\b|\bk-?1\s+estimate|\btax\s+estimate\b|\bestimated\s+taxable\s+income\b|should not be considered a final determination|\b(?:preliminary|draft|pro\s?forma)\s+(?:schedule\s+)?k-?1\b/i;

const ISSUER_STOP = new Set([...SELLER_STOP, "ESTIMATED", "ESTIMATE", "SCHEDULE", "PARTNER", "TAXABLE", "INCOME", "LOSS", "FOR", "TWELVE", "MONTHS", "ENDED", "DECEMBER"]);

/** El emisor es el primer renglon con palabras; se le quita el "- 2025 Estimated K-1". */
function issuerOf(text) {
  for (const line of linesOf(text)) {
    const clean = line.replace(/^--- Page \d+ ---$/, "").trim();
    if (clean.length >= 4 && /[A-Za-z]{3}/.test(clean)) return clean.replace(/\s+-\s+\d{4}\s+Estimated.*$/i, "").slice(0, 80);
  }
  return "";
}

/** Mayusculas y un solo espacio entre palabras, para buscar un nombre como frase. */
const flatten = (text) => ` ${String(text || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()} `;

/**
 * El nombre de un emisor como frase: sus dos primeras palabras juntas. "Example Growth III, LP"
 * -> "EXAMPLE GROWTH". Una palabra sola no alcanza: el apellido de un fondo puede estar en
 * cualquier otro nombre de la declaracion.
 */
function issuerPhrase(issuer) {
  const words = (String(issuer || "").toUpperCase().match(/[A-Z][A-Z0-9'-]*/g) || []).filter((w) => w.length >= 3);
  if (words.length < 2 || words.every((w) => ISSUER_STOP.has(w))) return "";
  return ` ${words.slice(0, 2).join(" ").replace(/'/g, " ")} `;
}

/** Un K-1 de verdad trae el formulario: "Partner's Share of Income", no solo la palabra K-1. */
const FINAL_K1_FORM = /Schedule K-1/i;
// Con apostrofo recto o tipografico: los K-1 generados por los fondos traen el segundo.
const K1_BODY = /(?:Partner|Shareholder|Beneficiary)[’']?s Share of (?:Current Year )?Income/i;
// Lo que describe el capital, no el resultado del año: no sirve para decir de que cifra se habla.
const CAPITAL_LINE = /capital|contribution|distribution|withdraw/i;

/**
 * Un estimado importa cuando la declaracion reporta a ese emisor y en el paquete no hay un
 * K-1 final suyo: entonces lo unico que respalda esas cifras es la estimacion. Si hay un final,
 * el estimado quedo superado y no se dice nada. No alcanza con buscar las cifras del estimado
 * en la declaracion: la linea de dividendos suma el estimado con otros fondos y no lo muestra.
 */
function checkEstimatedK1s(files, meta = {}) {
  const { current, prior } = splitReturns(files, meta);
  if (!current) return [];
  const returnText = flatten(textOf(current));
  const workpapers = flatten((Array.isArray(files) ? files : []).filter((f) => /workpaper/.test(roleOf(f))).map(textOf).join("\n"));
  const entries = packageEntries(files, new Set([current, prior]));
  const isEstimate = (e) => ESTIMATE.test(`${e.name}\n${e.text.slice(0, 3000)}`);
  const finals = entries.filter((e) => !isEstimate(e) && FINAL_K1_FORM.test(e.text) && K1_BODY.test(e.text)).map((e) => flatten(e.text));
  const used = [];
  const seen = new Set();
  for (const entry of entries.filter(isEstimate)) {
    const issuer = issuerOf(entry.text);
    const phrase = issuerPhrase(issuer);
    if (!phrase || seen.has(phrase)) continue;
    const inReturn = returnText.includes(phrase) || workpapers.includes(phrase);
    const hasFinal = finals.some((text) => text.includes(phrase));
    if (!inReturn || hasFinal) continue;
    seen.add(phrase);
    // La cifra mas grande del estimado, con su rotulo, para que se sepa de que se habla. Primero
    // las casillas del K-1 ("Box 6A", "Line 9a"); el capital no dice que se declaro.
    const withAmount = linesOf(entry.text).filter((l) => !CAPITAL_LINE.test(l) && amountsIn(l).some((n) => Math.abs(n) >= 1000));
    const boxes = withAmount.filter((l) => /^\s*(?:Box|Line)\s+\d/i.test(l));
    const pool = boxes.length ? boxes : withAmount;
    const biggest = pool.sort((a, b) => Math.max(...amountsIn(b).map(Math.abs)) - Math.max(...amountsIn(a).map(Math.abs)))[0];
    used.push({ name: entry.name, issuer, line: biggest ? biggest.replace(/\s+/g, " ").trim().slice(0, 90) : "" });
  }
  if (!used.length) return [];
  return [{
    severity: "MEDIUM",
    category: "Estimated K-1",
    title: "Schedule K-1 — return built on estimates",
    detail: `The return reports ${used.length === 1 ? "an investment" : "investments"} whose only K-1 in the package is an estimate, not a final K-1: ${used.map((u) => `${u.issuer} (${u.name}${u.line ? ` — "${u.line}"` : ""})`).join("; ")}.`,
    action: "Get the final K-1s before filing, or document that estimates were used and track the finals; if a final differs, the return (and any K-1s it issues) has to be amended.",
    authority: "IRC §6031(b), §6037; Treas. Reg. §1.6031(b)-1T",
    evidence: `Estimate documents: ${used.map((u) => u.name).join("; ")}; no final K-1 from the same issuer in the package.`,
  }];
}

/* ---------------------------------------------------------------------------
 * 6. Pasivos de los socios en el K-1 (1065)
 * ------------------------------------------------------------------------- */

/**
 * El importe de una celda del item K. Despues del ultimo "$" puede venir el rotulo de la
 * casilla siguiente del K-1 ("$ $ 13 Other deductions"): un numero seguido de una palabra es
 * el numero de una casilla, no un importe.
 */
function cellAmount(segment) {
  const m = /^\s*(-?\(?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\)?\.?)(\s+[A-Za-z])?/.exec(String(segment || ""));
  if (!m || m[2]) return 0;
  return parseMoney(m[1].replace(/\.$/, "")) || 0;
}

function itemKRow(line, label) {
  const at = line.search(label);
  if (at < 0) return null;
  const cells = line.slice(at).split("$").slice(1);
  if (!cells.length) return null;
  return { beginning: cellAmount(cells[0]), ending: cellAmount(cells[1]) };
}

function partnerLiabilities(text) {
  const lines = linesOf(text);
  const k1s = [];
  lines.forEach((line, i) => {
    if (!/Partner'?s share of liabilities/i.test(line)) return;
    const block = lines.slice(i, i + 9);
    const nr = block.map((l) => itemKRow(l, /^\s*Nonrecourse\b/i)).find(Boolean);
    const qnr = block.map((l) => itemKRow(l, /^\s*financing\b|Qualified nonrecourse financing/i)).find(Boolean);
    const rec = block.map((l) => itemKRow(l, /^\s*Recourse\b/i)).find(Boolean);
    if (!nr && !rec) return;
    const zero = { beginning: 0, ending: 0 };
    k1s.push({ nonrecourse: nr || zero, qualified: qnr || zero, recourse: rec || zero });
  });
  return k1s;
}

/** El primer Schedule L del texto (el federal); el estatal viene despues. */
function scheduleLLiabilities(text) {
  const lines = linesOf(text);
  const start = lines.findIndex((l) => /Schedule L\s+Balance Sheets per Books/i.test(l));
  if (start < 0) return null;
  const block = lines.slice(start, start + 45);
  const pair = (re) => {
    const line = block.find((l) => re.test(l));
    const values = line ? valuesAfterLabel(line, re) : [];
    return values.length >= 2 ? { beginning: values[values.length - 2], ending: values[values.length - 1] } : null;
  };
  const total = pair(/^\s*22\s+Total liabilities and capital/i);
  const capital = pair(/^\s*21\s+Partners'? capital accounts/i);
  const loans = pair(/^\s*19\s*a\s+Loans from partners/i);
  if (!total || !capital) return null;
  return {
    beginning: total.beginning - capital.beginning,
    ending: total.ending - capital.ending,
    loansFromPartners: loans,
  };
}

function checkPartnerLiabilities(files, meta = {}) {
  const { current } = splitReturns(files, meta);
  if (!current) return [];
  const text = textOf(current);
  if (!isPartnershipReturn(text)) return [];
  const k1s = partnerLiabilities(text);
  const sched = scheduleLLiabilities(text);
  if (!k1s.length || !sched || sched.ending < 1000) return [];

  const sum = (col, kinds = ["nonrecourse", "qualified", "recourse"]) => k1s.reduce((s, k) => s + kinds.reduce((t, kind) => t + k[kind][col], 0), 0);
  const endTotal = sum("ending");
  const lowerTier = /includes liability amounts from lower-tier partnerships[ .]*X\b/i.test(text);
  const loans = sched.loansFromPartners;
  const parts = [];

  if (endTotal === 0 && sum("beginning") === 0) {
    parts.push(`Item K is blank on all ${k1s.length} partner K-1s — beginning and ending — while Schedule L carries ${fmt(sched.beginning)} of liabilities at the beginning of the year and ${fmt(sched.ending)} at the end${loans && loans.ending ? `, ${fmt(loans.ending)} of them loans from partners` : ""}.`);
  } else if (endTotal === 0) {
    parts.push(`Item K ending liabilities are blank on all ${k1s.length} partner K-1s, while Schedule L ends the year with ${fmt(sched.ending)} of liabilities${loans && loans.ending ? `, ${fmt(loans.ending)} of them loans from partners` : ""}.`);
  } else if (!lowerTier && Math.abs(endTotal - sched.ending) > Math.max(1000, sched.ending * 0.02)) {
    parts.push(`Item K ending liabilities on the ${k1s.length} partner K-1s add to ${fmt(endTotal)}, against ${fmt(sched.ending)} of liabilities on Schedule L at year end.`);
  }

  // Un prestamo de un socio es recourse de ese socio: es quien soporta el riesgo economico.
  if (loans) {
    const col = endTotal === 0 ? "beginning" : "ending";
    const loanAmount = loans[col];
    const recourse = sum(col, ["recourse"]);
    if (loanAmount >= 1000 && recourse < loanAmount * 0.5) {
      const nonrecourse = sum(col, ["nonrecourse", "qualified"]);
      parts.push(`At ${col === "beginning" ? "the beginning of the year" : "year end"} Schedule L shows ${fmt(loanAmount)} of loans from partners, but the K-1s carry only ${fmt(recourse)} as recourse and ${fmt(nonrecourse)} as nonrecourse — a partner's loan to the partnership is recourse to the partner who made it, not a liability shared by every partner.`);
    }
  }
  if (!parts.length) return [];
  return [{
    severity: "MEDIUM",
    category: "Partner liabilities",
    title: "Schedule K-1 item K — partners' share of liabilities",
    detail: parts.join(" "),
    action: "Fill item K for every partner at year end, allocate each partner loan as recourse to the partner who lent it, and confirm the totals tie to the liabilities on Schedule L. Partner basis and at-risk amounts depend on it.",
    authority: "IRC §752; Treas. Reg. §1.752-1, §1.752-2(a), §1.752-2(c)(1); Form 1065 Schedule K-1 instructions, item K",
    evidence: "Schedule L lines 19a, 21 and 22 against item K of every partner K-1 in the return.",
  }];
}

/* ---------------------------------------------------------------------------
 * Todo junto
 * ------------------------------------------------------------------------- */

function runCrossDocumentChecks(files, meta = {}, options = {}) {
  const findings = [];
  const run = (check) => {
    try {
      findings.push(...check());
    } catch (error) {
      // Un cruce que revienta no puede tirar la revision: se registra y se sigue sin el.
      console.warn(`[cross-document] ${error.message}`);
    }
  };
  run(() => checkRentalSaleNotReported(files, meta));
  run(() => checkRentalPropertyContinuity(files, meta));
  run(() => checkRentalExpensesOutOfProportion(files, meta));
  run(() => checkLatePaymentExposure(files, meta, options));
  run(() => checkK1WithoutSupport(files, meta));
  run(() => checkEstimatedK1s(files, meta));
  run(() => checkPartnerLiabilities(files, meta));
  return findings;
}

module.exports = {
  runCrossDocumentChecks,
  checkRentalSaleNotReported,
  checkRentalPropertyContinuity,
  checkRentalExpensesOutOfProportion,
  checkLatePaymentExposure,
  checkK1WithoutSupport,
  checkEstimatedK1s,
  checkPartnerLiabilities,
  scheduleEProperties, scheduleEPartTwoEntities, readSettlement, packageEntries,
  partnerLiabilities, scheduleLLiabilities, streetKey, monthsLate, dueDate, letterDate,
  UNDERPAYMENT_RATE,
};
