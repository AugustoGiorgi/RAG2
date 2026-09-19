"use strict";

/**
 * return-facts.js — lo que dice una declaracion, leido una vez y con reglas fijas.
 *
 * Los cruces necesitan las mismas cifras una y otra vez: el renglon 24 del 1040, el 36 del año
 * anterior, los SSN del encabezado, que formularios trae. Cada modulo las leia a su manera; este
 * las lee en un solo lugar para que todos los cruces nuevos compartan el mismo criterio.
 *
 * Como lee. El texto sale de pdf.js agrupado por renglon, y los formularios del IRS imprimen el
 * importe al final del renglon precedido por el numero de linea repetido: "... total tax . . .
 * 24 139,517." Cuando el rotulo ocupa dos renglones, el importe cae en el siguiente. Se busca el
 * rotulo exacto del formulario y despues el numero de linea con su importe; si no aparece, el
 * dato queda en null. Nunca se adivina: un renglon vacio no es un cero.
 */

const { parseMoney } = require("./prior-year-bridge");

const textOf = (f) => String((f && (f.originalText || f.fullText || f.text || f.extractedText)) || "");
const linesOf = (text) => String(text || "").split(/\r?\n/);

const AMOUNT_SRC = "-?\\(?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?\\)?";

/**
 * El importe que sigue al numero de linea al final de un renglon: "... 24 139,517." Una perdida
 * puede venir entre parentesis y con espacios adentro: "21 ( 3,000. )".
 */
function tailAmount(line, lineNo) {
  const text = String(line || "");
  const paren = new RegExp(`(?:^|\\s)${lineNo}\\s+\\(\\s*((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?)\\.?\\s*\\)\\s*$`).exec(text);
  if (paren) return -parseMoney(paren[1]);
  const re = new RegExp(`(?:^|\\s)${lineNo}\\s+(${AMOUNT_SRC})\\.?\\s*$`);
  const m = re.exec(text);
  return m ? parseMoney(m[1].replace(/\.$/, "")) : null;
}

/**
 * El importe de un renglon de formulario. `label` ubica el renglon; el importe va despues del
 * numero de linea repetido en ese renglon o en los dos siguientes. Sin numero repetido, solo se
 * acepta un importe con separador de miles al final del propio renglon.
 */
function lineAmount(lines, label, lineNo, { from = 0, to = lines.length } = {}) {
  for (let i = from; i < Math.min(to, lines.length); i += 1) {
    if (!label.test(lines[i])) continue;
    for (let j = i; j < Math.min(i + 3, lines.length); j += 1) {
      const hit = tailAmount(j === i ? lines[j].slice(lines[j].search(label) + 1) : lines[j], lineNo);
      if (hit !== null) return hit;
      if (j > i && /^\s*\d{1,2}[a-z]?\s+[A-Z]/.test(lines[j])) break; // empezo otro renglon del formulario
    }
    const own = /((?:\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?)\.?\s*$/.exec(lines[i]);
    return own ? parseMoney(own[1]) : null;
  }
  return null;
}

/** Dos casillas en un mismo renglon: "2a Tax-exempt interest . . 2a 1,258. b Taxable interest . . 2b 5,623." */
function pairedAmounts(lines, label, first, second) {
  const i = lines.findIndex((l) => label.test(l));
  if (i < 0) return [null, null];
  const line = lines[i];
  const pick = (no) => {
    const m = new RegExp(`(?:^|\\s)${no}\\s+(${AMOUNT_SRC})\\.?(?=\\s|$)`).exec(line);
    return m ? parseMoney(m[1].replace(/\.$/, "")) : null;
  };
  return [pick(first), pick(second)];
}

/* ---------------------------------------------------------------------------
 * Form 1040
 * ------------------------------------------------------------------------- */

const LINE_1040 = [
  ["1a", /Total amount from Form\(s\) W-2, box 1/i, "1a"],
  ["1z", /\bz\s+Add lines 1a through 1h/i, "1z"],
  ["7", /Capital gain or \(loss\)\.\s*Attach Schedule D/i, "7a?"],
  ["8", /Additional income from Schedule 1, line 10/i, "8"],
  ["9", /This is your total income/i, "9"],
  ["10", /Adjustments to income from Schedule 1, line 26/i, "10"],
  ["11", /Subtract line 10 from line 9\.\s*This is your adjusted gross income/i, "11a?"],
  ["12", /Standard deduction or itemized deductions \(from Schedule A\)/i, "12e?"],
  ["13", /Qualified business income deduction from Form 8995/i, "13a?"],
  ["13b", /Additional deductions from Schedule 1-A, line 38/i, "13b"],
  ["15", /This is your taxable income/i, "15"],
  ["16", /\b16\s+Tax \(see instructions\)/i, "16"],
  ["19", /Child tax credit or credit for other dependents from Schedule 8812/i, "19"],
  ["22", /Subtract line 21 from line 18/i, "22"],
  ["23", /Other taxes, including self-employment tax, from Schedule 2/i, "23"],
  ["24", /Add lines 22 and 23\.\s*This is your total tax/i, "24"],
  ["25a", /\ba\s+Form\(s\) W-2 [. ]/i, "25a"],
  ["25b", /\bb\s+Form\(s\) 1099 [. ]/i, "25b"],
  ["25c", /\bc\s+Other forms \(see instructions\)/i, "25c"],
  ["25d", /Add lines 25a through 25c/i, "25d"],
  ["26", /estimated tax payments and amount applied from \d{4} return/i, "26"],
  ["27", /Earned income credit \(EIC\)/i, "27\\s?a?"],
  ["28", /Additional child tax credit (?:\(ACTC\) )?from Schedule 8812/i, "28"],
  ["29", /American opportunity credit from Form 8863, line 8/i, "29"],
  ["31", /Amount from Schedule 3, line 15/i, "31"],
  ["33", /These are your total payments/i, "33"],
  ["34", /This is the amount you overpaid/i, "34"],
  ["35a", /Amount of line 34 you want refunded to you/i, "35a"],
  ["36", /Amount of line 34 you want applied to your \d{4} estimated tax/i, "36"],
  ["37", /Subtract line 33 from line 24\.\s*This is the amount you owe/i, "37"],
  ["38", /Estimated tax penalty \(see instructions\)/i, "38"],
];

const PAIRS_1040 = [
  ["2a", "2b", /\b2\s*a\s+Tax-exempt interest/i],
  ["3a", "3b", /\b3\s*a\s+Qualified dividends/i],
  ["4a", "4b", /\b4\s*a\s+IRA distributions/i],
  ["5a", "5b", /\b5\s*a\s+Pensions and annuities/i],
  ["6a", "6b", /\b6\s*a\s+Social security benefits/i],
];

function isForm1040(text) {
  return /U\.\s?S\.\s+Individual Income Tax Return/i.test(String(text || "").slice(0, 600000));
}

/**
 * Donde esta el 1040 dentro del PDF. La carta al cliente y las estatales tambien dicen "Your
 * first name" o "Individual Income Tax Return"; el formulario federal es el titulo con "U.S."
 * seguido, a pocos renglones, del encabezado del contribuyente.
 */
function form1040Range(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (!/U\.\s?S\.\s+Individual Income Tax Return/i.test(lines[i])) continue;
    const you = lines.slice(i, i + 30).findIndex((l) => /Your first name and middle initial/i.test(l));
    if (you >= 0) return { from: i, to: Math.min(lines.length, i + 320), you: i + you };
  }
  return null;
}

/** Los renglones del 1040, en el tramo donde esta el formulario (no en las hojas de trabajo). */
function form1040Lines(text) {
  const lines = linesOf(text);
  const range = form1040Range(lines);
  if (!range) return {};
  const { from, to } = range;
  const out = {};
  for (const [key, label, lineNo] of LINE_1040) out[key] = lineAmount(lines, label, lineNo, { from, to });
  for (const [a, b, label] of PAIRS_1040) {
    const i = lines.slice(from, to).findIndex((l) => label.test(l));
    const [x, y] = i >= 0 ? pairedAmounts(lines.slice(from + i, from + i + 1), label, a, b) : [null, null];
    out[a] = x;
    out[b] = y;
  }
  return out;
}

/** El año que imprime el pie del 1040: "Form 1040 (2025)". */
function form1040Year(text) {
  const m = /Form 1040\s*\((20\d{2})\)/.exec(String(text || ""));
  return m ? Number(m[1]) : null;
}

// Con guiones o con espacios, segun el programa: "386-29-0129" o "386 29 0129".
const SSN = /\b(\d{3})[- ](\d{2})[- ](\d{4})\b/;
const SSN_ALL = /\b(\d{3})[- ](\d{2})[- ](\d{4})\b/g;
const normSsn = (a, b, c) => `${a}-${b}-${c}`;
const STATUSES = [
  ["single", /\bX\s+Single\b/i],
  ["mfj", /\bX\s+Married filing jointly\b/i],
  ["mfs", /\bX\s+Married filing separately\b/i],
  ["hoh", /\bX\s+Head of household\b/i],
  ["qss", /\bX\s+Qualifying (?:surviving spouse|widow)/i],
];

/** Encabezado del 1040: contribuyente, conyuge, estado civil, domicilio y SSN de dependientes. */
function header1040(text) {
  const lines = linesOf(text);
  const range = form1040Range(lines);
  if (!range) return null;
  const you = range.you;
  const pick = (i) => {
    const line = lines[i] || "";
    const m = SSN.exec(line);
    return m ? { ssn: normSsn(m[1], m[2], m[3]), name: line.slice(0, m.index).trim() } : null;
  };
  const taxpayer = pick(you + 1);
  const spouseLabel = lines.findIndex((l, i) => i > you && i < you + 6 && /spouse.s first name/i.test(l));
  const spouse = spouseLabel >= 0 ? pick(spouseLabel + 1) : null;
  const statusBlock = lines.slice(you, you + 30).join("\n");
  const status = (STATUSES.find(([, re]) => re.test(statusBlock)) || [null])[0];
  // Domicilio: el renglon que sigue al rotulo, sin el texto del formulario que comparte renglon.
  const addrLabel = lines.findIndex((l, i) => i > you && i < you + 8 && /Home address \(number and street\)/i.test(l));
  let address = "";
  if (addrLabel >= 0) {
    const candidate = lines.slice(addrLabel + 1, addrLabel + 4).find((l) => /^\s*\d{1,6}\s+\S/.test(l)) || "";
    address = candidate.replace(/\s+the U\.S\. for more than.*$/i, "").replace(/\s+Check here if.*$/i, "").trim();
  }
  // "SPRINGFIELD, IL 62701" o, en otro programa, "Lakeview MI 490001234" (sin coma, ZIP+4 pegado).
  const CITY = /([A-Z][A-Za-z .'-]+?),?\s+([A-Z]{2})\s+(\d{5})(?:-?\d{4})?\b/;
  const cityLine = lines.slice(addrLabel >= 0 ? addrLabel + 1 : you, you + 14).find((l) => CITY.test(l) && !/City, town, or post office/i.test(l)) || "";
  const cityMatch = CITY.exec(cityLine);
  // Dependientes: todo SSN del bloque que no sea del contribuyente ni del conyuge.
  const depStart = lines.findIndex((l, i) => i > you && /^\s*Dependents\b/i.test(l));
  const depEnd = depStart >= 0 ? lines.findIndex((l, i) => i > depStart && /Total amount from Form\(s\) W-2|^\s*Income\b/i.test(l)) : -1;
  const own = new Set([taxpayer && taxpayer.ssn, spouse && spouse.ssn].filter(Boolean));
  const dependents = [];
  if (depStart >= 0) {
    for (const line of lines.slice(depStart, depEnd > depStart ? depEnd : depStart + 25)) {
      for (const m of line.matchAll(SSN_ALL)) {
        const ssn = normSsn(m[1], m[2], m[3]);
        if (!own.has(ssn) && !dependents.includes(ssn)) dependents.push(ssn);
      }
    }
  }
  return {
    taxpayer, spouse, filingStatus: status, address,
    city: cityMatch ? cityMatch[1].trim() : "", state: cityMatch ? cityMatch[2] : "", zip: cityMatch ? cityMatch[3] : "",
    dependents,
  };
}

/* ---------------------------------------------------------------------------
 * Formularios presentes
 * ------------------------------------------------------------------------- */

/** La lista de formularios que imprime el software: "FEDERAL: 1040, SCH 1, ..." (y su continuacion). */
function formsList(text) {
  const lines = linesOf(text);
  const out = {};
  lines.forEach((line, i) => {
    // Cada formulario puede tener hasta tres palabras: "SCH E P2", "SCH NJ-HCC".
    const m = /^\s*([A-Z][A-Z .]{2,30}):\s*((?:[A-Z0-9-]+(?:\s[A-Z0-9-]+){0,2},\s*)+[A-Z0-9-]+(?:\s[A-Z0-9-]+){0,2})\s*$/.exec(line);
    if (!m) return;
    let list = m[2];
    for (const next of lines.slice(i + 1, i + 4)) {
      if (/^\s*(?:[A-Z0-9-]+(?:\s[A-Z0-9-]+){0,2},\s*)*[A-Z0-9-]+(?:\s[A-Z0-9-]+){0,2}\s*$/.test(next) && /,/.test(next)) list += `, ${next.trim()}`;
      else break;
    }
    out[m[1].trim().toUpperCase()] = list.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  });
  return out;
}

/** Titulos de formulario que prueban que el formulario esta en la declaracion. */
const FORM_TITLES = {
  // Solo el encabezado del formulario: las instrucciones de otros formularios los nombran.
  "4797": /Sales of Business Property\s*\n?\s*(?:\(?Also Involuntary Conversions|Form 4797)|Form 4797[^\n]{0,60}\n\s*Sales of Business Property/i,
  "8949": /Form\s+8949[^\n]{0,120}\n?[^\n]{0,120}Sales and Other Dispositions of Capital Assets|Sales and Other Dispositions of Capital Assets\s*\n[^\n]{0,80}(?:OMB|Form 8949|File with your Schedule D)/i,
  "SCH D": /SCHEDULE D\b[^\n]*\n\s*(?:\(Form 1040\)\s*)?Capital Gains and Losses|Capital Gains and Losses\s*\n\s*\(Form 1040\)/i,
  "6252": /Installment Sale Income/i,
  "8962": /Premium Tax Credit \(PTC\)/i,
  "8889": /Health Savings Accounts \(HSAs\)/i,
  "8863": /Education Credits \(American Opportunity and Lifetime Learning Credits\)/i,
  "5329": /Additional Taxes on Qualified Plans/i,
  "8959": /Additional Medicare Tax\s*\n|Form 8959/i,
  "8960": /Net Investment Income Tax—\s*Individuals, Estates, and Trusts|Net Investment Income Tax -\s*Individuals/i,
  "8615": /Tax for Certain Children Who Have Unearned Income/i,
  "2210": /Underpayment of Estimated Tax by Individuals/i,
  "8938": /Statement of Specified Foreign Financial Assets/i,
  "1116": /Foreign Tax Credit\s*\((Individual|Individual, Estate, or Trust)\)/i,
  "4952": /Investment Interest Expense Deduction/i,
  "8990": /Limitation on Business Interest Expense Under Section 163\(j\)/i,
  "8801": /Credit for Prior Year Minimum Tax/i,
  "SCH C": /Profit or Loss From Business\s*\(Sole Proprietorship\)/i,
  "SCH SE": /SCHEDULE SE\s*\(Form 1040\)|Self-Employment Tax\s*\n[\s\S]{0,120}Attach to Form 1040/i,
  "SCH A": /SCHEDULE A\s*\(Form 1040\)|Itemized Deductions\s*\n[\s\S]{0,120}Attach to Form 1040/i,
  "SCH B": /SCHEDULE B\s*\(Form 1040\)/i,
  "SCH E": /Supplemental Income and Loss/i,
  "4868": /Application for Automatic Extension of Time To File U\.S\. Individual/i,
  "8582": /Passive Activity Loss Limitations/i,
  "4562": /Depreciation and Amortization\s*\(Including Information on Listed Property\)/i,
  // Con mayusculas y el subtitulo: el renglon 13 del 1040 dice "Qualified business income deduction from Form 8995".
  "8995": /Qualified Business Income Deduction Simplified Computation/,
  "SCH 8812": /Credits for Qualifying Children\s+and Other Dependents/i,
  // Las instrucciones de otros formularios nombran "Schedule 1-A (Form 1040), line 37": vale el encabezado.
  "SCH 1-A": /SCHEDULE 1-A\s*(?:\(Form 1040\))?\s*\n?[^\n]{0,40}Additional Deductions/,
  "8839": /Qualified Adoption Expenses/i,
  "8824": /Like-Kind Exchanges\s*(?:\n|\s)*\(?and section 1043/i,
};

/**
 * Todo formulario del IRS imprime "Go to www.irs.gov/Form8960 for instructions..." en su
 * encabezado. Es la señal mas estable: el titulo cambia de forma segun el programa (guiones,
 * cortes de renglon), la direccion no.
 */
function formUrl(form) {
  const f = String(form || "").toUpperCase().replace(/\s+/g, " ").trim();
  const sch = /^SCH ([A-Z]{1,2}|\d{4}|\d-[A-Z])$/.exec(f);
  if (sch) return new RegExp(`www\\.irs\\.gov/Schedule${sch[1].replace(/-/g, "")}\\b`, "i");
  const code = f.replace(/-/g, "");
  return /^[0-9A-Z]{3,6}$/.test(code) ? new RegExp(`www\\.irs\\.gov/Form${code}\\b`, "i") : null;
}

function hasForm(text, form) {
  const body = String(text || "");
  const url = formUrl(form);
  if (url && url.test(body)) return true;
  const re = FORM_TITLES[form];
  if (re && re.test(body)) return true;
  const lists = formsList(text);
  const wanted = String(form).toUpperCase();
  return Object.values(lists).some((list) => list.some((f) => f.toUpperCase() === wanted || f.toUpperCase().replace(/^SCH\s+/, "SCH ") === wanted));
}

/* ---------------------------------------------------------------------------
 * Otros formularios del 1040
 * ------------------------------------------------------------------------- */

function sectionAfter(lines, titleRe, span = 140) {
  const i = lines.findIndex((l) => titleRe.test(l));
  return i < 0 ? null : { from: i, to: Math.min(lines.length, i + span) };
}

function schedule1(text) {
  const lines = linesOf(text);
  const s = sectionAfter(lines, /Additional Income and Adjustments to Income/i, 120);
  if (!s) return null;
  return {
    refunds: lineAmount(lines, /Taxable refunds, credits, or offsets of state and local income taxes/i, "1", s),
    business: lineAmount(lines, /Business income or \(loss\)\.\s*Attach Schedule C/i, "3", s),
    otherGains: lineAmount(lines, /Other gains or \(losses\)/i, "4", s),
    scheduleE: lineAmount(lines, /Rental real estate, royalties, partnerships, S corporations/i, "5", s),
    unemployment: lineAmount(lines, /Unemployment compensation/i, "7", s),
    nol: (() => {
      const i = lines.slice(s.from, s.to).findIndex((l) => /\ba\s+Net operating loss/i.test(l));
      if (i < 0) return null;
      const m = /8a\s*\(\s*([\d,]+)\s*\)/.exec(lines[s.from + i]);
      return m ? parseMoney(m[1]) : null;
    })(),
  };
}

function schedule3(text) {
  const lines = linesOf(text);
  const s = sectionAfter(lines, /Additional Credits and Payments/i, 120);
  if (!s) return null;
  return {
    extensionPayment: lineAmount(lines, /Amount paid with request for extension to file/i, "10", s),
    netPtc: lineAmount(lines, /Net premium tax credit\.\s*Attach Form 8962/i, "9", s),
  };
}

function scheduleD(text) {
  const lines = linesOf(text);
  const s = sectionAfter(lines, /Capital Gains and Losses/i, 160);
  if (!s) return null;
  return {
    stCarryover: lineAmount(lines, /Short-term capital loss carryover\.\s*Enter the amount, if any, from line 8/i, "6", s),
    ltCarryover: lineAmount(lines, /Long-term capital loss carryover\.\s*Enter the amount, if any, from line 13/i, "14", s),
    net: lineAmount(lines, /\b16\s+Combine lines 7 and 15/i, "16", s),
    allowedLoss: lineAmount(lines, /If line 16 is a loss, enter here and on Form 1040/i, "21", s),
  };
}

/** Lo que el 4562 manda al año siguiente (§179 no deducido) y lo que trae del anterior. */
function form4562Carryover(text) {
  const lines = linesOf(text);
  return {
    fromPrior: lineAmount(lines, /Carryover of disallowed deduction from line 13 of your \d{4} Form 4562/i, "10"),
    toNext: lineAmount(lines, /Carryover of disallowed deduction to \d{4}\.\s*Add lines 9 and 10, less line 12/i, "13"),
  };
}

/** Las cuotas del 1040-ES impresas con la declaracion. */
function estimateVouchers(text) {
  const lines = linesOf(text);
  const out = [];
  lines.forEach((line, i) => {
    const m = /Form 1040-ES Payment Voucher\s*([1-4])/i.exec(line);
    if (!m) return;
    const near = lines.slice(Math.max(0, i - 2), i + 8).join(" ");
    // La fecha de esta cuota va despues del titulo; la de antes puede ser de la cuota anterior.
    const due = /Due\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(lines.slice(i, i + 8).join(" ")) || /Due\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(near);
    const amount = /money order[ .]*G?\s*([\d,]+)\.?/i.exec(near);
    out.push({ voucher: Number(m[1]), due: due ? due[1] : null, amount: amount ? parseMoney(amount[1]) : null });
  });
  const seen = new Set();
  return out.filter((v) => (seen.has(v.voucher) ? false : (seen.add(v.voucher), true)));
}

/**
 * Casillas del encabezado del 1040 que cambian la deduccion estandar y los topes: mayor de 65,
 * ciego, dependiente de otro contribuyente. Solo cuenta la X delante del rotulo; un PDF que no
 * imprime las X deja todo en cero, que es "no se sabe", no "no".
 */
function checkboxes1040(text) {
  const lines = linesOf(text);
  const range = form1040Range(lines);
  if (!range) return null;
  const block = lines.slice(range.you, Math.min(range.to, range.you + 140)).join("\n");
  return {
    anyX: /\bX\s+(?:Single|Married filing|Head of household|Qualifying)/i.test(block),
    over65: (/\bX\s+Were born before January 2, \d{4}/i.test(block) ? 1 : 0) + (/\bX\s+Was born before January 2, \d{4}/i.test(block) ? 1 : 0),
    blind: (/\bX\s+Are blind\b/i.test(block) ? 1 : 0) + (/\bX\s+Is blind\b/i.test(block) ? 1 : 0),
    dependentOfAnother: /\bX\s+You as a dependent\b/i.test(block),
  };
}

/** Un renglon por su numero repetido al final, dentro de un tramo ("... 5e 10,000."). */
function numberedAmount(lines, range, no) {
  for (let i = range.from; i < Math.min(range.to, lines.length); i += 1) {
    const v = tailAmount(lines[i], no);
    if (v !== null) return v;
  }
  return null;
}

function scheduleA(text) {
  const lines = linesOf(text);
  const s = sectionAfter(lines, /SCHEDULE A\s+Itemized Deductions|SCHEDULE A\s*\(Form 1040\)|www\.irs\.gov\/ScheduleA\b/i, 90);
  if (!s) return null;
  const cap = lines.slice(s.from, s.to).join(" ");
  const printedCap = /smaller of line 5d or \$([\d,]+)/i.exec(cap);
  return {
    salt: numberedAmount(lines, s, "5d"),
    saltAllowed: numberedAmount(lines, s, "5e"),
    printedCap: printedCap ? parseMoney(printedCap[1]) : null,
    mortgage1098: numberedAmount(lines, s, "8a"),
    charityCarryover: numberedAmount(lines, s, "13"),
    total: numberedAmount(lines, s, "17"),
  };
}

/** Importe entre parentesis o suelto al final de un rotulo, o en el renglon siguiente ("... 6 ( 665,487. )"). */
function labeledAmount(lines, label, lineNo) {
  const out = [];
  lines.forEach((line, i) => {
    if (!label.test(line)) return;
    for (const candidate of [line.slice(line.search(label)), lines[i + 1] || ""]) {
      const v = tailAmount(candidate, lineNo);
      if (v !== null) { out.push(v); return; }
      if (new RegExp(`(?:^|\\s)${lineNo}\\s+\\(\\s*\\)\\s*$`).test(candidate)) { out.push(0); return; }
    }
  });
  return out;
}

/**
 * Perdida del QBI que pasa de un año al otro (Form 8995 lineas 3 y 16; 8995-A Schedule C lineas
 * 2 y 6) y la de REIT/PTP (8995 lineas 7 y 17; 8995-A lineas 29 y 40). Negativas.
 */
function qbiCarryforward(text) {
  const lines = linesOf(text);
  const pick = (values) => (values.length ? values.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0) : null);
  return {
    qbiIn: pick([...labeledAmount(lines, /Qualified business net \(loss\) carryforward from (?:the )?prior year/i, "3"), ...labeledAmount(lines, /Qualified business net \(loss\) carryforward from prior years/i, "2")]),
    qbiOut: pick([...labeledAmount(lines, /Total qualified business \(loss\) carryforward\. Combine lines 2 and 3/i, "16"), ...labeledAmount(lines, /Qualified business net \(loss\) carryforward\. Subtract line 5 from line 3/i, "6")]),
    reitIn: pick([...labeledAmount(lines, /Qualified REIT dividends and qualified PTP \(loss\) carryforward from the prior/i, "7"), ...labeledAmount(lines, /Qualified REIT dividends and PTP \(loss\) carryforward from prior years/i, "29")]),
    reitOut: pick([...labeledAmount(lines, /Total qualified REIT dividends and PTP \(loss\) carryforward\. Combine lines 6 and 7/i, "17"), ...labeledAmount(lines, /Total qualified REIT dividends and PTP \(loss\) carryforward\. Combine lines 28 and 29/i, "40")]),
  };
}

/** Form 4952: intereses de inversion no deducidos que vienen del año anterior (linea 2) y que pasan al siguiente (linea 7). */
function form4952(text) {
  const lines = linesOf(text);
  const first = (values) => (values.length ? values[0] : null);
  return {
    fromPrior: first(labeledAmount(lines, /Disallowed investment interest expense from \d{4} Form 4952, line 7/i, "2")),
    toNext: first(labeledAmount(lines, /Disallowed investment interest expense to be carried forward to \d{4}/i, "7")),
  };
}

/** Form 8990: interes del negocio no deducido que viene del año anterior y que pasa al siguiente. */
function form8990(text) {
  const lines = linesOf(text);
  const first = (values) => (values.length ? values[0] : null);
  return {
    fromPrior: first(labeledAmount(lines, /Disallowed business interest expense carryforwards? from prior years/i, "2")),
    toNext: first(labeledAmount(lines, /Disallowed business interest expense\.\s*Subtract line 30 from line 29/i, "31")),
  };
}

/** Cuenta del reintegro: ruta y numero, a veces con los digitos separados ("0 7 2 0 0 0 3 2 6"). */
function refundAccount(text) {
  const lines = linesOf(text);
  const range = form1040Range(lines);
  if (!range) return null;
  const digits = (re) => {
    const line = lines.slice(range.from, range.to).find((l) => re.test(l));
    if (!line) return null;
    const m = new RegExp(`${re.source}\\s+((?:\\d\\s?){4,17})`, "i").exec(line);
    return m ? m[1].replace(/\s+/g, "") : null;
  };
  return { routing: digits(/Routing number/), account: digits(/Account number/) };
}

/** Fechas pedidas para el debito del saldo o de los anticipos ("Requested Payment Date 10/14/25"). */
function requestedDebitDates(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/(?:Requested Payment Date|Withdrawal date|Date of withdrawal|Debit date)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/gi)) out.push(m[1]);
  return out;
}

/** La fecha de la carta al cliente (el primer "Month D, YYYY" solo en su renglon). */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function letterDate(text) {
  for (const line of linesOf(text).slice(0, 60)) {
    const m = new RegExp(`^\\s*(${MONTHS.join("|")})\\s+(\\d{1,2}),\\s+(20\\d{2})\\s*$`).exec(line);
    if (m) return new Date(Date.UTC(Number(m[3]), MONTHS.indexOf(m[1]), Number(m[2])));
  }
  return null;
}

module.exports = {
  textOf, linesOf, tailAmount, lineAmount, pairedAmounts,
  isForm1040, form1040Lines, form1040Year, header1040,
  formsList, hasForm, FORM_TITLES,
  schedule1, schedule3, scheduleD, form4562Carryover, estimateVouchers, letterDate,
  checkboxes1040, scheduleA, qbiCarryforward, form4952, form8990, refundAccount, requestedDebitDates,
  numberedAmount, labeledAmount, form1040Range,
  MONTHS,
};
