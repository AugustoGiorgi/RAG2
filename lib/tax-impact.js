"use strict";

/**
 * tax-impact.js — cuanto impuesto mueve cada hallazgo, estimado.
 *
 * El informe ordenaba por HIGH, MEDIUM y LOW; lo primero que mira un manager es la plata. Cada
 * hallazgo lleva ahora su efecto aproximado en el impuesto federal o en el saldo a favor:
 *
 *  - un credito o un pago (retencion, anticipo, sobrepago aplicado) cuenta peso por peso;
 *  - un ingreso o una deduccion mal cargada se multiplica por la tasa marginal de la declaracion,
 *    que sale del ingreso gravable, el estado civil y el año con los tramos de
 *    lib/tax-calculations.js (los mismos que usa Planning);
 *  - el impuesto mal sumado es la diferencia.
 *
 * De donde sale cada cifra. Los cruces del codigo dicen que mueven ("impact": tipo e importe); las
 * diferencias del tie-out se clasifican por el renglon; los hallazgos del modelo traen su propia
 * estimacion (taxImpact) hecha con la tasa que el codigo le pasa en el pedido, y se rotulan como
 * estimacion de la revision. Fail-closed: sin tasa marginal no se estima nada que dependa de ella,
 * y una estimacion del modelo que excede las cifras de su propio hallazgo no se muestra.
 *
 * En una S corp o una partnership el impuesto lo pagan los socios: no hay tasa de la entidad y
 * solo se estima lo que se paga a nivel entidad (multas, impuestos impresos en la declaracion).
 */

const { calcFederalTax } = require("./tax-calculations");

const money = (n) => `$${Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US")}`;
const pct = (r) => `${Math.round(r * 1000) / 10}%`;
const STATUS = { single: "Single", mfs: "MFS", mfj: "MFJ", hoh: "HOH", qss: "MFJ", estate: "Single", trust: "Single" };

/** Lo que hace falta para estimar: la tasa marginal y de donde sale. */
function taxProfile(files, returnType, meta = {}) {
  try {
    const { splitReturns } = require("./prior-year-bridge");
    const rf = require("./return-facts");
    const list = (Array.isArray(files) ? files : []).map((f) => ({ ...f, reviewRole: f.reviewRole || f.role }));
    const { current } = splitReturns(list, meta);
    if (!current) return null;
    const text = rf.textOf(current);
    const type = String(returnType || "").replace(/\s+/g, "").toUpperCase();
    const stated = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
    if (/^1120$/.test(type) || (!type && /U\.S\. Corporation Income Tax Return/i.test(text.slice(0, 200000)))) {
      return { kind: "c-corp", rate: 0.21, short: "21% corporate rate", basis: "21% corporate rate" };
    }
    if (/^(?:1065|1120-?S)$/.test(type)) return { kind: "pass-through", rate: null, basis: "" };
    let taxable = null;
    let status = null;
    let year = Number.isFinite(stated) && stated > 2000 ? stated : null;
    if (rf.isForm1040NR(text)) {
      taxable = rf.form1040NRLines(text)["15"];
      status = rf.filingStatus1040NR(text);
      year = year || Number((/Form 1040-NR\s*\((20\d{2})\)/.exec(text) || [])[1]) || null;
    } else if (rf.isForm1040(text)) {
      taxable = rf.form1040Lines(text)["15"];
      status = (rf.header1040(text) || {}).filingStatus;
      year = year || rf.form1040Year(text);
    } else return null;
    if (taxable === null || taxable === undefined || !status || !year) return { kind: "individual", rate: null, basis: "" };
    const { marginalRate } = calcFederalTax(Math.max(0, taxable), STATUS[status] || "Single", year);
    return { kind: "individual", rate: marginalRate, short: `${pct(marginalRate)} marginal rate`, basis: `${pct(marginalRate)} marginal rate (taxable income ${money(taxable)}, ${STATUS[status] || status}, ${year})` };
  } catch (error) {
    console.warn(`[tax-impact] ${error.message}`);
    return null;
  }
}

/** El efecto de un "impact" de un cruce: { kind: credit|payment|tax|income|deduction, amount }. */
function fromImpact(impact, profile) {
  if (!impact || !Number.isFinite(Number(impact.amount)) || !Number(impact.amount)) return null;
  const amount = Math.abs(Number(impact.amount));
  if (impact.kind === "credit") return { value: amount, label: `≈ ${money(amount)} of tax (credit dollar for dollar)` };
  if (impact.kind === "payment") return { value: amount, label: `≈ ${money(amount)} of refund or balance due (payment dollar for dollar)` };
  if (impact.kind === "tax") return { value: amount, label: `≈ ${money(amount)} of tax` };
  // Lo que se recupera fuera de la declaracion: la seguridad social retenida de mas.
  if (impact.kind === "recoverable") return { value: amount, label: `≈ ${money(amount)} recoverable outside the return (payroll tax refund)` };
  if ((impact.kind === "income" || impact.kind === "deduction") && profile && profile.rate) {
    const value = amount * profile.rate;
    return { value, label: `≈ ${money(value)} of tax (${money(amount)} × ${profile.short || profile.basis})` };
  }
  return null;
}

/** El tipo de renglon de cada fila del tie-out. */
const TIE_OUT_KIND = [
  [/^form1040(?:-nr)?l(?:1a|1k|2b|3b|7a?|9|11a?|15)$|^scheduledl(?:7|15)$|^scheduleel30$/, "income"],
  [/^form1040(?:-nr)?l(?:23a|24)$/, "tax"],
  [/^form1040(?:-nr)?l(?:25d|25g|26|33)$|^it201l(?:72|75)$|^form540l(?:71|72)$/, "payment"],
];

function fromTieOutIssue(issue, profile, canonicalLineKey) {
  const difference = Number(issue.difference);
  if (!Number.isFinite(difference) || !difference) return null;
  const key = canonicalLineKey(issue.formOrSchedule);
  const kind = (TIE_OUT_KIND.find(([re]) => re.test(key)) || [])[1];
  if (!kind) return null;
  // Los renglones del estado no tienen la tasa federal.
  if (/^(?:it201|form540)/.test(key)) return { value: Math.abs(difference), label: `≈ ${money(difference)} of state refund or balance due (payment dollar for dollar)` };
  return fromImpact({ kind, amount: difference }, profile);
}

const FIGURES = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?/g;

/** La estimacion del modelo, si es un numero razonable para las cifras de su propio hallazgo. */
function fromModel(issue) {
  const raw = issue.taxImpact;
  const value = typeof raw === "number" ? raw : Number(String(raw || "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value) || !value) return null;
  const text = `${issue.issueDescription || ""} ${issue.evidence || ""}`;
  const largest = Math.max(0, ...[...text.matchAll(FIGURES)].map((m) => Number(m[1].replace(/,/g, ""))));
  // Una estimacion mayor que cualquier cifra del hallazgo no sale de el.
  if (!largest || Math.abs(value) > largest * 1.01) return null;
  return { value: Math.abs(value), label: `≈ ${money(value)} (estimated by the review)` };
}

/**
 * Le pone a cada hallazgo su efecto estimado (taxImpact y taxImpactLabel) y ordena, dentro de cada
 * prioridad, de mayor a menor efecto. Lo que no tiene efecto en dolares queda despues, en el orden
 * que tenia; la integridad del paquete y la identidad siguen primero, porque invalidan lo demas.
 */
function attachTaxImpact(issues, profile, { canonicalLineKey } = {}) {
  const list = Array.isArray(issues) ? issues : [];
  let estimated = 0;
  const withImpact = list.map((issue, index) => {
    if (!issue || typeof issue !== "object") return { issue, index, value: 0 };
    let result = null;
    if (issue.impact) result = fromImpact(issue.impact, profile);
    else if (issue.source === "Tie-out computed by RAG Tax AI" && canonicalLineKey) result = fromTieOutIssue(issue, profile, canonicalLineKey);
    else if (issue.taxImpact !== undefined && issue.taxImpact !== null && issue.taxImpact !== "") result = fromModel(issue);
    const { impact, ...rest } = issue;
    if (!result || result.value < 1) {
      const { taxImpact, ...clean } = rest;
      return { issue: clean, index, value: 0 };
    }
    estimated += 1;
    return { issue: { ...rest, taxImpact: Math.round(result.value), taxImpactLabel: result.label }, index, value: result.value };
  });
  const rank = (p) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[String(p || "").toUpperCase()] ?? 3);
  const pinned = (i) => /package integrity|identity/i.test(String(i && (i.category || i.areaReviewed) || ""));
  const ordered = withImpact.sort((a, b) => (
    rank(a.issue && a.issue.priority) - rank(b.issue && b.issue.priority)
    || Number(pinned(b.issue)) - Number(pinned(a.issue))
    || b.value - a.value
    || a.index - b.index
  ));
  return { issues: ordered.map((x) => x.issue), estimated };
}

/** La linea del pedido que le da al modelo la tasa con la que estima. */
function promptLine(profile) {
  if (!profile) return "";
  if (profile.kind === "pass-through") return "TAX EFFECT: this is a pass-through entity; set taxImpact only for amounts paid at the entity level (penalties, entity-level taxes), otherwise null.";
  const rate = profile.rate ? `Use the ${profile.basis} computed by the app for income and deduction items.` : "The app could not compute a marginal rate; set taxImpact only for credits, payments and tax lines.";
  return `TAX EFFECT: for every issue set taxImpact to your estimate, in whole dollars, of how much federal tax or refund changes if the item is corrected. ${rate} Credits, withholding and payments count dollar for dollar. Use null when the issue does not change a dollar amount (a missing form, a question, an election).`;
}

module.exports = { taxProfile, attachTaxImpact, fromImpact, fromTieOutIssue, fromModel, promptLine, TIE_OUT_KIND };
