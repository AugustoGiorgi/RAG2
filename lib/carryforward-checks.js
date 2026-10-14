"use strict";

/**
 * carryforward-checks.js — lo que la declaracion del año pasado dejo para este año y este año
 * no aparece.
 *
 * Tres cosas que una revision de un solo año no puede ver, porque cada una es una ausencia:
 *
 *  1. Un credito arrastrado (el del año pasado lo lista en "CARRYOVERS TO 2025") que este año
 *     no se usa ni se vuelve a arrastrar, y los formularios que lo generan (6765, 3800) que
 *     estaban y ya no estan. En una C corp de software el credito de investigacion arrastrado
 *     desaparecio entero, y con el el calculo del credito del año.
 *  2. Una amortizacion que el año pasado era grande y este año casi no esta. La misma C corp
 *     dedujo una amortizacion de cinco cifras (solo fiscal, M-1 linea 8) y este año casi nada: si
 *     eran gastos de investigacion capitalizados (seccion 174), el saldo se deduce en 2025.
 *  3. Pagos hechos para este año que la declaracion de este año no acredita: la del año pasado
 *     dejo anotado un pago a la ciudad marcado "PAID" y primeras cuotas para el estado y
 *     el recargo del MTA, y los formularios de este año no acreditan ninguna.
 *
 * Todo sale de las paginas de resumen que imprime el programa del estudio ("CARRYOVERS TO",
 * "ESTIMATES", "FORMS NEEDED FOR THIS RETURN", los resumenes estatales) y de las hojas de
 * "OTHER DEDUCTIONS". Fail-closed: si una de las dos declaraciones no imprime la seccion, no
 * se dice nada.
 */

const rf = require("./return-facts");
const { tailOf } = require("./form-arithmetic-checks");

const money = (n) => `$${Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US")}`;
const linesOf = (text) => String(text || "").split(/\r?\n/);
const parseMoney = (raw) => {
  const value = Number(String(raw || "").replace(/[$,\s]/g, "").replace(/\.$/, ""));
  return Number.isFinite(value) ? value : null;
};
const listing = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] || "");

/* ---------------------------------------------------------------------------
 * Lectores de las paginas de resumen
 * ------------------------------------------------------------------------- */

/**
 * Los arrastres que imprime "CARRYOVERS TO <año>": [{ section, label, amount }]. La seccion es
 * la jurisdiccion ("FEDERAL", "NEW YORK"). Un bloque puede seguir en la pagina siguiente
 * ("CARRYOVERS TO 2026 (CONTINUED)") sin repetir la seccion.
 */
function carryoverItems(text) {
  const out = [];
  let inside = false;
  let section = "FEDERAL";
  for (const raw of linesOf(text)) {
    const line = raw.trim();
    if (/^CARRYOVERS TO 20\d{2}(?:\s*\(CONTINUED\))?$/.test(line)) { inside = true; continue; }
    if (!inside) continue;
    const head = /^([A-Z][A-Z .'-]+?)\s+CARRYOVERS$/.exec(line);
    if (head) { section = head[1].trim(); continue; }
    // "GENERAL BUSINESS CREDITS 18,500." — el rotulo en mayusculas y el importe con su punto.
    const item = /^([A-Z][A-Z0-9 ()%&:,./'-]*?)\s+(-?[\d,]+)\.$/.exec(line);
    if (item) { out.push({ section, label: item[1].trim(), amount: parseMoney(item[2]) }); continue; }
    // Cualquier otra cosa cierra el bloque (renglon vacio, ESTIMATES, salto de pagina); la
    // pagina siguiente lo reabre con "(CONTINUED)" y la seccion sigue siendo la misma.
    inside = false;
  }
  return out;
}

/** Los pagos estimados marcados PAID en "ESTIMATES": [{ jurisdiction, date, amount }]. */
function estimatesPaid(text) {
  const out = [];
  let jurisdiction = null;
  for (const raw of linesOf(text)) {
    const line = raw.trim();
    const head = /^([A-Z][A-Z .'-]+?)\s+ESTIMATES$/.exec(line);
    if (head) { jurisdiction = head[1].trim(); continue; }
    if (!jurisdiction) continue;
    const row = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(-?[\d,]+)\.?\s+(-?[\d,]+)\.?\s+(-?[\d,]+)\.?\s+PAID$/.exec(line);
    if (row) {
      const amount = parseMoney(row[4]);
      if (amount > 0) out.push({ jurisdiction, date: row[1], amount });
      continue;
    }
    if (/^TOTAL\s/.test(line)) jurisdiction = null;
  }
  return out;
}

/**
 * Las primeras cuotas (MFI) que la declaracion del año pasado dejo para este año, leidas del
 * resumen estatal de ESTA declaracion, que trae las dos columnas: "FORM CT-300 MANDATORY FIRST
 * INSTALLMENT . . 0 300 -300" (este año, el anterior, diferencia). Devuelve { NY, MTA, NYC }.
 */
function firstInstallmentsSetUp(text) {
  const out = {};
  let section = null;
  for (const raw of linesOf(text)) {
    const line = raw.trim();
    if (/^MTA TAX SURCHARGE$/.test(line)) section = "MTA";
    else if (/^(?:NEW YORK STATE SUMMARY|STATE TAX COMPUTATION)$/.test(line)) section = "NY";
    else if (/^NEW YORK CITY SUMMARY$/.test(line)) section = "NYC";
    const row = /^FORM (CT-300|NYC-300) MANDATORY FIRST INSTALLMENT[\s.]*?\s(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s*$/.exec(line);
    if (!row) continue;
    const prior = parseMoney(row[3]);
    if (!(prior > 0)) continue;
    const key = row[1] === "NYC-300" ? "NYC" : section === "MTA" ? "MTA" : "NY";
    out[key] = prior;
  }
  return out;
}

/** Donde acredita cada jurisdiccion lo pagado por adelantado en esta declaracion. */
const PREPAYMENT_LINES = {
  NY: [
    { form: "CT-3 line 18", label: /^\s*18\s+Total prepayments \(add lines 11 through 17/i, num: "18" },
    { form: "IT-201 line 75", label: /^\s*75\s+Total estimated tax payments and amount paid with Form IT-370/i, num: "75", nyDollars: true },
  ],
  MTA: [{ form: "CT-3-M line 7", label: /^\s*7\s+Total prepayments from line 92/i, num: "7" }],
  NYC: [{ form: "NYC-2 line 13", label: /^\s*13\s+Total prepayments \(from Composition of Prepayments Schedule/i, num: "13" }],
  FEDERAL: [{ form: "Form 1120 Schedule J line 14", label: /^\s*14\s+Current year's estimated tax payments/i, num: "14" }],
};

/** Lo acreditado en la linea de anticipos de una jurisdiccion: { form, value } o null si no se lee. */
function prepaymentsCredited(text, key) {
  const lines = linesOf(text);
  for (const spec of PREPAYMENT_LINES[key] || []) {
    const i = lines.findIndex((l) => spec.label.test(l));
    if (i < 0) continue;
    if (spec.nyDollars) {
      // El IT-201 imprime los dolares y los centavos separados: "75 4956 .00".
      const m = new RegExp(`\\b${spec.num}\\s+(\\d[\\d,]*)?\\s*\\.00\\b`).exec(lines[i]);
      if (m) return { form: spec.form, value: parseMoney(m[1] || "0") };
      continue;
    }
    const tail = tailOf(lines[i], spec.num) || (lines[i + 1] ? tailOf(lines[i + 1], spec.num) : null);
    if (tail) return { form: spec.form, value: tail.value };
  }
  return null;
}

const JURISDICTION_KEY = { "NEW YORK CITY": "NYC", "NEW YORK": "NY", FEDERAL: "FEDERAL" };
const JURISDICTION_NAME = { NYC: "New York City", NY: "New York State", MTA: "the MTA surcharge", FEDERAL: "federal" };

/* ---------------------------------------------------------------------------
 * 1. Creditos arrastrados que desaparecen, y los formularios que los generaban
 * ------------------------------------------------------------------------- */

/** Las clases de credito que se arrastran, el formulario que las usa y el que las genera. */
const CREDIT_CLASSES = [
  { key: "gbc", label: /GENERAL BUSINESS|GEN BUS CREDIT|RESEARCH CREDIT/i, uses: ["3800"], name: "general business credit" },
  { key: "amt", label: /MINIMUM TAX CREDIT|PRIOR YEAR MINIMUM TAX/i, uses: ["8801", "8827"], name: "minimum tax credit" },
  { key: "ftc", label: /FOREIGN TAX CREDIT/i, uses: ["1116", "1118"], name: "foreign tax credit" },
];

/** Formularios cuya ausencia de un año al otro hay que explicar, con lo que arrastran. */
const CONTINUING_FORMS = {
  6765: "research credit",
  3800: "general business credit",
  8990: "business interest limitation and its carryforward",
  6252: "installment sale whose later payments are taxable",
  8801: "credit for prior-year minimum tax",
  8827: "credit for prior-year minimum tax",
  5471: "foreign corporation information return",
  5472: "foreign-owned corporation information return",
  8858: "foreign disregarded entity information return",
  8865: "foreign partnership information return",
  8621: "foreign fund (PFIC) information return",
  8992: "GILTI computation",
};
const FOREIGN_INFORMATION = new Set(["5471", "5472", "8858", "8865", "8621"]);
const CREDIT_FORMS = new Set(["6765", "3800", "8801", "8827"]);
const CREDIT_FLOOR = 1000;

function federalForms(text) {
  const lists = rf.formsList(text);
  return Array.isArray(lists.FEDERAL) ? lists.FEDERAL.map((f) => String(f).toUpperCase()) : null;
}

function checkCarryoversAndFormsDropped(currentText, priorText, taxYear) {
  const formsNow = federalForms(currentText);
  const formsBefore = federalForms(priorText);
  const before = carryoverItems(priorText).filter((i) => i.section === "FEDERAL");
  const now = carryoverItems(currentText).filter((i) => i.section === "FEDERAL");
  const hasNowBlock = /^CARRYOVERS TO 20\d{2}\s*$/m.test(currentText);
  const findings = [];
  const year = Number.isFinite(taxYear) ? taxYear : null;

  // Creditos: estaban en la lista del año pasado, este año no se usan ni se vuelven a arrastrar.
  const lostCredits = [];
  if (hasNowBlock && formsNow) {
    for (const cls of CREDIT_CLASSES) {
      const carried = before.filter((i) => cls.label.test(i.label));
      const total = carried.reduce((sum, i) => sum + (i.amount || 0), 0);
      if (total < CREDIT_FLOOR) continue;
      if (now.some((i) => cls.label.test(i.label))) continue;
      if (cls.uses.some((form) => formsNow.includes(form))) continue; // se uso este año
      lostCredits.push({ ...cls, total });
    }
  }

  const droppedForms = formsNow && formsBefore
    ? Object.keys(CONTINUING_FORMS).filter((form) => formsBefore.includes(form) && !formsNow.includes(form))
    : [];

  if (lostCredits.length) {
    const creditForms = droppedForms.filter((f) => CREDIT_FORMS.has(f));
    const total = lostCredits.reduce((sum, c) => sum + c.total, 0);
    const research = creditForms.includes("6765");
    findings.push({
      severity: total >= 10000 ? "HIGH" : "MEDIUM",
      category: "Carryover",
      title: `Form 3800 — ${lostCredits[0].name} carried from last year is gone`,
      detail: `Last year's return carried ${listing(lostCredits.map((c) => `${money(c.total)} of ${c.name}`))} to ${year || "this year"}${creditForms.length ? ` and filed Form${creditForms.length > 1 ? "s" : ""} ${listing(creditForms)}` : ""}; this return files none of them, uses no credit and carries nothing to ${year ? year + 1 : "next year"}.${research ? " If the research continued, this year's research credit was not computed either." : ""}`,
      action: `Carry the credit forward on Form 3800 so it is not lost${research ? ", and if the research continued compute this year's credit on Form 6765 (a qualified small business can elect to apply up to $500,000 of it against payroll taxes, on a timely filed return)" : ""}.`,
      authority: "IRC §§38, 39, 41; Form 3800 and Form 6765 instructions",
      evidence: `Carryovers to ${year || "this year"} and forms list of last year's return; carryovers and forms list of this return.`,
    });
  }

  const otherForms = droppedForms.filter((f) => !(lostCredits.length && CREDIT_FORMS.has(f)));
  if (otherForms.length) {
    const foreign = otherForms.filter((f) => FOREIGN_INFORMATION.has(f));
    findings.push({
      severity: "MEDIUM",
      category: "Missing form",
      title: "Forms filed last year and missing this year",
      detail: `Last year's return included ${listing(otherForms.map((f) => `Form ${f} (${CONTINUING_FORMS[f]})`))}; this year's does not. Each one either ended for a reason worth documenting or is missing${foreign.length ? ", and a missing foreign information return carries a $10,000 penalty per form" : ""}.`,
      action: "Confirm what ended (a sale, a liquidation, a credit fully used) and document it, or add the form before filing.",
      authority: "The filing requirements of each form named",
      evidence: "Forms list of last year's return against this year's.",
    });
  }
  return findings;
}

/* ---------------------------------------------------------------------------
 * 2. Una amortizacion que se cae
 * ------------------------------------------------------------------------- */

const AMORTIZATION_FLOOR = 10000;

/** La amortizacion de la hoja de "OTHER DEDUCTIONS" (1120 linea 26, 1065 linea 21, 1120-S 20). */
function otherDeductionsAmortization(text) {
  const lines = linesOf(text);
  let inside = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^OTHER DEDUCTIONS$/.test(line)) { inside = true; continue; }
    if (!inside) continue;
    const m = /^AMORTIZATION\b[\s.…]*\$?\s*([\d,]+)\.?$/.exec(line);
    if (m) return parseMoney(m[1]);
    if (/^TOTAL\b/.test(line)) inside = false;
  }
  return null;
}

/** Si la amortizacion del año pasado era una deduccion fuera de los libros (M-1 linea 8). */
function amortizationNotOnBooks(text) {
  const lines = linesOf(text);
  const i = lines.findIndex((l) => /SCHEDULE M-1, LINE 8/i.test(l));
  if (i < 0) return false;
  return lines.slice(i, i + 12).some((l) => /^\s*AMORTIZATION\b/.test(l.trim()));
}

function checkAmortizationDropped(currentText, priorText, taxYear) {
  const before = otherDeductionsAmortization(priorText);
  if (!(before >= AMORTIZATION_FLOOR)) return [];
  const now = otherDeductionsAmortization(currentText) || 0;
  if (now >= before * 0.5) return [];
  // Sin la hoja de otros gastos este año no se sabe si la amortizacion esta en otra parte.
  if (!/^OTHER DEDUCTIONS$/m.test(currentText)) return [];
  const offBooks = amortizationNotOnBooks(priorText);
  const research = Number.isFinite(taxYear) && taxYear >= 2025;
  return [{
    severity: "MEDIUM",
    category: "Carryover",
    title: `Other deductions — amortization fell from ${money(before)} to ${money(now)}`,
    detail: `Last year's return deducted ${money(before)} of amortization${offBooks ? ", a deduction that is not on the books (Schedule M-1 line 8)" : ""}; this year's deducts ${money(now)}.${research ? " If it was research costs capitalized under section 174 in 2022-2024, the balance not yet amortized can be deducted in full this year or over this year and the next." : " Find out what was being amortized and why it stopped."}`,
    action: research
      ? "Get the amortization schedule. If the asset is fully amortized, document it; if it is section 174 research costs, attach the statement to deduct the unamortized balance (Rev. Proc. 2025-28) and carry the larger loss forward."
      : "Get the amortization schedule and confirm the remaining basis; amortization does not stop until the cost is recovered.",
    authority: research ? "IRC §§174, 174A, 195, 197; Rev. Proc. 2025-28" : "IRC §§174, 195, 197",
    evidence: "Other deductions statement of both returns; last year's Schedule M-1 line 8 statement.",
  }];
}

/* ---------------------------------------------------------------------------
 * 3. Pagos hechos para este año que esta declaracion no acredita
 * ------------------------------------------------------------------------- */

function checkPriorPaymentsNotCredited(currentText, priorText, taxYear, { individual = false } = {}) {
  const expected = new Map(); // key -> { paid, setUp, dates }
  const add = (key, field, amount, date) => {
    if (!key || (individual && key === "FEDERAL")) return; // el 1040 lo cubre checkEstimatesPlannedNotPaid
    const entry = expected.get(key) || { paid: 0, setUp: 0, dates: [] };
    entry[field] += amount;
    if (date) entry.dates.push(date);
    expected.set(key, entry);
  };
  for (const row of estimatesPaid(priorText)) add(JURISDICTION_KEY[row.jurisdiction], "paid", row.amount, row.date);
  for (const [key, amount] of Object.entries(firstInstallmentsSetUp(currentText))) add(key, "setUp", amount);
  const missing = [];
  for (const [key, entry] of expected) {
    const due = Math.max(entry.paid, entry.setUp);
    if (!(due > 0)) continue;
    const credited = prepaymentsCredited(currentText, key);
    if (!credited) continue; // la linea de este año no se lee: no se afirma nada
    if (credited.value + 1 >= due) continue;
    missing.push({ key, ...entry, due, credited });
  }
  if (!missing.length) return [];
  const priorYear = Number.isFinite(taxYear) ? taxYear - 1 : null;
  const describe = (m) => (m.paid > 0
    ? `${money(m.paid)} paid on ${m.dates.join(", ")} toward ${JURISDICTION_NAME[m.key]}`
    : `a first installment of ${money(m.setUp)} for ${JURISDICTION_NAME[m.key]}`);
  const credits = missing.every((m) => !m.credited.value)
    ? `${listing(missing.map((m) => m.credited.form))} credit${missing.length > 1 ? "" : "s"} nothing`
    : listing(missing.map((m) => `${m.credited.form} credits ${m.credited.value ? money(m.credited.value) : "nothing"}`));
  return [{
    severity: "MEDIUM",
    category: "Payments",
    title: "Prepayments made for this year are not credited",
    detail: `The ${priorYear || "prior-year"} return records ${listing(missing.map(describe))} for ${taxYear || "this year"}; ${credits}.`,
    action: "Confirm in the tax department's online account what was paid for this year and credit it; as filed, the balance due and any underpayment penalty are overstated, and a payment that is never claimed has to be recovered later.",
    authority: "N.Y. Tax Law §213-b (mandatory first installment); NYC Admin. Code §11-605; Form CT-3 and NYC-2 instructions",
    evidence: `Estimates and first-installment lines of the ${priorYear || "prior-year"} return; prepayment lines of this return.`,
  }];
}

/* ---------------------------------------------------------------------------
 * Todo junto
 * ------------------------------------------------------------------------- */

function returnTextOf(file) {
  return String((file && (file.originalText || file.fullText || file.text || file.extractedText)) || "");
}

function runCarryforwardChecks(files, meta = {}) {
  const list = Array.isArray(files) ? files : [];
  const roleOf = (f) => String(f?.reviewRole || f?.role || "").toLowerCase();
  const current = list.find((f) => roleOf(f).includes("current_return"));
  const prior = list.find((f) => roleOf(f).includes("prior_return"));
  if (!current || !prior) return [];
  const currentText = returnTextOf(current);
  const priorText = returnTextOf(prior);
  if (currentText.trim().length < 500 || priorText.trim().length < 500) return [];
  const taxYear = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
  const individual = /Form 1040\b[^\n]{0,60}U\.S\. Individual Income Tax Return|U\.S\. Individual Income Tax Return/.test(currentText.slice(0, 200000))
    && !/U\.S\. Corporation Income Tax Return|U\.S\. Return of Partnership Income|Income Tax Return for an S Corporation/.test(currentText.slice(0, 200000));
  const out = [];
  const run = (check) => {
    try { out.push(...check()); } catch (error) { console.warn(`[carryforward] ${error.message}`); }
  };
  run(() => checkCarryoversAndFormsDropped(currentText, priorText, taxYear));
  run(() => checkAmortizationDropped(currentText, priorText, taxYear));
  run(() => checkPriorPaymentsNotCredited(currentText, priorText, taxYear, { individual }));
  return out;
}

module.exports = {
  runCarryforwardChecks,
  checkCarryoversAndFormsDropped,
  checkAmortizationDropped,
  checkPriorPaymentsNotCredited,
  carryoverItems,
  estimatesPaid,
  firstInstallmentsSetUp,
  prepaymentsCredited,
  otherDeductionsAmortization,
  CONTINUING_FORMS,
};
