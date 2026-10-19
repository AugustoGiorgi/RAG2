"use strict";

/**
 * nonresident-checks.js — lo propio del 1040-NR, y el 1040 que podria ser un 1040-NR.
 *
 * El no residente tiene reglas que el 1040 no tiene y que el modelo no siempre recuerda: no hay
 * deduccion estandar (salvo estudiantes y aprendices residentes de India), el credito por hijos
 * solo vale para residentes de Canada, Mexico, Corea del Sur e India, no hay creditos de
 * educacion, y el estudiante con visa F, J, M o Q no paga seguridad social sobre el sueldo de
 * su programa. Y antes que todo eso, la pregunta de fondo: si los dias del Schedule OI pasan el
 * test de presencia sustancial sin un Form 8843 que excluya dias, la persona es residente y la
 * declaracion es un 1040.
 *
 * Todo sale de los rotulos oficiales del 1040-NR y del Schedule OI 2025. Fail-closed: una
 * respuesta del Schedule OI que no se lee (pais, visa, dias) no se adivina y el cruce no corre.
 */

const { splitReturns } = require("./prior-year-bridge");
const rf = require("./return-facts");
const pd = require("./package-docs");
const { w2Amounts } = require("./individual-checks");

const fmt = (n) => `$${Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US")}`;

/** Deduccion estandar: soltero y casado por separado, y viudo con hijo (QSS). */
const STANDARD_DEDUCTION = {
  2023: [13850, 27700],
  2024: [14600, 29200],
  2025: [15750, 31500],
};
/** Paises cuyos residentes pueden pedir el credito por hijos o por otros dependientes. */
const DEPENDENT_COUNTRIES = /\b(?:CANADA|MEXICO|KOREA|INDIA)\b/i;
/** Visas de estudiante, docente o aprendiz: dias excluibles con el 8843 y exentos de FICA. */
const EXEMPT_VISAS = new Set(["F", "J", "M", "Q"]);

const FORM_8843 = /Statement for Exempt Individuals and Individuals With a Medical Condition/i;
const FORM_8840 = /Closer Connection Exception Statement for Aliens/i;
const FORM_8833 = /Treaty-Based Return Position Disclosure/i;
const FORM_8863 = /Education Credits \(American Opportunity and Lifetime Learning Credits\)/i;

const linesOf = (text) => String(text || "").split(/\r?\n/);
/** "an F visa", "a J visa": la letra se lee con vocal adelante o no. */
const article = (letter) => (/^[AEFHILMNORSX]/.test(String(letter)) ? "an" : "a");

/** El año del 1040-NR: el de la pantalla, o el que imprime el pie "Form 1040-NR (2025)". */
function taxYearOf(text, meta) {
  const stated = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
  if (Number.isFinite(stated) && stated > 2000) return stated;
  const m = /Form 1040-NR\s*\((20\d{2})\)/.exec(String(text || ""));
  return m ? Number(m[1]) : null;
}

/* ---------------------------------------------------------------------------
 * Schedule OI
 * ------------------------------------------------------------------------- */

/** Los renglones del Schedule OI, o null si no esta. */
function scheduleOILines(text) {
  const lines = linesOf(text);
  const start = lines.findIndex((l, i) => /Schedule OI\b/i.test(l) && lines.slice(i, i + 4).some((x) => /Other Information/i.test(x)));
  if (start < 0) return null;
  return lines.slice(start, start + 120);
}

const ITEM = /^\s*[A-M]\s+(?:[A-Z][a-z]|\d\.)/;

/** La respuesta a un item: lo que sigue a la pregunta en su renglon, o el renglon siguiente si es corto. */
function itemAnswer(lines, label) {
  const i = lines.findIndex((l) => label.test(l));
  if (i < 0) return "";
  const own = lines[i].replace(label, "").replace(/^[\s?.:]+/, "").trim();
  if (own) return own;
  const next = String(lines[i + 1] || "").trim();
  if (!next || ITEM.test(next) || next.length > 40 || !/^[A-Za-z][A-Za-z .,'()-]*$/.test(next)) return "";
  return next;
}

/** El pais de residencia fiscal (item B), en mayusculas, o "". */
function residenceCountry(lines) {
  const answer = itemAnswer(lines, /\bB\s+In what country did you claim residence for tax purposes during the tax year\?/i);
  return /^[A-Za-z][A-Za-z .,'()-]{2,39}$/.test(answer) ? answer.toUpperCase().replace(/[.,\s]+$/, "") : "";
}

/** La visa del ultimo dia del año (item E): la letra, o "" si no se lee una sola. */
function visaType(lines) {
  const i = lines.findIndex((l) => /\bE\s+If you had a visa on the last day of the tax year/i.test(l));
  if (i < 0) return "";
  const block = lines.slice(i, i + 2).join(" ")
    .replace(/E\s+If you had a visa on the last day of the tax year, enter your visa type\.?/i, "")
    .replace(/If you didn.t have a visa, enter your U\.S\.\s*immigration status on the last day of the tax year\.?/i, "");
  const found = new Set([...block.matchAll(/\b([A-Z]{1,2})-?(\d)[A-Z]?\b/g)].map((m) => m[1]).filter((v) => /^(?:A|B|E|F|G|H|J|L|M|O|P|Q|R|TN)$/.test(v)));
  return found.size === 1 ? [...found][0] : "";
}

/** Los dias de presencia de los tres años (item H), o null. */
function daysPresent(lines) {
  const i = lines.findIndex((l) => /\bH\s+Give number of days/i.test(l));
  if (i < 0) return null;
  const block = lines.slice(i, i + 3).join(" ");
  const m = /(20\d{2})\s+(\d{1,3})\s*,\s*(20\d{2})\s+(\d{1,3})\s*,?\s*and\s+(20\d{2})\s+(\d{1,3})\b/i.exec(block);
  if (!m) return null;
  const [y1, d1, y2, d2, y3, d3] = m.slice(1).map(Number);
  if (y2 !== y1 + 1 || y3 !== y2 + 1 || [d1, d2, d3].some((d) => d > 366)) return null;
  return { years: [y1, y2, y3], days: [d1, d2, d3] };
}

/** El total de la renta exenta por tratado (item L, 1(e)), o null. */
function treatyTotal(lines) {
  const i = lines.findIndex((l) => /\(e\)\s*Total\.\s*Enter this amount on Form 1040-NR, line 1k/i.test(l));
  if (i < 0) return null;
  // Despues de la guia de puntos en el mismo renglon, o solo en el renglon siguiente.
  const amount = "\\$?((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{2})?)\\.?\\s*$";
  const m = new RegExp(`(?:\\.\\s?){2,}\\s*${amount}`).exec(lines[i]) || new RegExp(`^\\s*${amount}`).exec(lines[i + 1] || "");
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/* ---------------------------------------------------------------------------
 * W-2: seguridad social retenida (casilla 4)
 * ------------------------------------------------------------------------- */

/** Casilla 4 de cada W-2 con texto, sin repetir las copias del mismo formulario. */
function socialSecurityWithheld(doc) {
  const lines = linesOf(doc.text);
  const seen = new Set();
  for (let i = 0; i < lines.length - 1; i += 1) {
    const groups = (lines[i].match(/Social security tax withheld/gi) || []).length;
    if (!groups || !/Social security wages/i.test(lines[i])) continue;
    if (/[A-Za-z]{3}/.test(lines[i + 1])) continue;
    const values = (lines[i + 1].match(/\b\d{1,3}(?:,\d{3})*\.\d{2}\b|\b\d+\.\d{2}\b/g) || []).map((v) => Number(v.replace(/,/g, "")));
    if (values.length !== groups * 2) continue;
    for (let k = 1; k < values.length; k += 2) seen.add(values[k]);
  }
  return [...seen];
}

/* ---------------------------------------------------------------------------
 * Los cruces del 1040-NR
 * ------------------------------------------------------------------------- */

function checkStandardDeduction(nr, oi, year) {
  const amounts = STANDARD_DEDUCTION[year];
  const line12 = nr["12"];
  if (!amounts || !line12 || !amounts.includes(line12)) return [];
  const country = residenceCountry(oi);
  if (!country || /\bINDIA\b/.test(country)) return [];
  return [{
    severity: "HIGH",
    category: "Nonresident alien return",
    title: `Form 1040-NR line 12 — standard deduction claimed by a resident of ${country}`,
    impact: { kind: "deduction", amount: line12 },
    // El tema, para que el informe reconozca cuando el modelo dice lo mismo con otras palabras.
    dedupe: /standard deduction/i,
    detail: `Line 12 shows ${fmt(line12)}, the ${year} standard deduction, but Schedule OI item B gives ${country} as the country of residence. A nonresident alien may only itemize on Schedule A (Form 1040-NR); the standard deduction is allowed only to students and business apprentices from India.`,
    action: "Replace line 12 with the itemized deductions from Schedule A (Form 1040-NR) (state and local income tax, charitable gifts, casualty losses) and recompute the tax.",
    authority: "Instructions for Form 1040-NR, line 12; Pub. 519, chapter 5; U.S.–India income tax treaty, Article 21(2)",
    evidence: `Form 1040-NR line 12: ${fmt(line12)}; Schedule OI item B: ${country}.`,
  }];
}

function checkSubstantialPresence(text, oi, docs, filedLastYear = false) {
  const present = daysPresent(oi);
  if (!present) return [];
  const [d1, d2, d3] = present.days;
  const weighted = d3 + d2 / 3 + d1 / 6;
  if (d3 < 31 || weighted < 183) return [];
  // Los que viajan a trabajar desde Canada o Mexico no cuentan esos dias.
  if (oi.some((l) => /\bX\s+(?:Canada|Mexico)\b|\[ANSWER:\s*(?:Canada|Mexico)\]/i.test(l))) return [];
  const visa = visaType(oi);
  if (visa === "A" || visa === "G") return []; // personal diplomatico: sus dias no cuentan
  const has8843 = FORM_8843.test(text) || docs.some((d) => d.types.includes("8843"));
  const exception = FORM_8840.test(text) || FORM_8833.test(text);
  if (has8843 || exception) return [];
  const [y1, y2, y3] = present.years;
  const total = Math.round(weighted * 10) / 10;
  const student = EXEMPT_VISAS.has(visa);
  return [{
    severity: student ? "MEDIUM" : "HIGH",
    category: "Nonresident alien return",
    title: student ? "Schedule OI — substantial presence test met and no Form 8843 to exclude the days" : "Schedule OI — the days reported meet the substantial presence test",
    dedupe: /substantial presence|form 8843|exempt individual/i,
    detail: `Schedule OI item H gives ${d3} days in ${y3}, ${d2} in ${y2} and ${d1} in ${y1}: ${total} weighted days, over the 183 of the substantial presence test. ${student ? `The ${visa} visa allows those days to be excluded, but only with Form 8843, which is not in the package${filedLastYear ? " (it was filed with last year's return)" : ""}.` :"With no Form 8843, 8840 or 8833 in the package, the taxpayer is a resident alien and files Form 1040, not 1040-NR."}`,
    action: student ? "Attach Form 8843 for the student or teacher days (and confirm the visa years still count as exempt); without it the return should be a Form 1040." : "Confirm the days and the visa; if the test is met and no exception applies, file Form 1040 (dual-status if the residency started this year).",
    authority: "IRC §7701(b)(3); Pub. 519, chapter 1; Instructions for Schedule OI, item H; Form 8843 instructions",
    evidence: `Schedule OI item H: ${y3} ${d3}, ${y2} ${d2}, ${y1} ${d1}${visa ? `; item E visa: ${visa}` : ""}.`,
  }];
}

function checkDependentCredit(nr, oi) {
  const credit = nr["19"];
  if (!credit || credit <= 0) return [];
  const country = residenceCountry(oi);
  if (!country || DEPENDENT_COUNTRIES.test(country)) return [];
  return [{
    severity: "HIGH",
    category: "Nonresident alien return",
    title: `Form 1040-NR line 19 — dependent credit claimed by a resident of ${country}`,
    impact: { kind: "credit", amount: credit },
    dedupe: /child tax credit|credit for other dependents|schedule 8812|dependent credit/i,
    detail: `Line 19 claims ${fmt(credit)} of child tax credit or credit for other dependents, but Schedule OI item B gives ${country} as the country of residence. A nonresident alien may claim dependents only as a U.S. national or a resident of Canada, Mexico or South Korea, or as a student or business apprentice from India.`,
    action: "Remove the credit (and Schedule 8812) unless the taxpayer is a U.S. national; confirm the country of residence on Schedule OI.",
    authority: "Instructions for Form 1040-NR, Dependents and line 19; Pub. 519, chapter 5",
    evidence: `Form 1040-NR line 19: ${fmt(credit)}; Schedule OI item B: ${country}.`,
  }];
}

function checkEducationCredits(text) {
  if (!FORM_8863.test(text) || !/Form 8863/i.test(text)) return [];
  const credit = rf.lineAmount(rf.linesOf(text), /Education credits from Form 8863, line 19/i, "3");
  return [{
    severity: "HIGH",
    category: "Nonresident alien return",
    title: "Form 8863 — education credit on a nonresident alien return",
    ...(credit ? { impact: { kind: "credit", amount: credit } } : {}),
    detail: "The return includes Form 8863, but a nonresident alien cannot claim the American opportunity or lifetime learning credit. Only a nonresident married to a U.S. citizen or resident who elects to be treated as a resident can, and that return is a Form 1040.",
    action: "Remove Form 8863 and the credit from Schedule 3; if the taxpayer qualifies for the resident election, the return should be a joint Form 1040 instead.",
    authority: "Instructions for Form 8863 (Who Can Claim); Pub. 970; Pub. 519, chapter 5",
    evidence: "Form 8863 attached to Form 1040-NR.",
  }];
}

function checkStudentFica(oi, docs) {
  const visa = visaType(oi);
  if (!EXEMPT_VISAS.has(visa)) return [];
  const withheld = docs.filter((d) => d.types.includes("w2")).flatMap((d) => socialSecurityWithheld(d).filter((v) => v > 0).map((v) => ({ name: d.name, v })));
  if (!withheld.length) return [];
  const total = withheld.reduce((s, w) => s + w.v, 0);
  return [{
    severity: "MEDIUM",
    category: "Nonresident alien return",
    title: `Form W-2 — social security tax withheld from a nonresident on ${article(visa)} ${visa} visa`,
    impact: { kind: "recoverable", amount: total },
    dedupe: /social security tax|\bfica\b|medicare tax|form 843|form 8316/i,
    detail: `The W-2s show ${fmt(total)} of social security tax withheld (box 4), and Schedule OI item E gives ${article(visa)} ${visa} visa. Wages a nonresident student or scholar earns under the purpose of that visa are exempt from social security and Medicare tax.`,
    action: "Ask the employer to refund the social security and Medicare tax; if it will not, file Form 843 with Form 8316 and the W-2.",
    authority: "IRC §3121(b)(19); Pub. 519, chapter 8; Form 843 and Form 8316 instructions",
    evidence: withheld.map((w) => `${w.name}: box 4 ${fmt(w.v)}`).join("; "),
  }];
}

function checkTreatyTotal(nr, oi) {
  const onOI = treatyTotal(oi);
  const line1k = nr["1k"];
  if (onOI === null || line1k === null || line1k === undefined || Math.abs(onOI - line1k) <= 2) return [];
  return [{
    severity: Math.abs(onOI - line1k) >= 10000 ? "HIGH" : "MEDIUM",
    category: "Nonresident alien return",
    title: "Form 1040-NR line 1k — treaty-exempt income does not match Schedule OI",
    impact: { kind: "income", amount: Math.abs(onOI - line1k) },
    dedupe: /line 1k|item l\b|l,? (?:line )?1\(e\)/i,
    detail: `Line 1k shows ${fmt(line1k)} of income exempt by a treaty, but Schedule OI item L, line 1(e) totals ${fmt(onOI)}. The form says to carry that total to line 1k.`,
    action: "Reconcile the treaty table on Schedule OI item L with line 1k and with the Forms 1042-S that show an exemption code.",
    authority: "Schedule OI (Form 1040-NR), item L, line 1(e); Instructions for Form 1040-NR, line 1k",
    evidence: `Form 1040-NR line 1k: ${fmt(line1k)}; Schedule OI L 1(e): ${fmt(onOI)}.`,
  }];
}

/* ---------------------------------------------------------------------------
 * Lo que el año anterior deja para este
 *
 * Los arrastres del 1040 los cruza individual-checks con los renglones del 1040; sobre un NR no
 * corren. En una prueba con un 1040-NR inventado el sobrepago aplicado del año anterior, el 8843
 * que desaparecio, los meses del tratado y la respuesta "nunca presente" del Schedule OI solo
 * los vio el modelo, y tres de ellos quedaron en LOW.
 * ------------------------------------------------------------------------- */

function checkOverpaymentAppliedNR(nr, priorNr, year) {
  const applied = priorNr && priorNr["36"];
  if (!applied || applied <= 0) return [];
  const line26 = Number(nr["26"] || 0);
  if (line26 + 1 >= applied) return [];
  return [{
    severity: "HIGH",
    category: "Carryover",
    title: "Form 1040-NR line 26 — last year's overpayment not applied",
    impact: { kind: "payment", amount: applied - line26 },
    dedupe: /line 26|overpayment (?:applied|credited)|applied (?:to|from) .{0,20}estimated/i,
    detail: `Last year's return applied ${fmt(applied)} of its overpayment to ${year || "this year"}'s estimated tax (line 36), but line 26 of this return shows ${line26 ? fmt(line26) : "nothing"}.`,
    action: "Add the applied overpayment to line 26 with any estimated payments; if it was refunded instead, confirm it on the IRS account transcript.",
    authority: "Instructions for Form 1040-NR, line 26",
    evidence: `Prior-year Form 1040-NR line 36: ${fmt(applied)}; this return line 26: ${line26 ? fmt(line26) : "blank"}.`,
  }];
}

/** La respuesta al item I ("Did you file a U.S. income tax return for any prior year?"): "Yes", "No" o "". */
function priorReturnAnswer(lines) {
  const line = lines.find((l) => /\bI\s+Did you file a U\.S\. income tax return for any prior year\?/i.test(l));
  if (!line) return "";
  const answer = /\[ANSWER:\s*(Yes|No)\]/i.exec(line);
  if (answer) return answer[1][0].toUpperCase() + answer[1].slice(1).toLowerCase();
  if (/\bYes\s+X\s+No\b/i.test(line)) return "No";
  if (/\bX\s+Yes\s+No\b/i.test(line)) return "Yes";
  return "";
}

function checkPriorReturnQuestion(oi, priorNr) {
  if (!priorNr || priorReturnAnswer(oi) !== "No") return [];
  return [{
    severity: "MEDIUM",
    category: "Nonresident alien return",
    title: "Schedule OI item I — answers that no prior U.S. return was filed",
    dedupe: /item i\b|prior (?:year )?(?:u\.s\. )?(?:income tax )?return (?:was )?filed|filed a (?:u\.s\. )?(?:income tax )?return for any prior year/i,
    detail: "Schedule OI item I says no U.S. income tax return was filed for any prior year, but last year's Form 1040-NR is in the package. The answer has to be Yes, with the latest year and form filed.",
    action: "Answer Yes on item I and give the latest year and form number filed.",
    authority: "Instructions for Schedule OI (Form 1040-NR), item I",
    evidence: "Schedule OI item I: No; prior-year Form 1040-NR in the package.",
  }];
}

/** Los renglones de la tabla del tratado (item L 1): pais, articulo, meses de años anteriores e importe. */
function treatyRows(lines) {
  const start = lines.findIndex((l) => /\(a\)\s*Country\s+\(b\)\s*Tax treaty article/i.test(l));
  const end = lines.findIndex((l) => /\(e\)\s*Total\.\s*Enter this amount on Form 1040-NR/i.test(l));
  if (start < 0 || end <= start) return [];
  const out = [];
  for (const line of lines.slice(start + 1, end)) {
    const m = /^\s*([A-Z][A-Z .,'-]{1,40}?)\s+((?:Art(?:icle|\.)?\s*)?\d{1,2}(?:\([0-9a-z]{1,3}\))*)\s+(\d{1,3})\s+\$?([\d,]+)(?:\.\d{2})?\.?(?:\s|$)/.exec(line.replace(/(?:\s\.)+\s/g, " "));
    if (m) out.push({ country: m[1].trim().toUpperCase(), article: m[2].replace(/\s+/g, ""), months: Number(m[3]), amount: Number(m[4].replace(/,/g, "")) });
  }
  return out;
}

function checkTreatyMonths(oi, priorOi, year) {
  if (!priorOi) return [];
  const before = treatyRows(priorOi);
  const now = treatyRows(oi);
  const dropped = now.map((row) => ({ row, prior: before.find((b) => b.country === row.country && b.article === row.article) }))
    .filter(({ row, prior }) => prior && prior.amount > 0 && row.months < prior.months + 1);
  if (!dropped.length) return [];
  const { row, prior } = dropped[0];
  return [{
    severity: "MEDIUM",
    category: "Nonresident alien return",
    title: "Schedule OI item L(c) — treaty months claimed in prior years went down",
    dedupe: /item l\s*\(?c\)?|number of months|months (?:claimed|in prior)/i,
    detail: `The ${row.country} treaty, article ${row.article}, shows ${row.months} months claimed in prior years, and last year's Schedule OI already showed ${prior.months} before claiming the benefit for ${year ? year - 1 : "last year"} as well. The count is cumulative and many treaty benefits end after a set number of years.`,
    action: `Enter the cumulative months (at least ${prior.months} plus the months claimed last year) and confirm the benefit has not expired under the treaty.`,
    authority: "Instructions for Schedule OI (Form 1040-NR), item L; Pub. 901",
    evidence: `Schedule OI L(c): ${row.months} this year, ${prior.months} last year (${row.country}, ${row.article}).`,
  }];
}

function check8843Dropped(text, priorText, docs, alreadyReported) {
  if (alreadyReported || !priorText || !FORM_8843.test(priorText)) return [];
  if (FORM_8843.test(text) || docs.some((d) => d.types.includes("8843"))) return [];
  return [{
    severity: "LOW",
    category: "Carryover",
    title: "Form 8843 — filed with last year's return and not with this one",
    dedupe: /form 8843|exempt individual/i,
    detail: "Last year's return included Form 8843 to exclude the days of presence as an exempt individual, and this year's return does not. Every exempt individual who excludes days files it each year.",
    action: "Attach Form 8843 for this year, or confirm the taxpayer no longer excludes days (and is then tested as a resident).",
    authority: "Form 8843 instructions; Pub. 519, chapter 1",
    evidence: "Form 8843 in the prior-year return; not in this return or the package.",
  }];
}

/**
 * El reintegro estatal del año anterior. El no residente no tiene deduccion estandar: si el año
 * pasado dedujo el impuesto estatal en el Schedule A (Form 1040-NR), el reintegro de este año
 * tributa en el Schedule 1 linea 1 (regla del beneficio fiscal), casi siempre entero.
 */
function checkStateRefundNR(text, priorText, docs) {
  const forms = docs.filter((d) => d.types.includes("1099-g"));
  if (!forms.length || !priorText || !/SCHEDULE A \(Form 1040-NR\)/i.test(priorText)) return [];
  const refunds = forms.map((d) => {
    const m = /\b2\s+State or local income tax refunds, credits, or offsets\s*\$?\s*([\d,]+\.\d{2})/i.exec(String(d.text || ""));
    return { name: d.name, v: m ? Number(m[1].replace(/,/g, "")) : 0 };
  }).filter((r) => r.v > 0);
  if (!refunds.length) return [];
  const priorLines = rf.linesOf(priorText);
  const deducted = rf.lineAmount(priorLines, /State and local income taxes/i, "1a");
  if (!deducted || deducted <= 0) return [];
  const s1 = rf.schedule1(text);
  if (s1 && Number(s1.refunds || 0) > 0) return [];
  const total = refunds.reduce((s, r) => s + r.v, 0);
  const taxable = Math.min(total, deducted);
  return [{
    severity: "MEDIUM",
    category: "Carryover",
    title: "Schedule 1 line 1 — state refund deducted last year not reported",
    impact: { kind: "income", amount: taxable },
    dedupe: /state (?:income tax )?refund|1099-g|schedule 1,? line 1\b|tax benefit/i,
    detail: `The package has a Form 1099-G with ${fmt(total)} of state income tax refund, and last year's Schedule A (Form 1040-NR) deducted ${fmt(deducted)} of state income tax. A nonresident has no standard deduction, so ${fmt(taxable)} of the refund is taxable this year and line 1 of Schedule 1 is blank.`,
    action: "Report the refund on Schedule 1 line 1 to the extent last year's deduction reduced the tax.",
    authority: "IRC §111; Instructions for Form 1040-NR, line 8; Schedule 1 instructions, line 1",
    evidence: `${refunds.map((r) => `${r.name}: box 2 ${fmt(r.v)}`).join("; ")}; prior-year Schedule A (Form 1040-NR) line 1a: ${fmt(deducted)}.`,
  }];
}

/* ---------------------------------------------------------------------------
 * Los documentos contra la declaracion
 * ------------------------------------------------------------------------- */

/** Casilla 10 de cada 1042-S (o la 7a si no esta la 10), sin repetir copias. */
function withholding1042S(doc) {
  const text = String(doc.text || "");
  const amount = (re) => { const m = re.exec(text); return m ? Number(m[1].replace(/,/g, "")) : null; };
  const box10 = amount(/\b10\s+Total withholding credit\s*\$?\s*([\d,]+\.\d{2})/i);
  return box10 !== null ? box10 : amount(/\b7a\s+Federal tax withheld\s*\$?\s*([\d,]+\.\d{2})/i);
}

function checkWithholding1042S(nr, docs) {
  const forms = docs.filter((d) => d.types.includes("1042-s"));
  if (!forms.length) return [];
  const amounts = forms.map((d) => ({ name: d.name, v: withholding1042S(d) }));
  if (amounts.some((a) => a.v === null)) return [];
  const seen = new Set();
  const total = amounts.reduce((s, a) => { const key = `${a.v}`; if (seen.has(key)) return s; seen.add(key); return s + a.v; }, 0);
  const line25g = Number(nr["25g"] || 0);
  if (total <= line25g + 1) return [];
  const gap = total - line25g;
  return [{
    severity: gap >= 1000 ? "HIGH" : "MEDIUM",
    category: "Payments",
    title: "Form 1040-NR line 25g — withholding on the Forms 1042-S not claimed",
    impact: { kind: "payment", amount: gap },
    dedupe: /line 25g|1042-s (?:box 10|withholding)|withholding credit/i,
    detail: `The Forms 1042-S in the package show ${fmt(total)} of U.S. tax withheld (box 10), and line 25g claims ${line25g ? fmt(line25g) : "nothing"}. The taxpayer loses ${fmt(gap)} of credit.`,
    action: "Enter the 1042-S withholding on line 25g and attach the Forms 1042-S.",
    authority: "Instructions for Form 1040-NR, line 25g",
    evidence: amounts.map((a) => `${a.name}: box 10 ${fmt(a.v)}`).join("; "),
  }];
}

const BANK_PAYER = /\b(?:BANK|SAVINGS|CREDIT UNION|BANCORP|FEDERAL SAVINGS|TRUST COMPANY)\b/i;

/** Interes de un 1099-INT emitido por un banco: la casilla 1 y el pagador. */
function bankInterest(doc) {
  const text = String(doc.text || "");
  const payer = /PAYER[’']?S name[^:\n]*:?\s*([^\n]+)/i.exec(text);
  if (!payer || !BANK_PAYER.test(payer[1])) return null;
  const box1 = /(?:^|\s)1\.?\s*Interest income[\s.]*\$?\s*([\d,]+\.\d{2})/i.exec(text);
  return box1 ? { payer: payer[1].split(",")[0].trim(), amount: Number(box1[1].replace(/,/g, "")) } : null;
}

function checkBankInterestNR(nr, docs) {
  const line2b = Number(nr["2b"] || 0);
  if (line2b <= 0) return [];
  const ints = docs.filter((d) => d.types.includes("1099-int"));
  if (!ints.length) return [];
  const banks = ints.map(bankInterest);
  // Todos los 1099-INT tienen que ser de bancos: otro interes (un bono, un prestamo) si tributa.
  if (banks.some((b) => b === null)) return [];
  const total = banks.reduce((s, b) => s + b.amount, 0);
  if (Math.abs(total - line2b) > 1) return [];
  return [{
    severity: "MEDIUM",
    category: "Nonresident alien return",
    title: "Form 1040-NR line 2b — bank deposit interest reported as taxable",
    impact: { kind: "income", amount: line2b },
    dedupe: /line 2b|bank (?:deposit )?interest|deposit interest|871\(i\)/i,
    detail: `Line 2b reports ${fmt(line2b)} of taxable interest, which is the interest on the bank 1099-INTs (${banks.map((b) => b.payer).join(", ")}). Deposit interest from a U.S. bank is not taxable to a nonresident alien unless it is effectively connected with a U.S. business.`,
    action: "Remove the bank interest from line 2b (and from Schedule NEC); keep it only if it is effectively connected with a U.S. trade or business.",
    authority: "IRC §871(i)(2)(A) and §861(a)(1); Pub. 519, chapter 3",
    evidence: banks.map((b) => `${b.payer}: 1099-INT box 1 ${fmt(b.amount)}`).join("; "),
  }];
}

function checkWagesNR(nr, oi, docs) {
  const w2s = docs.filter((d) => d.types.includes("w2"));
  if (!w2s.length) return [];
  const parsed = w2s.map(w2Amounts);
  if (parsed.some((p) => p === null)) return [];
  const all = parsed.flat();
  const box1 = all.reduce((s, w) => s + w.box1, 0);
  const box2 = all.reduce((s, w) => s + w.box2, 0);
  // Lo exento por tratado va en la 1k y no en la 1a; vale el total del Schedule OI si se lee.
  const treaty = treatyTotal(oi) ?? Number(nr["1k"] || 0);
  const line1a = Number(nr["1a"] || 0);
  const out = [];
  const expected = box1 - treaty;
  if (expected > line1a + 1) {
    const gap = expected - line1a;
    out.push({
      severity: gap >= 1000 ? "HIGH" : "MEDIUM",
      category: "Income",
      title: "Form 1040-NR line 1a — W-2 wages exceed the return",
      impact: { kind: "income", amount: gap },
      dedupe: /line 1a|w-2 (?:box 1|wages)/i,
      detail: `The W-2s add to ${fmt(box1)} of box 1 wages; less ${fmt(treaty)} exempt by treaty, line 1a should be ${fmt(expected)} and reports ${fmt(line1a)}.`,
      action: "Correct line 1a to the W-2s less the treaty-exempt wages reported on line 1k and Schedule OI item L.",
      authority: "Instructions for Form 1040-NR, lines 1a and 1k",
      evidence: `W-2s: ${w2s.map((d) => d.name).join("; ")}; Schedule OI L(e): ${fmt(treaty)}.`,
    });
  }
  const line25a = Number(nr["25d"] || 0);
  if (box2 > 0 && line25a > box2 + 1 && !docs.some((d) => d.types.some((t) => /^1099|^ssa|^1042/.test(t)))) {
    out.push({
      severity: "HIGH",
      category: "Payments",
      title: "Form 1040-NR line 25d — withholding claimed exceeds the W-2s",
      impact: { kind: "payment", amount: line25a - box2 },
      detail: `Lines 25a-25d claim ${fmt(line25a)} of withholding and the W-2s in the package show ${fmt(box2)} in box 2.`,
      action: "Correct the withholding to the W-2s; withholding the IRS cannot match is disallowed.",
      authority: "IRC §1462; Instructions for Form 1040-NR, line 25",
      evidence: `W-2s: ${w2s.map((d) => d.name).join("; ")}.`,
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Un 1040 con papeles de no residente
 * ------------------------------------------------------------------------- */

function checkNonresidentPapersOn1040(text, docs) {
  const papers = docs.filter((d) => d.types.includes("1042-s") || d.types.includes("8843"));
  const attached8843 = FORM_8843.test(text);
  if (!papers.length && !attached8843) return [];
  const names = [...papers.map((d) => `${d.name} (${d.types.includes("1042-s") ? "Form 1042-S" : "Form 8843"})`), ...(attached8843 ? ["Form 8843 attached to the return"] : [])];
  return [{
    severity: "MEDIUM",
    category: "Nonresident alien return",
    title: "Form 1040 — the package carries papers of a nonresident alien",
    detail: `The package includes ${names.slice(0, 3).join("; ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}, which are issued to or filed by nonresident aliens. A Form 1040 is right only if the taxpayer was a resident alien (green card or substantial presence test) or elected resident treatment; otherwise it is a Form 1040-NR.`,
    action: "Confirm the residency status with the days of presence for the last three years and the visa; if nonresident, prepare Form 1040-NR with Schedule OI (or a dual-status return).",
    authority: "IRC §7701(b); Pub. 519, chapter 1; Instructions for Form 1040-NR (Who Must File)",
    evidence: names.join("; "),
  }];
}

function runNonresidentChecks(files, meta = {}) {
  try {
    const list = (Array.isArray(files) ? files : []).map((f) => ({ ...f, reviewRole: f.reviewRole || f.role }));
    const { current, prior } = splitReturns(list, meta);
    if (!current) return [];
    const text = rf.textOf(current);
    const docs = pd.packageDocuments(list, { exclude: new Set([current, prior].filter(Boolean)) });
    if (rf.isForm1040NR(text)) {
      const nr = rf.form1040NRLines(text);
      const oi = scheduleOILines(text) || [];
      const year = taxYearOf(text, meta);
      const priorText = prior ? rf.textOf(prior) : "";
      const priorIsNR = priorText && rf.isForm1040NR(priorText);
      const priorNr = priorIsNR ? rf.form1040NRLines(priorText) : null;
      const priorOi = priorIsNR ? scheduleOILines(priorText) : null;
      const presence = checkSubstantialPresence(text, oi, docs, priorIsNR && FORM_8843.test(priorText));
      return [
        ...presence,
        ...checkStandardDeduction(nr, oi, year),
        ...checkDependentCredit(nr, oi),
        ...checkEducationCredits(text),
        ...checkTreatyTotal(nr, oi),
        ...checkStudentFica(oi, docs),
        ...checkOverpaymentAppliedNR(nr, priorNr, year),
        ...checkPriorReturnQuestion(oi, priorNr),
        ...checkTreatyMonths(oi, priorOi, year),
        ...check8843Dropped(text, priorIsNR ? priorText : "", docs, presence.length > 0),
        ...checkStateRefundNR(text, priorIsNR ? priorText : "", docs),
        ...checkWithholding1042S(nr, docs),
        ...checkBankInterestNR(nr, docs),
        ...checkWagesNR(nr, oi, docs),
      ];
    }
    // La de status dual ya es la respuesta a la pregunta de residencia.
    if (rf.isForm1040(text) && !/Dual[- ]Status/i.test(text)) return checkNonresidentPapersOn1040(text, docs);
    return [];
  } catch (error) {
    console.warn(`[nonresident] ${error.message}`);
    return [];
  }
}

module.exports = {
  runNonresidentChecks, scheduleOILines, residenceCountry, visaType, daysPresent, treatyTotal, socialSecurityWithheld, STANDARD_DEDUCTION,
  priorReturnAnswer, treatyRows, withholding1042S, bankInterest,
};
