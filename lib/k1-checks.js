"use strict";

/**
 * k1-checks.js — cada K-1 del paquete contra el renglon del 1040 donde tiene que caer.
 *
 * Por que en codigo: una declaracion personal con dieciseis K-1 trae doscientas cifras para
 * repartir entre el Schedule E, el Schedule D, el Form 6781, el Schedule A y la estatal. El
 * modelo recibe el paquete recortado por el techo de gasto y, aun cuando lee un K-1, no suma
 * casilla por casilla. En la declaracion que motivo este modulo una perdida de la seccion 1256
 * entro como ganancia, las deducciones 13ZZ de seis fondos no se dedujeron, las deducciones de
 * cartera suspendidas si se dedujeron, el ingreso 11ZZ de dos K-1 no se declaro, la
 * recaracterizacion de la seccion 1061 no se hizo y el credito PTET de Nueva York no se
 * reclamo. Seis errores de suma o de signo, y la revision no encontro ninguno.
 *
 * Que se lee: los anexos del K-1 ("BOX 13, CODE ZZ - OTHER ... TOTAL OTHER 21,500"), que cada
 * emisor imprime con la casilla y el codigo escritos. La caratula no: ahi el codigo y el importe
 * quedan sueltos, y "ZZ" puede ser de la casilla 11, de la 13 o de la 20.
 *
 * Mismo criterio que el resto del directorio: un ancla que no se deja leer no produce hallazgo,
 * y un importe que aparece en cualquier parte de la declaracion se da por cargado.
 */

const { splitReturns } = require("./prior-year-bridge");
const { amountAppearsInText } = require("./tie-out");
const rf = require("./return-facts");
const pd = require("./package-docs");

const fmt = (n) => `$${Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US")}`;
const signed = (n) => (n < 0 ? `(${fmt(n)})` : fmt(n));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// Un rotulo citado va sin los puntos de sus abreviaturas ("INVESTMENT EXP. FROM K-1"): el
// informe recorta por oraciones y un punto en el medio le corta la frase al hallazgo.
const plainLabel = (s) => String(s || "").replace(/\.(?=\s|$)/g, "").trim();

function finding(severity, category, title, detail, action, authority, evidence) {
  return { severity, category, title, detail, action, authority, evidence };
}

/* ---------------------------------------------------------------------------
 * Lectura del K-1
 * ------------------------------------------------------------------------- */

/** El importe con que termina un renglon de anexo: 21,500 / (1,300) / -215. */
function amountAtEnd(line) {
  const m = /(?:^|\s)(\(?-?\$?\d[\d,]*(?:\.\d+)?\)?)\s*$/.exec(String(line || ""));
  if (!m) return null;
  // "FROM LINE 1" o "LINES 5 AND 6" terminan en un numero de linea, no en un importe.
  if (/\b(?:LINES?|AND)\s*$/i.test(line.slice(0, m.index + m[0].indexOf(m[1])))) return null;
  const raw = m[1];
  const digits = raw.replace(/[()$,\s-]/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const value = Number(digits);
  return /^\(.*\)$/.test(raw) || raw.startsWith("-") ? -value : value;
}

const STATEMENT_HEADER = /^(?:BOX|LINE)\s+(\d{1,2})[A-Z]?\s*,?\s*CODE\s+([A-Z]{1,2})\s*[-–—:]\s*(.*)$/i;
const STATEMENT_END = /^(?:SPLITHERE|Page \d+ of \d+|PART\s+[IVX]+\b|SCHEDULE K-1|ADDITIONAL INFORMATION|DISTRIBUTIONS\b|SELF-EMPLOYMENT)/i;

/**
 * Los anexos de un K-1, uno por casilla y codigo:
 *   { box: "13", code: "ZZ", label: "OTHER", total: 21500, items: [{ label, amount }] }
 * El total es el del renglon TOTAL; si el anexo es de un solo renglon, el del encabezado.
 */
function k1Statements(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim());
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const head = STATEMENT_HEADER.exec(lines[i]);
    if (!head) continue;
    const key = `${head[1]}|${head[2].toUpperCase()}`;
    if (seen.has(key)) continue;
    const onHeader = amountAtEnd(head[3]);
    const label = (onHeader === null ? head[3] : head[3].replace(/\s*\(?-?\$?\d[\d,]*(?:\.\d+)?\)?\s*$/, "")).trim();
    const items = [];
    let total = onHeader;
    for (let j = i + 1; onHeader === null && j < Math.min(i + 14, lines.length); j += 1) {
      const line = lines[j];
      if (!line || STATEMENT_HEADER.test(line) || STATEMENT_END.test(line)) break;
      const amount = amountAtEnd(line);
      if (amount === null) continue;
      if (/^TOTAL\b/i.test(line)) { total = amount; break; }
      items.push({ label: line.replace(/\s*\(?-?\$?\d[\d,]*(?:\.\d+)?\)?\s*$/, "").trim(), amount });
    }
    if (total === null && items.length) total = items.reduce((sum, item) => sum + item.amount, 0);
    if (total === null) continue;
    seen.add(key);
    out.push({ box: head[1], code: head[2].toUpperCase(), label, total, items });
  }
  return out;
}

/** El nombre de la sociedad, del item B de la caratula. */
function partnershipName(text) {
  const m = /B\s+Partnership[’']s name, address, city, state, and ZIP code\s*\n([^\n]+)/i.exec(String(text || ""));
  if (!m) return "";
  // La caratula sigue en el mismo renglon con la casilla de al lado ("... 4c Total guaranteed payments").
  return m[1].replace(/\s+\d{1,2}[a-c]?\s+(?:Guaranteed|Total|Interest|Ordinary|Net|Other|Schedule|Section|Royalties|Dividend|Qualified|Collectibles|Unrecaptured)\b.*$/i, "").trim().slice(0, 60);
}

/** El primer renglon en mayusculas de un anexo suelto: el nombre de la sociedad. */
function firstHeading(text) {
  const line = String(text || "").split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^--- Page \d+ ---$/.test(l));
  return line && /^[A-Z0-9][A-Z0-9 ,.&'-]{4,60}$/.test(line) ? line : "";
}

/** Section 1061 Worksheet A: lineas 4 (un año) y 7 (tres años) del API. */
function worksheetA(text) {
  const lines = String(text || "").split(/\r?\n/);
  const read = (line) => (/\b(?:NONE|N\/A)\s*$/i.test(line || "") ? 0 : amountAtEnd(line || ""));
  const after = (label) => {
    const i = lines.findIndex((l) => label.test(l));
    if (i < 0) return null;
    const here = read(lines[i]);
    return here !== null ? here : read(lines[i + 1]);
  };
  const oneYear = after(/API ONE YEAR DISTRIBUTIVE SHARE AMOUNT/i);
  const threeYear = after(/API THREE YEAR DISTRIBUTIVE SHARE AMOUNT/i);
  return oneYear === null || threeYear === null ? null : { oneYear, threeYear };
}

/** Creditos PTET de Nueva York: IT-204-IP linea 47, codigos 653 (estado) y B53 (ciudad). */
function nyPtetCredits(text) {
  let state = 0; let city = 0;
  for (const m of String(text || "").matchAll(/\b47[a-f]\s+(653|B53)\s+([\d,]+)(?:\.\d{2})?\b/g)) {
    const amount = Number(m[2].replace(/,/g, ""));
    if (m[1] === "653") state += amount; else city += amount;
  }
  return { state, city };
}

/** Los K-1 del paquete, leidos una vez. Un archivo repetido cuenta una sola vez. */
function readK1s(docs, taxYear) {
  const seen = new Set();
  const out = [];
  for (const d of docs) {
    if (!d.text || (d.year && taxYear && d.year !== taxYear)) continue;
    const isK1 = d.types.includes("k1");
    const sheet = /API ONE YEAR DISTRIBUTIVE SHARE AMOUNT/i.test(d.text) ? worksheetA(d.text) : null;
    if (!isK1 && !sheet) continue;
    const key = `${d.text.length}|${d.text.slice(0, 300)}|${d.text.slice(-300)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const statements = isK1 ? k1Statements(d.text) : [];
    out.push({
      file: d.name,
      name: partnershipName(d.text) || firstHeading(d.text) || d.name,
      statements,
      of: (box, test) => statements.filter((s) => s.box === box && test(s)),
      worksheetA: sheet,
      nonpassive: /ON SCHEDULE E, PART II AS NONPASSIVE|NON-PASSIVE ACTIVITY DISCLOSURE/i.test(d.text),
      ptet: isK1 ? nyPtetCredits(d.text) : { state: 0, city: 0 },
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Lectura de la declaracion
 * ------------------------------------------------------------------------- */

/** Form 6781, linea 2: la columna de perdidas (entre parentesis) y la de ganancias; linea 3, el neto. */
function form6781(text) {
  const lines = rf.linesOf(text);
  const i = lines.findIndex((l) => /Add the amounts on line 1 in columns \(b\) and \(c\)/i.test(l));
  if (i < 0) return null;
  const tail = /\b2\s*(?:\(\s*([\d,]*)\.?\s*\))?\s*([\d,]+)?\.?\s*$/.exec(lines[i]);
  if (!tail) return null;
  const num = (s) => (s ? Number(s.replace(/,/g, "")) : 0);
  const loss = num(tail[1]);
  const gain = num(tail[2]);
  if (!loss && !gain) return null;
  return { loss, gain, net: gain - loss };
}

/** Schedule E, linea 31: todas las perdidas de sociedades que la declaracion deduce. */
function scheduleELosses(text) {
  for (const line of rf.linesOf(text)) {
    const m = /Add columns \(g\), \(i\), and \(j\) of line 29b[^\n]*?\b31\s*\(?\s*([\d,]*)\.?\s*\)?\s*$/i.exec(line);
    if (m) return m[1] ? Number(m[1].replace(/,/g, "")) : 0;
  }
  return null;
}

/** Schedule A, linea 16: lo que el preparador escribio como "other itemized deductions". */
function scheduleALine16(text) {
  const lines = rf.linesOf(text);
  const start = lines.findIndex((l) => /\b16\s+Other\b.*from list in instructions/i.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < Math.min(start + 10, lines.length); i += 1) {
    if (/^\s*16\s+[\d,]+\.?\s*$/.test(lines[i]) || /^\s*(?:Total\s+)?17\s+Add the amounts/i.test(lines[i])) break;
    const amount = amountAtEnd(lines[i].replace(/\.\s*$/, ""));
    const label = lines[i].replace(/\s*[\d,]+\.?\s*$/, "").trim();
    if (amount !== null && amount > 0 && /[A-Za-z]{3}/.test(label)) out.push({ label, amount });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * 1. Seccion 1256 (casilla 11, codigo C) contra el Form 6781
 * ------------------------------------------------------------------------- */

function check1256(k1s, text) {
  const amounts = k1s.flatMap((k) => k.of("11", (s) => s.code === "C" || /1256/.test(s.label)).map((s) => ({ name: k.name, amount: s.total })));
  const form = form6781(text);
  if (!amounts.length || !form) return null;
  const losses = amounts.filter((a) => a.amount < 0).reduce((sum, a) => sum - a.amount, 0);
  const gains = amounts.filter((a) => a.amount > 0).reduce((sum, a) => sum + a.amount, 0);
  const tolerance = amounts.length; // cada K-1 se redondea al dolar
  if (Math.abs(form.loss - losses) <= tolerance && Math.abs(form.gain - gains) <= tolerance) return null;
  // Un K-1 cargado con el signo cambiado: su importe pasa entero de una columna a la otra.
  const flipped = amounts.find((a) => Math.abs(a.amount) >= 1 && (
    a.amount < 0
      ? Math.abs(form.loss - (losses + a.amount)) <= tolerance && Math.abs(form.gain - (gains - a.amount)) <= tolerance
      : Math.abs(form.gain - (gains - a.amount)) <= tolerance && Math.abs(form.loss - (losses + a.amount)) <= tolerance
  ));
  if (!flipped) return null;
  const net = gains - losses;
  const was = flipped.amount < 0 ? "loss" : "gain";
  const became = flipped.amount < 0 ? "gain" : "loss";
  return finding(
    Math.abs(flipped.amount) >= 500 ? "HIGH" : "MEDIUM", "K-1 tie-out",
    `Form 6781 — section 1256 ${was} from a K-1 entered as a ${became}`,
    `Form 6781 reports the section 1256 ${was} of ${fmt(flipped.amount)} from ${flipped.name} (K-1 box 11, code C) as a ${became}. The K-1s in the package add to a net ${net < 0 ? "loss" : "gain"} of ${fmt(net)} and Form 6781 line 3 shows a net ${form.net < 0 ? "loss" : "gain"} of ${fmt(form.net)}: capital ${flipped.amount < 0 ? "gain is overstated" : "gain is understated"} by ${fmt(2 * flipped.amount)}.`,
    `Enter the amount from ${flipped.name} in the ${was} column of Form 6781 line 1 and let lines 8 and 9 flow again to Schedule D.`,
    "IRC §1256; Form 6781 instructions; Schedule K-1 (Form 1065) box 11, code C",
    `K-1 box 11, code C: ${amounts.map((a) => `${a.name} ${signed(a.amount)}`).join("; ")}. Form 6781 line 2: loss ${fmt(form.loss)}, gain ${fmt(form.gain)}.`,
  );
}

/* ---------------------------------------------------------------------------
 * 2. Deducciones 13ZZ de un fondo que opera como trader, sin deducir
 * ------------------------------------------------------------------------- */

/** ¿La cifra, o alguno de sus componentes de mil o mas, esta en la declaracion? */
function carried(statement, text) {
  if (amountAppearsInText(statement.total, text)) return true;
  return statement.items.some((item) => Math.abs(item.amount) >= 1000 && amountAppearsInText(item.amount, text));
}

function checkOtherDeductions(k1s, text) {
  const allowed = scheduleELosses(text);
  if (allowed === null) return null;
  const missing = [];
  for (const k of k1s.filter((x) => x.nonpassive)) {
    for (const s of k.of("13", (x) => x.code === "ZZ" && /^OTHER\b/i.test(x.label))) {
      if (s.total >= 1000 && !carried(s, text)) missing.push({ name: k.name, amount: s.total, items: s.items });
    }
  }
  const total = missing.reduce((sum, m) => sum + m.amount, 0);
  // Si entraran en lo que el Schedule E ya deduce, no se puede afirmar que faltan.
  if (!missing.length || total <= allowed) return null;
  return finding(
    total >= 5000 ? "HIGH" : "MEDIUM", "K-1 tie-out",
    "Schedule E — K-1 box 13, code ZZ deductions of trading partnerships not deducted",
    `${plural(missing.length, "K-1")} from partnerships that trade securities report ${fmt(total)} of box 13, code ZZ deductions, which their own notes say an individual enters on Schedule E, Part II as nonpassive. Schedule E line 31 deducts ${fmt(allowed)} of partnership losses in total and none of those amounts is on the return.`,
    "Enter each K-1's box 13, code ZZ amount on Schedule E, Part II, column (i) as the K-1 notes direct (business interest expense, trader expenses and pass-through entity tax), then re-run AGI, the net investment income tax and the state return.",
    "Temp. Reg. §1.469-1T(e)(6); Schedule K-1 (Form 1065) box 13, code ZZ and the partnership's statement",
    `K-1 box 13, code ZZ: ${missing.map((m) => `${m.name} ${fmt(m.amount)}`).join("; ")}. Schedule E line 31: ${fmt(allowed)}.`,
  );
}

/* ---------------------------------------------------------------------------
 * 3. Deducciones de cartera del K-1 (suspendidas) deducidas en el Schedule A
 * ------------------------------------------------------------------------- */

function checkPortfolioDeductions(k1s, text) {
  const portfolio = k1s.flatMap((k) => k.of("13", (s) => /DEDUCTIONS?\s*[-–—]?\s*PORTFOLIO/i.test(s.label)).map((s) => ({ name: k.name, amount: s.total })));
  const total = portfolio.reduce((sum, p) => sum + p.amount, 0);
  if (total < 100) return null;
  const entry = scheduleALine16(text).find((e) => Math.abs(e.amount - total) <= portfolio.length);
  if (!entry) return null;
  return finding(
    total >= 5000 ? "HIGH" : "MEDIUM", "K-1 tie-out",
    "Schedule A line 16 — K-1 portfolio deductions deducted",
    `Schedule A line 16 deducts ${fmt(entry.amount)} as "${plainLabel(entry.label)}". That is the total of the K-1 box 13 portfolio deductions (${plural(portfolio.length, "K-1")}), which individuals cannot deduct: section 67(g) suspends miscellaneous itemized deductions, and the K-1 notes say so.`,
    "Remove the amount from Schedule A line 16. Line 16 is only for the items its instructions list (gambling losses, casualty losses of income-producing property, estate tax on income in respect of a decedent and the like).",
    "IRC §67(g); Schedule A instructions, line 16; Schedule K-1 (Form 1065) box 13 statement",
    `K-1 box 13 portfolio deductions: ${portfolio.map((p) => `${p.name} ${fmt(p.amount)}`).join("; ")}.`,
  );
}

/* ---------------------------------------------------------------------------
 * 4. "Other income" de la casilla 11 que no llego a la declaracion
 * ------------------------------------------------------------------------- */

function checkOtherIncome(k1s, text) {
  const missing = [];
  for (const k of k1s) {
    for (const s of k.of("11", (x) => x.code === "ZZ" && /^OTHER\b/i.test(x.label))) {
      if (Math.abs(s.total) < 1000 || carried(s, text)) continue;
      const what = s.items.length === 1 ? s.items[0].label.replace(/\s*-\s*(?:FROM FLOW-?THROUGH.*|US)$/i, "").toLowerCase() : "";
      missing.push({ name: k.name, amount: s.total, what });
    }
  }
  if (!missing.length) return null;
  missing.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const net = missing.reduce((sum, m) => sum + m.amount, 0);
  const shown = missing.slice(0, 3).map((m) => `${m.name} ${signed(m.amount)}${m.what ? ` (${m.what})` : ""}`).join("; ");
  return finding(
    Math.abs(missing[0].amount) >= 10000 ? "HIGH" : "MEDIUM", "K-1 tie-out",
    "Schedule K-1 box 11, code ZZ — other income not found on the return",
    `K-1 box 11, code ZZ "other income (loss)" was not found on the return: ${shown}${missing.length > 3 ? `; and ${missing.length - 3} more` : ""}. ${missing.length === 1 ? "The figure does" : "None of these figures"} ${missing.length === 1 ? "not appear" : "appears"} on Schedule 1, Schedule E or their statements (net ${signed(net)}).`,
    "Report each amount where the K-1 statement directs (Schedule 1 line 8z or Schedule E, Part II for ordinary items; Form 4797 for section 751 gain). If an amount was combined with another line, note where.",
    "IRC §702(a); Schedule K-1 (Form 1065) box 11, code ZZ and the partnership's statement",
    `K-1 box 11, code ZZ: ${missing.map((m) => `${m.name} ${signed(m.amount)}`).join("; ")}.`,
  );
}

/* ---------------------------------------------------------------------------
 * 5. Seccion 1061: ganancia de un API de mas de un año y menos de tres
 * ------------------------------------------------------------------------- */

function check1061(k1s, text) {
  const sheets = k1s.filter((k) => k.worksheetA && (k.worksheetA.oneYear || k.worksheetA.threeYear));
  if (!sheets.length || /\b1061\b/.test(text)) return null;
  const oneYear = sheets.reduce((sum, k) => sum + k.worksheetA.oneYear, 0);
  const threeYear = sheets.reduce((sum, k) => sum + k.worksheetA.threeYear, 0);
  const recharacterized = oneYear - threeYear;
  if (recharacterized < 1000) return null;
  return finding(
    recharacterized >= 10000 ? "HIGH" : "MEDIUM", "K-1 tie-out",
    "Schedule D — section 1061 recharacterization of carried interest not made",
    `Section 1061 Worksheet A on ${plural(sheets.length, "K-1")} shows ${fmt(oneYear)} of long-term gain on applicable partnership interests, of which ${signed(threeYear)} is from assets held more than three years: about ${fmt(recharacterized)} is taxed as short-term. The return shows no section 1061 adjustment and attaches no Worksheet A or B.`,
    "Complete Worksheet B, report the recharacterization amount as a short-term gain and an equal long-term reduction on Form 8949 (\"Section 1061 Adjustment\"), and attach Worksheets A and B. Confirm which interests are applicable partnership interests and whether each spouse is figured separately.",
    "IRC §1061; Treas. Reg. §1.1061-4 and §1.1061-6; IRS section 1061 reporting guidance (Worksheets A and B)",
    `Worksheet A, line 4 (one year) and line 7 (three year): ${sheets.map((k) => `${k.name} ${signed(k.worksheetA.oneYear)} / ${signed(k.worksheetA.threeYear)}`).join("; ")}.`,
  );
}

/* ---------------------------------------------------------------------------
 * 6. Credito PTET de Nueva York informado en los K-1 y sin reclamar
 * ------------------------------------------------------------------------- */

function checkNyPtetCredit(k1s, text) {
  const withCredit = k1s.filter((k) => k.ptet.state + k.ptet.city > 0);
  const state = withCredit.reduce((sum, k) => sum + k.ptet.state, 0);
  const city = withCredit.reduce((sum, k) => sum + k.ptet.city, 0);
  if (state + city < 100) return null;
  // Tiene que haber una declaracion de residente de Nueva York, y sin el formulario del credito.
  if (!/\bIT-201\b/.test(text) || /\bIT-653\b/.test(text)) return null;
  const line71 = rf.linesOf(text).map((l) => /Other refundable credits \(Form IT-201-ATT, line 18\)[^\n]*?\b71\s+([\d,]*)\s*\.00/i.exec(l)).find(Boolean);
  if (line71 && Number((line71[1] || "0").replace(/,/g, "")) > 0) return null;
  return finding(
    state + city >= 1000 ? "HIGH" : "MEDIUM", "K-1 tie-out",
    "Form IT-653 — New York pass-through entity tax credit not claimed",
    `${plural(withCredit.length, "K-1")} report New York pass-through entity tax credits on Form IT-204-IP line 47: ${fmt(state)} for the state (code 653)${city ? ` and ${fmt(city)} for New York City (code B53)` : ""}. The New York return has no Form IT-653 and claims no refundable credit on line 71.`,
    "Claim the credits on Form IT-653 (through Form IT-201-ATT to IT-201 line 71) and make the related addition modification on Form IT-225 for the tax deducted federally.",
    "N.Y. Tax Law §863 and §606(kkk); Form IT-653 instructions",
    `Form IT-204-IP line 47: ${withCredit.map((k) => `${k.name} ${fmt(k.ptet.state)}${k.ptet.city ? ` + ${fmt(k.ptet.city)}` : ""}`).join("; ")}.`,
  );
}

/* ---------------------------------------------------------------------------
 * Todos juntos
 * ------------------------------------------------------------------------- */

function runK1Checks(files, meta = {}) {
  const { current, prior } = splitReturns(files, meta);
  if (!current) return [];
  const text = rf.textOf(current);
  if (!rf.isForm1040(text)) return [];
  const taxYear = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]) || rf.form1040Year(text) || null;
  const k1s = readK1s(pd.packageDocuments(files, { exclude: new Set([current, prior].filter(Boolean)) }), taxYear);
  if (!k1s.length) return [];
  const out = [];
  for (const check of [check1256, checkOtherDeductions, checkPortfolioDeductions, checkOtherIncome, check1061, checkNyPtetCredit]) {
    // Cada cruce por separado: una lectura que falla no se lleva puestos a los demas.
    try { const found = check(k1s, text); if (found) out.push(found); } catch (_) { /* sin hallazgo */ }
  }
  return out;
}

module.exports = {
  runK1Checks, k1Statements, worksheetA, nyPtetCredits, partnershipName, amountAtEnd,
  form6781, scheduleELosses, scheduleALine16, readK1s,
  check1256, checkOtherDeductions, checkPortfolioDeductions, checkOtherIncome, check1061, checkNyPtetCredit,
};
