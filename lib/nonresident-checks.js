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
    // El tema, para que el informe reconozca cuando el modelo dice lo mismo con otras palabras.
    dedupe: /standard deduction/i,
    detail: `Line 12 shows ${fmt(line12)}, the ${year} standard deduction, but Schedule OI item B gives ${country} as the country of residence. A nonresident alien may only itemize on Schedule A (Form 1040-NR); the standard deduction is allowed only to students and business apprentices from India.`,
    action: "Replace line 12 with the itemized deductions from Schedule A (Form 1040-NR) (state and local income tax, charitable gifts, casualty losses) and recompute the tax.",
    authority: "Instructions for Form 1040-NR, line 12; Pub. 519, chapter 5; U.S.–India income tax treaty, Article 21(2)",
    evidence: `Form 1040-NR line 12: ${fmt(line12)}; Schedule OI item B: ${country}.`,
  }];
}

function checkSubstantialPresence(text, oi, docs) {
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
    detail: `Schedule OI item H gives ${d3} days in ${y3}, ${d2} in ${y2} and ${d1} in ${y1}: ${total} weighted days, over the 183 of the substantial presence test. ${student ? `The ${visa} visa allows those days to be excluded, but only with Form 8843, which is not in the package.` : "With no Form 8843, 8840 or 8833 in the package, the taxpayer is a resident alien and files Form 1040, not 1040-NR."}`,
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
    dedupe: /child tax credit|credit for other dependents|schedule 8812|dependent credit/i,
    detail: `Line 19 claims ${fmt(credit)} of child tax credit or credit for other dependents, but Schedule OI item B gives ${country} as the country of residence. A nonresident alien may claim dependents only as a U.S. national or a resident of Canada, Mexico or South Korea, or as a student or business apprentice from India.`,
    action: "Remove the credit (and Schedule 8812) unless the taxpayer is a U.S. national; confirm the country of residence on Schedule OI.",
    authority: "Instructions for Form 1040-NR, Dependents and line 19; Pub. 519, chapter 5",
    evidence: `Form 1040-NR line 19: ${fmt(credit)}; Schedule OI item B: ${country}.`,
  }];
}

function checkEducationCredits(text) {
  if (!FORM_8863.test(text) || !/Form 8863/i.test(text)) return [];
  return [{
    severity: "HIGH",
    category: "Nonresident alien return",
    title: "Form 8863 — education credit on a nonresident alien return",
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
    dedupe: /line 1k|item l\b|l,? (?:line )?1\(e\)/i,
    detail: `Line 1k shows ${fmt(line1k)} of income exempt by a treaty, but Schedule OI item L, line 1(e) totals ${fmt(onOI)}. The form says to carry that total to line 1k.`,
    action: "Reconcile the treaty table on Schedule OI item L with line 1k and with the Forms 1042-S that show an exemption code.",
    authority: "Schedule OI (Form 1040-NR), item L, line 1(e); Instructions for Form 1040-NR, line 1k",
    evidence: `Form 1040-NR line 1k: ${fmt(line1k)}; Schedule OI L 1(e): ${fmt(onOI)}.`,
  }];
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
      return [
        ...checkSubstantialPresence(text, oi, docs),
        ...checkStandardDeduction(nr, oi, year),
        ...checkDependentCredit(nr, oi),
        ...checkEducationCredits(text),
        ...checkTreatyTotal(nr, oi),
        ...checkStudentFica(oi, docs),
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

module.exports = { runNonresidentChecks, scheduleOILines, residenceCountry, visaType, daysPresent, treatyTotal, socialSecurityWithheld, STANDARD_DEDUCTION };
