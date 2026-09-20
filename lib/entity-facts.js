"use strict";

/**
 * entity-facts.js — lo que dicen un 1065, un 1120-S o un 1120, leido con reglas fijas.
 *
 * Lo mas importante son los K-1 que la propia declaracion emite: cada uno trae el numero del
 * socio o accionista, sus porcentajes (item J), su cuenta de capital (item L) y si es el ultimo
 * (casilla Final K-1). Con eso se sigue a cada socio de un año al otro, que es donde aparecen las
 * salidas sin K-1 final, los capitales que no abren donde cerraron y los porcentajes que cambian
 * sin explicacion. Los K-1 que la entidad recibe de otras sociedades se leen con el mismo molde.
 *
 * Las casillas se leen como las imprime pdf.js: la X va delante de la casilla marcada
 * ("X Final K-1", "Final K-1 X Amended K-1" es un enmendado, "(2) X Final return"), y las
 * respuestas Si/No llegan anotadas como "[ANSWER: Yes]". Todo lo que no se lee queda en null.
 */

const { parseMoney, splitReturns } = require("./prior-year-bridge");
const { textOf, linesOf, lineAmount, tailAmount } = require("./return-facts");
const pd = require("./package-docs");

const TIN = /\b(\d{3}-\d{2}-\d{4}|\d{2}-\d{7})\b/;
const isEin = (tin) => /^\d{2}-\d{7}$/.test(String(tin || ""));

function entityType(text) {
  const head = String(text || "").slice(0, 400000);
  if (/U\.\s?S\.\s+Income Tax Return for an S Corporation/i.test(head)) return "1120-S";
  if (/U\.\s?S\.\s+Return of Partnership Income/i.test(head)) return "1065";
  if (/U\.\s?S\.\s+Corporation Income Tax Return/i.test(head)) return "1120";
  return "";
}

const ENTITY_TITLE = /U\.\s?S\.\s+(?:Return of Partnership Income|Income Tax Return for an S Corporation|Corporation Income Tax Return)/i;

/** El EIN de la entidad: el primero que aparece despues del titulo del formulario. */
function entityEin(text) {
  const lines = linesOf(text);
  const i = lines.findIndex((l) => ENTITY_TITLE.test(l));
  if (i < 0) return null;
  for (const line of lines.slice(i, i + 30)) {
    const m = /\b(\d{2}-\d{7})\b/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** Porcentaje de un renglon del item J: "Profit 37.8 % 37.8 %" -> [37.8, 37.8]. */
function percents(line) {
  return (String(line || "").match(/(\d{1,3}(?:\.\d+)?)\s*%/g) || []).map((p) => Number(p.replace(/[%\s]/g, "")));
}

// Despues del "$" puede venir el rotulo de la casilla de al lado ("$ 23 More than one activity"):
// un numero seguido de una palabra es el numero de una casilla, no un importe.
const K1_MONEY = /\$\s*(\(?)\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\.?/;
function capitalLine(lines, label) {
  const line = lines.find((l) => label.test(l));
  if (!line) return null;
  const segment = line.slice(line.search(label));
  const m = K1_MONEY.exec(segment);
  if (!m) return null;
  const rest = segment.slice(m.index + m[0].length);
  if (/^\s+[A-Za-z]/.test(rest)) return null;
  const value = parseMoney(m[2].replace(/\.$/, ""));
  return m[1] && value > 0 ? -value : value;
}

/**
 * Los nombres que los anexos imprimen al lado del numero de cada socio: "PARTNER 10: NOMBRE
 * 000-00-0000" o "Partner's name: NOMBRE Partner's identifying number: 000-00-0000". El K-1
 * mezcla el nombre con las casillas de la otra columna y a veces no se puede separar.
 */
function statementNames(text) {
  const map = new Map();
  const add = (name, tin) => {
    const clean = String(name || "").replace(/\s+/g, " ").trim().toUpperCase();
    if (clean.length < 3) return;
    const set = map.get(tin) || new Set();
    set.add(clean);
    map.set(tin, set);
  };
  const body = String(text || "");
  for (const m of body.matchAll(/\b(?:PARTNER|SHAREHOLDER)\s+\d+:\s+([A-Z][A-Z0-9 .,&'\/-]{2,80}?)\s+(\d{3}-\d{2}-\d{4}|\d{2}-\d{7})\b/g)) add(m[1], m[2]);
  for (const m of body.matchAll(/(?:Partner|Shareholder)[’']s name:\s*(.{3,80}?)\s+(?:Partner|Shareholder)[’']s identifying number:\s*(\d{3}-\d{2}-\d{4}|\d{2}-\d{7})/g)) add(m[1], m[2]);
  return map;
}

/** El nombre del socio en el bloque F: el primer renglon en mayusculas que no es una casilla ni una direccion. */
function nameAfterLabel(block, fLabel) {
  if (fLabel < 0) return "";
  for (const raw of block.slice(fLabel + 1, fLabel + 6)) {
    const line = String(raw || "").replace(/\s+\d+[a-z]?\s+[A-Z][a-z].*$/, "").trim();
    if (!line || /[a-z]/.test(line)) continue;
    if (/^\d/.test(line) || /^[A-Z]\s+[\d(]/.test(line) || /^[A-Z]?\s*-?[\d,]+\.?$/.test(line)) continue;
    if (/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\s*$/.test(line)) continue; // ciudad, estado y codigo postal
    if ((line.match(/[A-Z]/g) || []).length < 4) continue;
    return line;
  }
  let name = String(block[fLabel + 1] || "").replace(/\s+\d+[a-z]?\s+[A-Z][a-z].*$/, "").trim();
  if (/^\d+[a-z]?\s/.test(name)) name = ""; // el renglon es de otra columna del formulario
  return name;
}

/** Los bloques K-1 federales de un texto: cada uno empieza en "Final K-1 ... Amended K-1". */
function k1Blocks(text) {
  const lines = linesOf(text);
  const starts = [];
  lines.forEach((l, i) => {
    if (!/Final K-1\b.*Amended K-1/i.test(l)) return;
    const head = lines.slice(i, i + 5).join(" ");
    if (/Schedule K-1/i.test(head) && /\(Form (?:1065|1120-?S)\)/i.test(head)) starts.push(i);
  });
  return starts.map((start, n) => {
    const end = Math.min(n + 1 < starts.length ? starts[n + 1] : lines.length, start + 240);
    return lines.slice(start, end);
  });
}

function parseK1Block(block, ownEin) {
  const form = /\(Form 1120-?S\)/i.test(block.slice(0, 5).join(" ")) ? "1120-S" : "1065";
  const top = block[0];
  const eLabel = block.findIndex((l) => /\bE\s+(?:Partner.s SSN or TIN|Shareholder.s identifying number)/i.test(l));
  let tin = null;
  if (eLabel >= 0) {
    for (const l of block.slice(eLabel, eLabel + 4)) {
      const m = TIN.exec(l.replace(/\(Do not use TIN.*$/i, ""));
      if (m && m[1] !== ownEin) { tin = m[1]; break; }
    }
  }
  const fLabel = block.findIndex((l) => /\bF\s+(?:Name, address, city|Shareholder.s name, address)/i.test(l));
  const typeLine = block.find((l) => /What type of entity is this partner\?/i.test(l)) || "";
  const ownerType = ((/\?\s*([A-Z][A-Z -]{3,30})\s*$/.exec(typeLine) || [])[1] || "").trim();
  const general = block.some((l) => /\bX\s+General partner or LLC\b/i.test(l));
  return {
    form, tin, name: nameAfterLabel(block, fLabel), ownerType,
    ownerKind: ownerType ? (/INDIVIDUAL|ESTATE/i.test(ownerType) ? "individual" : "entity") : tin ? (isEin(tin) ? "entity" : "individual") : "",
    general,
    final: /\bX\s+Final K-1\b/i.test(top),
    amended: /Final K-1\s+X\s+Amended K-1/i.test(top),
    profit: percents(block.find((l) => /^\s*Profit\b/i.test(l))),
    loss: percents(block.find((l) => /^\s*Loss\b/i.test(l))),
    capitalPct: percents(block.find((l) => /^\s*Capital\s+\d/i.test(l))),
    allocation: percents(block.find((l) => /Current year allocation percentage/i.test(l))),
    capital: {
      beginning: capitalLine(block, /Beginning capital account/i),
      contributed: capitalLine(block, /Capital contributed during the year/i),
      income: capitalLine(block, /Current year net income \(loss\)/i),
      withdrawals: capitalLine(block, /Withdrawals and distributions/i),
      ending: capitalLine(block, /Ending capital account/i),
    },
  };
}

/** Porcentaje mas alto del socio al cierre (ganancias, perdidas o capital). */
const endingShare = (k) => Math.max(k.profit[k.profit.length - 1] || 0, k.loss[k.loss.length - 1] || 0, k.capitalPct[k.capitalPct.length - 1] || 0);

/**
 * Los K-1 federales que emite la declaracion (no los estatales ni los recibidos).
 */
function issuedK1s(text) {
  const ein = entityEin(text);
  const names = statementNames(text);
  const out = k1Blocks(text).map((block) => parseK1Block(block, ein));
  // El anexo rotula el nombre; el bloque F lo mezcla con la otra columna. Manda el anexo.
  for (const k of out) {
    const known = k.tin ? names.get(k.tin) : null;
    if (known && known.size === 1) k.name = [...known][0];
  }
  // Un mismo K-1 puede venir dos veces (copia del socio y del archivo). No alcanza con el numero:
  // dos socios distintos pueden compartirlo (un fideicomiso con el del fideicomitente), asi que
  // es la misma copia solo si coinciden numero, porcentajes y capital.
  const seen = new Set();
  return out.filter((k) => {
    const key = JSON.stringify([k.tin, k.profit, k.allocation, k.capital.beginning, k.capital.ending]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Los K-1 que el contribuyente recibe (documentos del paquete, no la declaracion): quien lo emite
 * (EIN del item A) y el primer K-1 federal del documento.
 */
function receivedK1s(files, meta = {}) {
  const { current, prior } = splitReturns(files, meta);
  const exclude = new Set([current, prior].filter(Boolean));
  const out = [];
  for (const doc of pd.packageDocuments(files, { exclude })) {
    if (!doc.text || !doc.types.includes("k1")) continue;
    const i = doc.text.search(/A\s+(?:Partnership|Corporation)[’']s employer identification number/i);
    const issuerEin = i >= 0 ? ((/\b(\d{2}-\d{7})\b/.exec(doc.text.slice(i, i + 400)) || [])[1] || null) : null;
    const blocks = k1Blocks(doc.text);
    out.push({
      doc, name: doc.name, year: doc.year, issuerEin,
      head: doc.text.slice(0, 8000).replace(/\s+/g, " ").toUpperCase(),
      k1: blocks.length ? parseK1Block(blocks[0], null) : null,
    });
  }
  return out;
}

/** Un renglon de la pagina 1 o de un anexo, dentro de un tramo del texto. */
function sectionRange(lines, titleRe, span) {
  const i = lines.findIndex((l) => titleRe.test(l));
  return i < 0 ? null : { from: i, to: Math.min(lines.length, i + span) };
}

const STANDALONE = /^\s*(?:[A-Z]\s+){0,3}(-?\(?(?:\d{1,3}(?:,\d{3})+|\d+)\)?)\.?\s*$/;

/** El importe que cae en el renglon siguiente sin numero de linea ("T R -4,333,026."). */
function amountBelow(lines, label, range) {
  const i = lines.findIndex((l, k) => k >= (range ? range.from : 0) && k < (range ? range.to : lines.length) && label.test(l));
  if (i < 0) return null;
  const m = STANDALONE.exec(lines[i + 1] || "");
  return m ? parseMoney(m[1]) : null;
}

function readLine(lines, label, lineNo, range) {
  const v = lineAmount(lines, label, lineNo, range || {});
  return v !== null ? v : amountBelow(lines, label, range);
}

/**
 * El importe al final de un rotulo sin numero de linea repetido ("... Subtract line 8 from line 5
 * . . . 694,395."). Tiene que venir despues de los puntos guia o de dos espacios, para no tomar
 * el "5" de "line 5"; si el renglon termina en el rotulo, se mira el siguiente.
 */
function amountAfterLabel(lines, label, range) {
  const i = lines.findIndex((l, k) => k >= (range ? range.from : 0) && k < (range ? range.to : lines.length) && label.test(l));
  if (i < 0) return null;
  const segment = lines[i].slice(lines[i].search(label));
  const m = /(?:\.\s*|\s{2,}|\$\s*)(-?\(?(?:\d{1,3}(?:,\d{3})+|\d+)\)?)\.?\s*$/.exec(segment) ||
    /\s(-?\(?\d{1,3}(?:,\d{3})+\)?)\.?\s*$/.exec(segment); // sin puntos guia: solo un importe con separador de miles
  if (m) return parseMoney(m[1]);
  const next = STANDALONE.exec(lines[i + 1] || "");
  return next ? parseMoney(next[1]) : null;
}

const M2_AMOUNT = /\(\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\.?\s*\)|-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\.?(?=\s|$)/g;
const m2Amount = (raw) => {
  const v = raw.replace(/\s+/g, "").replace(/\.\)$/, ")").replace(/\.$/, "");
  const inner = /^\((.*)\)$/.exec(v);
  const n = parseMoney(inner ? inner[1] : v);
  return n === null ? null : inner ? -Math.abs(n) : n;
};

/**
 * Los importes de un renglon del M-2 despues de su rotulo. Si el rotulo sigue en el renglon de
 * abajo ("line 6 . . . 161,949 10,000"), se toman los de ese renglon solo si no trae otra cosa.
 */
function m2Values(lines, label, range) {
  const i = lines.findIndex((l, k) => k >= range.from && k < range.to && label.test(l));
  if (i < 0) return null;
  const grab = (s) => (s.match(M2_AMOUNT) || []).map(m2Amount).filter((v) => v !== null && Math.abs(v) >= 10);
  const own = grab(lines[i].slice(lines[i].search(label)).replace(/line \d+/gi, " "));
  if (own.length) return own;
  const rest = String(lines[i + 1] || "").replace(/^\s*line \d+\s*/i, "").replace(/(?:\.\s*){2,}/g, " ").trim();
  return /^(?:\(?\s*-?[\d,]+(?:\.\d{1,2})?\.?\s*\)?\s*)+$/.test(rest) ? grab(rest) : [];
}

/** Respuesta Si/No de una pregunta: la primera anotacion antes de que empiece la pregunta siguiente. */
function answerAfter(lines, question) {
  const i = lines.findIndex((l) => question.test(l));
  if (i < 0) return null;
  for (let j = i; j < Math.min(lines.length, i + 7); j += 1) {
    if (j > i && /^\s*(?:[a-z]|\d{1,2})\s+[A-Z]/.test(lines[j])) break;
    const m = /\[ANSWER:\s*(Yes|No)\]/i.exec(lines[j]);
    if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  }
  return null;
}

/** Casillas marcadas del encabezado: "(2) X Final return". */
function returnBoxes(text) {
  const lines = linesOf(text);
  const i = lines.findIndex((l) => /Check (?:applicable boxes|if):\s*\(1\)/i.test(l));
  const out = { initial: false, final: false, amended: false, found: i >= 0 };
  if (i < 0) return out;
  const head = `${lines[i]} ${lines[i + 1] || ""}`;
  out.initial = /\(\d\)\s*X\s+Initial return/i.test(head);
  out.final = /\(\d\)\s*X\s+Final return/i.test(head);
  out.amended = /\(\d\)\s*X\s+Amended return/i.test(head);
  return out;
}

/** Renglones de la entidad que usan los cruces. Lo que no se lee queda en null. */
function entityLines(text) {
  const lines = linesOf(text);
  const type = entityType(text);
  const page1 = sectionRange(lines, ENTITY_TITLE, 220) || { from: 0, to: Math.min(lines.length, 220) };
  const schedK = sectionRange(lines, /Schedule K\s+(?:Partners.|Shareholders.) (?:Distributive Share Items|Pro Rata Share Items)/i, 160);
  const out = { type };
  if (type === "1065") {
    out.guaranteedPage1 = readLine(lines, /Guaranteed payments to partners/i, "10", page1);
    out.guaranteedK = schedK ? readLine(lines, /\bc?\s*Total guaranteed payments\b/i, "4c", schedK) : null;
    out.ordinary = readLine(lines, /Ordinary business income \(loss\)\.\s*Subtract line 22 from line 8|Ordinary business income \(loss\)\.\s*Subtract line 21 from line 8/i, "23", page1);
    out.salaries = readLine(lines, /Salaries and wages \(other than to partners\)/i, "9", page1);
    out.analysisIncome = readLine(lines, /Schedule K, lines 12 through 13e, and 21/i, "1");
    out.m1Closing = amountAfterLabel(lines, /Subtract line 8 from line 5/i);
  }
  if (type === "1120-S") {
    out.officerComp = readLine(lines, /Compensation of officers \(see instructions/i, "7", page1);
    out.salaries = readLine(lines, /Salaries and wages \(less employment credits\)/i, "8", page1);
    out.ordinary = readLine(lines, /Ordinary business income \(loss\)\.\s*Subtract line 21 from line 6/i, "22", page1);
    out.distributions = schedK ? readLine(lines, /\bd\s+Distributions \(attach/i, "16d", schedK) : null;
    out.incomeReconciliation = amountBelow(lines, /subtract the sum of the amounts on lines 11 through 12[a-e] and 16f/i) ??
      readLine(lines, /Income \(loss\) reconciliation\.\s*Combine/, "18");
    out.m1Closing = amountAfterLabel(lines, /Income \(loss\) \(Schedule K, line 18\)/i);
  }
  if (type === "1120") {
    out.officerComp = readLine(lines, /Compensation of officers \(see instructions/i, "12", page1);
    out.salaries = readLine(lines, /Salaries and wages \(less employment credits\)/i, "13", page1);
    out.dividendsPage1 = readLine(lines, /Dividends and inclusions \(Schedule C, line 23/i, "4", page1);
    out.incomeBeforeNol = readLine(lines, /Taxable income before net operating loss deduction and special deductions/i, "28", page1);
    out.nolDeduction = readLine(lines, /Net operating loss deduction \(see instructions\)/i, "29\\s*a", page1);
    out.specialDeductions = readLine(lines, /Special deductions \(Schedule C, line 24/i, "29\\s*b", page1);
    out.taxableIncome = readLine(lines, /Taxable income\.\s*Subtract line 29c from line 28/i, "30", page1);
    out.totalTax = readLine(lines, /Total tax \(Schedule J, Part I, line 11\)|Total tax\s*\(Schedule J/i, "31", page1);
    out.overpaymentCredited = (() => {
      const i = lines.findIndex((l) => /Enter amount from line 35 you want:\s*Credited to \d{4} estimated tax/i.test(l));
      if (i < 0) return null;
      const m = /Credited to \d{4} estimated tax\s*[>▶]?\s*([\d,]+)\.?\s+Refunded/i.exec(lines[i]);
      return m ? parseMoney(m[1]) : null;
    })();
    out.nolAvailable = amountAfterLabel(lines, /Enter the available NOL carryover from prior tax years/i);
    out.m1Closing = amountAfterLabel(lines, /Income \(page 1, line 28\)/i);
  }
  // Renglones que el tie-out compara contra el papel de trabajo. El lado de la declaracion lo
  // lee el codigo para que un TIE no pueda apoyarse en una cifra que la declaracion no dice.
  // El numero de linea cambia de año a año (el 1120-S paso de 20 a 21 para el total de
  // deducciones), asi que manda el rotulo y el numero se acepta cualquiera.
  out.grossReceipts = readLine(lines, /Gross receipts or sales/i, "1\\s*[ac]", page1);
  // Solo en su propio renglon: si el total esta en blanco, el renglon de abajo es el resultado
  // ordinario y un numero de linea comodin lo tomaria como si fueran las deducciones.
  out.totalDeductions = (() => {
    const line = lines.slice(page1.from, page1.to).find((l) => /Total deductions\.\s*Add/i.test(l));
    return line ? tailAmount(line, "\\d{1,2}") : null;
  })();
  out.costOfGoodsSold = readLine(lines, /Cost of goods sold \(attach Form 1125-A\)/i, "2", page1);
  const f1125e = sectionRange(lines, /Compensation of Officers\s*$|Form 1125-E/i, 60);
  out.officerComp1125E = f1125e ? readLine(lines, /Subtract line 3 from line 2\.\s*Enter the result here and on Form 1120/i, "4", f1125e) : null;
  const f1125a = sectionRange(lines, /Cost of Goods Sold\s*$|Form 1125-A/i, 60);
  out.inventoryBegin = f1125a ? readLine(lines, /Inventory at beginning of year/i, "1", f1125a) : null;
  out.inventoryEnd = f1125a ? readLine(lines, /Inventory at end of year/i, "7", f1125a) : null;
  // Codigo de actividad: seis digitos en los renglones que siguen al rotulo.
  const codeLabel = lines.findIndex((l, k) => k >= page1.from && k < page1.to && /Business (?:code number|activity code)/i.test(l));
  out.businessCode = null;
  if (codeLabel >= 0) {
    for (const l of lines.slice(codeLabel, codeLabel + 4)) {
      const m = /(?:^|\s)(\d{6})(?:\s|$)/.exec(l.replace(/\b\d{2}-\d{7}\b/g, " "));
      if (m && m[1] !== "651123") { out.businessCode = m[1]; break; }
    }
  }
  const scheduleL = sectionRange(lines, /Schedule L\s+Balance Sheets per Books/i, 60);
  if (scheduleL) {
    const pair = (re) => {
      const line = lines.slice(scheduleL.from, scheduleL.to).find((l) => re.test(l));
      if (!line) return null;
      const values = (line.slice(line.search(re)).match(/-?\(?(?:\d{1,3}(?:,\d{3})+|\d+)\)?\.?/g) || [])
        .map((v) => parseMoney(v.replace(/\.$/, ""))).filter((v) => v !== null && Math.abs(v) >= 10);
      return values.length >= 2 ? { beginning: values[values.length - 2], ending: values[values.length - 1] } : values.length === 1 ? { beginning: null, ending: values[0] } : null;
    };
    out.totalAssets = pair(/^\s*1[45]\s+Total assets/i);
    out.totalLiabilitiesAndCapital = pair(/^\s*(?:2[78]|22)\s+Total liabilities and (?:capital|shareholders|equity)/i);
    out.partnersCapital = pair(/^\s*21\s+Partners'? capital accounts/i);
    out.retainedEarnings = pair(/^\s*25\s+Retained earnings\W{0,4}Unappropriated/i);
  }
  out.m2Beginning = null; out.m2Ending = null; out.m2EndingFirstColumn = null;
  out.m2Combined = null; out.m2Distributions = null;
  const m2 = sectionRange(lines, /Schedule M-2\s+Analysis of/i, 24);
  if (m2) {
    const begin = m2Values(lines, /^\s*1\s+Balance at beginning of (?:tax )?year/i, m2);
    const end = m2Values(lines, /Balance at end of (?:tax )?year/i, m2);
    out.m2Beginning = begin && begin.length ? begin[0] : null;
    out.m2Ending = end && end.length ? end[end.length - 1] : null;
    out.m2EndingFirstColumn = end && end.length ? end[0] : null;
    if (type === "1120-S") {
      const combined = m2Values(lines, /^\s*6\s+Combine lines 1 through 5/i, m2);
      const dist = m2Values(lines, /^\s*7\s+Distributions\b/i, m2);
      out.m2Combined = combined && combined.length ? combined[0] : null;
      out.m2Distributions = dist && dist.length ? dist[0] : null;
    }
  }
  return out;
}

/** Si la declaracion incluye un formulario, por su direccion web o su titulo. */
function entityHasForm(text, form) {
  const body = String(text || "");
  const url = {
    "M-3": /Schedule M-3\s*\(Form (?:1065|1120-?S|1120)\)|Net Income \(Loss\) Reconciliation for/i,
    "B-1": /Schedule B-1\s*\(Form 1065\)|Information on Partners Owning 50% or\s+More|(?:^|\n)\s*SCHEDULE B-1\s+Information on Partners/i,
    "G": /Information on Certain Persons Owning the\s*(?:Corporation.s Voting Stock)?|Schedule G\s*\(Form 1120\)/i,
    "5472": /www\.irs\.gov\/Form5472\b|Information Return of a 25% Foreign-Owned/i,
    "3804": /Pass-Through Entity Elective Tax Calculation|FTB 3804|Form 3804/i,
    "4797": /Sales of Business Property\s*\n?\s*(?:\(?Also Involuntary|Form 4797)|www\.irs\.gov\/Form4797\b/i,
    "8594": /Asset Acquisition Statement\s*(?:\n|\s)*Under Section 1060|www\.irs\.gov\/Form8594\b/i,
    "8824": /Like-Kind Exchanges\s*(?:\n|\s)*\(?and section 1043|www\.irs\.gov\/Form8824\b/i,
    "8990": /Limitation on Business Interest Expense Under Section 163\(j\)|www\.irs\.gov\/Form8990\b/i,
  }[form];
  return url ? url.test(body) : false;
}

module.exports = {
  entityType, entityEin, issuedK1s, receivedK1s, entityLines, entityHasForm, percents, tailAmount,
  statementNames, answerAfter, returnBoxes, amountAfterLabel, endingShare, isEin,
};
