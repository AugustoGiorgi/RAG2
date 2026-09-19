"use strict";

/**
 * individual-checks.js — cruces del 1040 contra el año anterior y contra los documentos.
 *
 * Lo que no se puede pasar en una declaracion personal casi nunca es un calculo dentro de un
 * formulario: es algo que venia del año anterior y no se trajo (el sobrepago aplicado, la perdida
 * de capital a trasladar, el §179 no deducido), un documento del paquete que no llego a su
 * renglon (el 1099-R, el SSA-1099, el 1095-A) o un dato de identidad que cambio sin razon (el SSN
 * de un dependiente). Todo eso se decide comparando dos cifras o dos listas, siempre igual.
 *
 * Mismo criterio que el resto de los modulos: si un renglon no se deja leer, no hay hallazgo.
 * Los SSN salen enmascarados: solo los cuatro ultimos digitos.
 */

const { splitReturns } = require("./prior-year-bridge");
const rf = require("./return-facts");
const pd = require("./package-docs");

const fmt = (n) => `$${Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US")}`;
const last4 = (ssn) => `XXX-XX-${String(ssn || "").slice(-4)}`;
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const STATUS_LABEL = { single: "Single", mfj: "Married filing jointly", mfs: "Married filing separately", hoh: "Head of household", qss: "Qualifying surviving spouse" };

/** Todo lo que los cruces del 1040 necesitan, leido una sola vez. */
function context(files, meta = {}) {
  const { current, prior } = splitReturns(files, meta);
  if (!current) return null;
  const text = rf.textOf(current);
  if (!rf.isForm1040(text)) return null;
  const priorText = prior ? rf.textOf(prior) : "";
  const priorIs1040 = priorText && rf.isForm1040(priorText);
  const taxYear = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]) || rf.form1040Year(text) || null;
  return {
    current, prior, text, priorText: priorIs1040 ? priorText : "", taxYear,
    now: meta.now ? new Date(meta.now) : new Date(),
    lines: rf.form1040Lines(text),
    header: rf.header1040(text),
    boxes: rf.checkboxes1040(text),
    priorLines: priorIs1040 ? rf.form1040Lines(priorText) : null,
    priorHeader: priorIs1040 ? rf.header1040(priorText) : null,
    docs: pd.packageDocuments(files, { exclude: new Set([current, prior].filter(Boolean)) }),
  };
}

function finding(severity, category, title, detail, action, authority, evidence) {
  return { severity, category, title, detail, action, authority, evidence };
}

/* ---------------------------------------------------------------------------
 * Identidad contra el año anterior
 * ------------------------------------------------------------------------- */

/** Cuantos digitos difieren entre dos SSN (para distinguir un tipeo de otra persona). */
function digitDistance(a, b) {
  const x = String(a || "").replace(/\D/g, "");
  const y = String(b || "").replace(/\D/g, "");
  if (x.length !== 9 || y.length !== 9) return 9;
  let d = 0;
  for (let i = 0; i < 9; i += 1) if (x[i] !== y[i]) d += 1;
  return d;
}

function checkSpouseSsn(ctx) {
  const now = ctx.header && ctx.header.spouse;
  const before = ctx.priorHeader && ctx.priorHeader.spouse;
  if (!now || !before || now.ssn === before.ssn) return [];
  const typo = digitDistance(now.ssn, before.ssn) <= 2;
  return [finding(
    "HIGH", "Identity", "Form 1040 — spouse's SSN differs from last year",
    `The spouse's SSN on this return ends in ${now.ssn.slice(-4)}; last year's return shows ${before.ssn.slice(-4)}${typo ? ", a difference of one or two digits that looks like a typing error" : ""}.`,
    "Confirm the spouse's SSN against the Social Security card. A wrong SSN rejects the e-file or attributes income to another person.",
    "Form 1040 instructions; IRC §6109", "Form 1040 header, this year and last year.",
  )];
}

function checkDependents(ctx) {
  const now = (ctx.header && ctx.header.dependents) || [];
  const before = (ctx.priorHeader && ctx.priorHeader.dependents) || [];
  if (!ctx.priorHeader || (!now.length && !before.length)) return [];
  const added = now.filter((s) => !before.includes(s));
  const removed = before.filter((s) => !now.includes(s));
  if (!added.length && !removed.length) return [];
  const typos = added.map((a) => [a, removed.find((r) => digitDistance(a, r) <= 2)]).filter(([, r]) => r);
  if (typos.length) {
    return [finding(
      "HIGH", "Identity", "Form 1040 — a dependent's SSN changed from last year",
      typos.map(([a, r]) => `A dependent's SSN ends in ${a.slice(-4)} this year and ${r.slice(-4)} last year — one or two digits apart, which reads as a typing error.`).join(" "),
      "Check the SSN against the dependent's Social Security card. A wrong SSN blocks the child tax credit and can reject the e-file.",
      "IRC §24(h)(7); Form 1040 instructions", "Dependents section of Form 1040, this year and last year.",
    )];
  }
  const parts = [];
  if (added.length) parts.push(`${added.length} dependent${added.length > 1 ? "s" : ""} new this year (${added.map(last4).join(", ")})`);
  if (removed.length) parts.push(`${removed.length} dependent${removed.length > 1 ? "s" : ""} claimed last year and not this year (${removed.map(last4).join(", ")})`);
  return [finding(
    "LOW", "Identity", "Form 1040 — dependents changed from last year",
    `${parts.join("; ")}.`,
    "Confirm the change with the client (birth, age-out, custody, a dependent filing their own return).",
    "IRC §152; Form 1040 instructions", "Dependents section of Form 1040, this year and last year.",
  )];
}

function checkFilingStatusChange(ctx) {
  const now = ctx.header && ctx.header.filingStatus;
  const before = ctx.priorHeader && ctx.priorHeader.filingStatus;
  if (!now || !before || now === before) return [];
  return [finding(
    "MEDIUM", "Identity", "Form 1040 — filing status changed from last year",
    `The filing status is ${STATUS_LABEL[now]} this year and was ${STATUS_LABEL[before]} last year.`,
    "Confirm the event behind the change (marriage, divorce, separation, death of a spouse) and its date; it changes brackets, the standard deduction and several credits.",
    "IRC §1, §2, §7703", "Filing Status section of Form 1040, this year and last year.",
  )];
}

/* ---------------------------------------------------------------------------
 * Arrastres del año anterior
 * ------------------------------------------------------------------------- */

function checkOverpaymentApplied(ctx) {
  if (!ctx.priorLines) return [];
  const applied = ctx.priorLines["36"];
  if (!applied || applied <= 0) return [];
  const line26 = num(ctx.lines["26"]);
  if (line26 + 1 >= applied) return [];
  return [finding(
    "HIGH", "Carryover", "Form 1040 line 26 — last year's overpayment not applied",
    `Last year's return applied ${fmt(applied)} of its overpayment to this year's estimated tax (line 36), but line 26 of this return shows ${line26 ? fmt(line26) : "nothing"}.`,
    "Add the applied overpayment to line 26 together with this year's estimated payments. If it was refunded instead, get the IRS account transcript to confirm.",
    "Form 1040 instructions, line 26", "Form 1040 line 36 of last year's return; line 26 of this return.",
  )];
}

function checkCapitalLossCarryover(ctx) {
  if (!ctx.priorText) return [];
  const before = rf.scheduleD(ctx.priorText);
  if (!before || before.net === null || before.net >= 0 || before.allowedLoss === null) return [];
  const expected = Math.abs(before.net) - Math.abs(before.allowedLoss);
  if (expected < 1) return [];
  const now = rf.scheduleD(ctx.text);
  const brought = now ? num(now.stCarryover) + num(now.ltCarryover) : 0;
  if (brought > 0 && Math.abs(Math.abs(brought) - expected) <= 1) return [];
  if (brought > 0) {
    return [finding(
      "MEDIUM", "Carryover", "Schedule D lines 6 and 14 — capital loss carryover differs from last year",
      `Last year's Schedule D ended with a net capital loss of ${fmt(before.net)}, of which ${fmt(before.allowedLoss)} was deducted, leaving about ${fmt(expected)} to carry forward; this year's lines 6 and 14 bring in ${fmt(brought)}.`,
      "Recompute the carryover with the Capital Loss Carryover Worksheet (it also depends on last year's taxable income) and correct lines 6 and 14.",
      "IRC §1212(b); Schedule D instructions", "Schedule D lines 16 and 21 of last year's return; lines 6 and 14 of this return.",
    )];
  }
  return [finding(
    "HIGH", "Carryover", "Schedule D lines 6 and 14 — capital loss carryover not brought forward",
    `Last year's Schedule D ended with a net capital loss of ${fmt(before.net)}, of which ${fmt(before.allowedLoss)} was deducted, so about ${fmt(expected)} carries to this year. Lines 6 and 14 of this return are ${now ? "blank" : "missing (there is no Schedule D)"}.`,
    "Bring the carryover in on Schedule D lines 6 (short-term) and 14 (long-term) using the Capital Loss Carryover Worksheet. A carryover that is not claimed is lost in silence.",
    "IRC §1212(b); Schedule D instructions", "Schedule D lines 16 and 21 of last year's return; lines 6 and 14 of this return.",
  )];
}

function checkSection179Carryover(ctx) {
  if (!ctx.priorText) return [];
  const before = rf.form4562Carryover(ctx.priorText);
  if (!before.toNext || before.toNext <= 0) return [];
  const now = rf.form4562Carryover(ctx.text);
  if (now.fromPrior !== null && Math.abs(now.fromPrior - before.toNext) <= 1) return [];
  return [finding(
    "MEDIUM", "Carryover", "Form 4562 line 10 — §179 carryover not brought forward",
    `Last year's Form 4562 carried ${fmt(before.toNext)} of disallowed §179 deduction to this year (line 13); this return's line 10 shows ${now.fromPrior ? fmt(now.fromPrior) : "nothing"}.`,
    "Enter the carryover on Form 4562 line 10; it is deductible this year subject to the business income limit.",
    "IRC §179(b)(3)(B); Form 4562 instructions", "Form 4562 line 13 of last year's return; line 10 of this return.",
  )];
}

function checkInstallmentSaleContinues(ctx) {
  if (!ctx.priorText || !rf.hasForm(ctx.priorText, "6252") || rf.hasForm(ctx.text, "6252")) return [];
  return [finding(
    "MEDIUM", "Carryover", "Form 6252 — installment sale reported last year, not this year",
    "Last year's return included Form 6252 (installment sale); this return has none, so any payment received this year and its share of gain are not reported.",
    "Confirm whether payments were received in the year. Each year with payments needs Form 6252 until the note is paid off or disposed of.",
    "IRC §453; Form 6252 instructions", "Form 6252 in last year's return; forms included in this return.",
  )];
}

/* ---------------------------------------------------------------------------
 * Pagos
 * ------------------------------------------------------------------------- */

function checkEstimatesPlannedNotPaid(ctx) {
  if (!ctx.priorText) return [];
  const plan = rf.estimateVouchers(ctx.priorText).filter((v) => v.amount);
  const planned = plan.reduce((s, v) => s + v.amount, 0);
  if (planned < 1000) return [];
  const line26 = num(ctx.lines["26"]);
  if (line26 > 0) return [];
  return [finding(
    "MEDIUM", "Payments", "Form 1040 line 26 — estimates planned last year, none reported",
    `Last year's return left ${plan.length} estimate voucher${plan.length > 1 ? "s" : ""} for this year totaling ${fmt(planned)}, and line 26 of this return is blank.`,
    "Ask the client whether the estimates were paid (IRS Direct Pay or EFTPS confirmations, or the account transcript). A payment that was made and is not claimed is lost; one that was not made may carry an underpayment penalty.",
    "IRC §6654; Form 1040 instructions, line 26", "Form 1040-ES vouchers printed with last year's return; line 26 of this return.",
  )];
}

/** El pago con la prorroga: lo que dice el 4868 impreso con la declaracion contra el Schedule 3. */
function checkExtensionPayment(ctx) {
  const lines = rf.linesOf(ctx.text);
  const i = lines.findIndex((l) => /Application for Automatic Extension of Time To File U\.S\. Individual/i.test(l));
  if (i < 0) return [];
  const paid = rf.lineAmount(lines, /Amount you.re paying/i, "7", { from: i, to: i + 90 });
  if (!paid || paid <= 0) return [];
  const s3 = rf.schedule3(ctx.text);
  const claimed = s3 ? num(s3.extensionPayment) : 0;
  if (Math.abs(claimed - paid) <= 1) return [];
  return [finding(
    "HIGH", "Payments", "Schedule 3 line 10 — extension payment not claimed",
    `The Form 4868 in the return shows ${fmt(paid)} paid with the extension, and Schedule 3 line 10 shows ${claimed ? fmt(claimed) : "nothing"}.`,
    "Claim the extension payment on Schedule 3 line 10 (it flows to Form 1040 line 31). Confirm the payment was actually made.",
    "Form 1040 instructions; Schedule 3 line 10", "Form 4868 line 7; Schedule 3 line 10.",
  )];
}

/* ---------------------------------------------------------------------------
 * Documentos del paquete contra renglones
 * ------------------------------------------------------------------------- */

/**
 * Box 1 y box 2 de los W-2 con texto. El W-2 de nomina trae dos copias por renglon; se cuentan
 * los grupos de rotulos y los importes: un importe por grupo es el box 1 (box 2 vacio), dos por
 * grupo son box 1 y box 2. Cualquier otra forma no se lee.
 */
function w2Amounts(doc) {
  const lines = String(doc.text || "").split(/\r?\n/);
  const seen = new Map();
  for (let i = 0; i < lines.length - 1; i += 1) {
    const groups = (lines[i].match(/Wages, tips, other compensation/gi) || []).length;
    if (!groups || !/Federal income tax withheld/i.test(lines[i])) continue;
    const values = (lines[i + 1].match(/\b\d{1,3}(?:,\d{3})*\.\d{2}\b|\b\d+\.\d{2}\b/g) || []).map((v) => Number(v.replace(/,/g, "")));
    if (!values.length || /[A-Za-z]{3}/.test(lines[i + 1])) continue;
    const ein = (lines.slice(i, i + 8).join(" ").match(/\b\d{2}-\d{7}\b/) || [""])[0];
    let pairs = null;
    if (values.length === groups) pairs = values.map((v) => [v, 0]);
    else if (values.length === groups * 2) pairs = values.reduce((acc, v, k) => (k % 2 ? acc : acc.concat([[v, values[k + 1]]])), []);
    if (!pairs) return null;
    for (const [box1, box2] of pairs) seen.set(`${ein}|${box1}|${box2}`, { ein, box1, box2 });
  }
  return [...seen.values()];
}

function checkW2AgainstReturn(ctx) {
  const w2s = pd.has(ctx.docs, "w2");
  if (!w2s.length) return [];
  const parsed = w2s.map(w2Amounts);
  if (parsed.some((p) => p === null)) return [];
  const all = parsed.flat();
  const box1 = all.reduce((s, w) => s + w.box1, 0);
  const box2 = all.reduce((s, w) => s + w.box2, 0);
  const out = [];
  const line1a = num(ctx.lines["1a"]);
  if (box1 > line1a + 1) {
    out.push(finding(
      "HIGH", "Income", "Form 1040 line 1a — W-2 wages in the package exceed the return",
      `The W-2s in the package add to ${fmt(box1)} of box 1 wages, and line 1a reports ${fmt(line1a)}: at least ${fmt(box1 - line1a)} of wages is not on the return.`,
      "Find the W-2 that was not entered and add it. The IRS matches every W-2 to line 1a.",
      "IRC §61; Form 1040 instructions, line 1a", `W-2s: ${w2s.map((d) => d.name).join("; ")}.`,
    ));
  }
  const line25a = num(ctx.lines["25a"]);
  if (box2 > 0 && line25a > box2 + 1 && box1 >= line1a - 1) {
    out.push(finding(
      "HIGH", "Payments", "Form 1040 line 25a — withholding claimed exceeds the W-2s",
      `Line 25a claims ${fmt(line25a)} of W-2 withholding and the W-2s in the package show ${fmt(box2)} in box 2.`,
      "Correct line 25a to the W-2s. Withholding the IRS cannot match is disallowed and the refund is reduced.",
      "IRC §31; Form 1040 instructions, line 25a", `W-2s: ${w2s.map((d) => d.name).join("; ")}.`,
    ));
  }
  return out;
}

/** Un documento del paquete que tiene que tener su renglon, y el renglon esta vacio. */
function presenceChecks(ctx) {
  const L = ctx.lines;
  const out = [];
  const docsOf = (type) => pd.has(ctx.docs, type).filter((d) => !d.year || !ctx.taxYear || d.year === ctx.taxYear);
  const names = (docs) => docs.map((d) => d.name).join("; ");

  const r = docsOf("1099-r");
  if (r.length && !num(L["4a"]) && !num(L["5a"]) && !num(L["4b"]) && !num(L["5b"])) {
    out.push(finding("HIGH", "Income", "Form 1040 lines 4a–5b — Form 1099-R not reported",
      `The package has ${r.length} Form 1099-R (${names(r)}) and lines 4a, 4b, 5a and 5b are blank.`,
      "Report the distribution on line 4 (IRA) or 5 (pension/annuity), including a rollover (gross on 4a/5a, taxable 0 with the rollover box). The IRS matches every 1099-R.",
      "IRC §72, §402, §408; Form 1040 instructions, lines 4–5", `1099-R: ${names(r)}.`));
  }
  const ssa = docsOf("ssa-1099");
  if (ssa.length && !num(L["6a"])) {
    out.push(finding("HIGH", "Income", "Form 1040 line 6a — SSA-1099 not reported",
      `The package has an SSA-1099 (${names(ssa)}) and line 6a is blank.`,
      "Report the benefits on line 6a and compute the taxable part on 6b.", "IRC §86; Form 1040 instructions, line 6", `SSA-1099: ${names(ssa)}.`));
  }
  const aca = docsOf("1095-a");
  if (aca.length && !rf.hasForm(ctx.text, "8962")) {
    out.push(finding("HIGH", "Credits", "Form 8962 — Form 1095-A with no premium tax credit reconciliation",
      `The package has a Form 1095-A (${names(aca)}) and the return has no Form 8962.`,
      "Reconcile the advance premium tax credit on Form 8962. The IRS rejects or holds a return that omits it when advance payments were made.",
      "IRC §36B; Form 8962 instructions", `1095-A: ${names(aca)}.`));
  }
  const hsa = [...docsOf("5498-sa"), ...docsOf("1099-sa")];
  if (hsa.length && !rf.hasForm(ctx.text, "8889")) {
    out.push(finding("MEDIUM", "Deductions", "Form 8889 — HSA documents with no Form 8889",
      `The package has HSA documents (${names(hsa)}) and the return has no Form 8889.`,
      "File Form 8889 for the contributions and distributions; distributions not used for medical expenses are taxable with a 20% additional tax.",
      "IRC §223; Form 8889 instructions", `HSA documents: ${names(hsa)}.`));
  }
  const tuition = docsOf("1098-t");
  if (tuition.length && !rf.hasForm(ctx.text, "8863")) {
    out.push(finding("LOW", "Credits", "Form 8863 — Form 1098-T with no education credit",
      `The package has a Form 1098-T (${names(tuition)}) and the return claims no education credit.`,
      "Confirm eligibility (income limits, who paid, scholarships in box 5). If the student qualifies, the American opportunity credit is partly refundable.",
      "IRC §25A; Form 8863 instructions", `1098-T: ${names(tuition)}.`));
  }
  const g = docsOf("1099-g");
  const s1 = rf.schedule1(ctx.text);
  if (g.length && !(s1 && (num(s1.unemployment) || num(s1.refunds)))) {
    out.push(finding("MEDIUM", "Income", "Schedule 1 — Form 1099-G not reflected",
      `The package has a Form 1099-G (${names(g)}) and Schedule 1 shows no unemployment compensation (line 7) and no taxable state refund (line 1).`,
      "Report unemployment on line 7. A state refund is taxable on line 1 only to the extent last year's itemized deduction for state taxes gave a benefit; document why if it is left out.",
      "IRC §85, §111; Schedule 1 instructions", `1099-G: ${names(g)}.`));
  }
  const selfEmployed = [...docsOf("1099-nec"), ...docsOf("1099-k")];
  if (selfEmployed.length && !rf.hasForm(ctx.text, "SCH C") && !(s1 && (num(s1.business) || num(s1.scheduleE)))) {
    out.push(finding("MEDIUM", "Income", "Schedule C — 1099-NEC or 1099-K with no business income",
      `The package has ${names(selfEmployed)} and the return reports no business income (no Schedule C, Schedule 1 line 3 blank).`,
      "Report the income on Schedule C (and Schedule SE) or explain why it belongs elsewhere. The IRS matches these forms.",
      "IRC §61, §1402; Schedule C instructions", `Documents: ${names(selfEmployed)}.`));
  }
  const brokerage = ctx.docs.filter((d) => (d.types.includes("1099-div") || d.types.includes("1099-int")) && (!d.year || !ctx.taxYear || d.year === ctx.taxYear));
  if (brokerage.length && !num(L["2b"]) && !num(L["3b"]) && !num(L["2a"])) {
    out.push(finding("HIGH", "Income", "Form 1040 lines 2–3 — brokerage 1099 with no interest or dividends",
      `The package has ${brokerage.length} statement${brokerage.length > 1 ? "s" : ""} with 1099-INT or 1099-DIV (${names(brokerage)}) and lines 2a, 2b and 3b are blank.`,
      "Enter the interest and dividends from each statement (and the 1099-B sales on Form 8949 / Schedule D).",
      "IRC §61; Form 1040 instructions, lines 2–3", `Statements: ${names(brokerage)}.`));
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Aritmetica interna y umbrales
 * ------------------------------------------------------------------------- */

function checkArithmetic1040(ctx) {
  const L = ctx.lines;
  const out = [];
  const known = (...keys) => keys.every((k) => L[k] !== null && L[k] !== undefined);
  const sum = (...keys) => keys.reduce((s, k) => s + num(L[k]), 0);
  const bad = [];
  if (known("24", "33") && (L["37"] !== null || L["34"] !== null)) {
    const diff = num(L["24"]) - num(L["33"]);
    if (diff > 0 && L["37"] !== null && Math.abs(num(L["37"]) - num(L["38"]) - diff) > 1 && Math.abs(num(L["37"]) - diff) > 1) bad.push(`line 24 (${fmt(L["24"])}) minus line 33 (${fmt(L["33"])}) is ${fmt(diff)}, but line 37 shows ${fmt(L["37"])}`);
    if (diff < 0 && L["34"] !== null && Math.abs(num(L["34"]) + diff) > 1) bad.push(`line 33 (${fmt(L["33"])}) minus line 24 (${fmt(L["24"])}) is ${fmt(-diff)}, but line 34 shows ${fmt(L["34"])}`);
  }
  if (known("25a", "25d") && Math.abs(sum("25a", "25b", "25c") - num(L["25d"])) > 1) bad.push(`lines 25a–25c add to ${fmt(sum("25a", "25b", "25c"))}, but line 25d shows ${fmt(L["25d"])}`);
  if (known("34") && L["35a"] !== null && num(L["35a"]) + num(L["36"]) > num(L["34"]) + 1) bad.push(`the refund (line 35a, ${fmt(L["35a"])}) plus the amount applied to next year (line 36, ${fmt(L["36"])}) exceed the overpayment on line 34 (${fmt(L["34"])})`);
  if (bad.length) {
    out.push(finding("MEDIUM", "Arithmetic", "Form 1040 — lines that do not add up",
      `On this return ${bad.join("; ")}.`,
      "Look for an amount typed over a calculated line in the software and recompute.", "Form 1040 instructions", "Form 1040 page 2."));
  }
  return out;
}

const NIIT_THRESHOLD = { single: 200000, hoh: 200000, qss: 250000, mfj: 250000, mfs: 125000 };

function checkThresholdForms(ctx) {
  const status = ctx.header && ctx.header.filingStatus;
  if (!status) return [];
  const L = ctx.lines;
  const out = [];
  const threshold = NIIT_THRESHOLD[status];
  const agi = num(L["11"]);
  const investment = num(L["2b"]) + num(L["3b"]) + Math.max(0, num(L["7"]));
  if (agi > threshold && investment > 1000 && !rf.hasForm(ctx.text, "8960")) {
    out.push(finding("MEDIUM", "Tax computation", "Form 8960 — net investment income tax not computed",
      `Modified AGI of ${fmt(agi)} is over the ${fmt(threshold)} threshold for ${STATUS_LABEL[status]}, with ${fmt(investment)} of interest, dividends and capital gains, and the return has no Form 8960.`,
      "Compute the 3.8% net investment income tax on Form 8960 (Schedule 2 line 12).",
      "IRC §1411; Form 8960 instructions", "Form 1040 lines 2b, 3b, 7 and 11; forms included in the return."));
  }
  const wages = num(L["1a"]);
  if (wages > threshold && !rf.hasForm(ctx.text, "8959")) {
    out.push(finding("MEDIUM", "Tax computation", "Form 8959 — additional Medicare tax not computed",
      `Wages of ${fmt(wages)} are over the ${fmt(threshold)} threshold for ${STATUS_LABEL[status]} and the return has no Form 8959.`,
      "Compute the 0.9% additional Medicare tax on Form 8959; withholding by each employer only starts at $200,000 per job, so two jobs or a working spouse leave it short.",
      "IRC §3101(b)(2); Form 8959 instructions", "Form 1040 line 1a; forms included in the return."));
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Residencia contra los documentos
 * ------------------------------------------------------------------------- */

/**
 * Estados que los documentos del año ponen como domicilio del contribuyente. Se busca el bloque
 * del destinatario tal como se imprime en un sobre: el nombre, una calle con numero y la ciudad
 * con estado y ZIP en los renglones siguientes. La direccion del emisor esta en el mismo papel y
 * no puede contar.
 */
// El renglon empieza con la ciudad; en los formularios suele seguir texto impreso del formulario.
const CITY_LINE = /^\s*([A-Z][A-Za-z .'-]{1,40}?),?\s+([A-Z]{2})\s+(\d{5})(?:-?\d{4})?\b/;
const STREET_LINE = /^\s*\d{1,6}\s+[A-Za-z0-9]/;

function documentStates(ctx) {
  const surname = String((ctx.header && ctx.header.taxpayer && ctx.header.taxpayer.name) || "").trim().split(/\s+/).pop();
  if (!surname || surname.length < 3) return [];
  const nameRe = new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const out = [];
  const seenTexts = new Set();
  for (const doc of ctx.docs) {
    if (!doc.text || !doc.types.some((t) => /^(1098|1099-|w2|ssa-1099|1095-a|5498)/.test(t))) continue;
    if (doc.year && ctx.taxYear && doc.year !== ctx.taxYear) continue;
    // El mismo archivo repetido dentro del ZIP es un documento, no dos.
    if (seenTexts.has(doc.text)) continue;
    seenTexts.add(doc.text);
    const lines = doc.text.split(/\r?\n/).slice(0, 120);
    let hit = null;
    for (let i = 0; i < lines.length && !hit; i += 1) {
      if (!nameRe.test(lines[i])) continue;
      // Una casilla del formulario ("6 Points paid...") tambien empieza con numero: vale la calle
      // que tiene la ciudad en el renglon siguiente.
      for (let j = i + 1; j <= i + 3 && !hit; j += 1) {
        if (!STREET_LINE.test(lines[j] || "")) continue;
        const city = CITY_LINE.exec(lines[j + 1] || "");
        if (city) hit = { doc: doc.name, city: city[1].trim(), state: city[2] };
      }
    }
    if (hit) out.push(hit);
  }
  return out;
}

function checkStateMove(ctx) {
  const now = ctx.header && ctx.header.state;
  const before = ctx.priorHeader && ctx.priorHeader.state;
  if (!now || !before || now === before) return [];
  // Los documentos del año en el estado anterior ya lo cuentan (checkResidencyAgainstDocuments).
  if (checkResidencyAgainstDocuments(ctx).some((f) => f.detail.includes(`Last year's return also gave a ${before} address`))) return [];
  return [finding("MEDIUM", "State residency", "Residency — the home address moved to another state",
    `Last year's return gave a ${before} address (${ctx.priorHeader.city}); this year's gives ${now} (${ctx.header.city}).`,
    "Confirm the move date. A move during this year needs part-year resident returns in both states with income allocated by period; a move before January 1 still leaves any income sourced to the old state on a nonresident return there.",
    "State residency rules; the states' part-year resident instructions", "Form 1040 header, this year and last year.")];
}

function checkResidencyAgainstDocuments(ctx) {
  const home = ctx.header && ctx.header.state;
  if (!home) return [];
  const found = documentStates(ctx).filter((d) => d.state !== home);
  const byState = {};
  for (const d of found) (byState[d.state] = byState[d.state] || []).push(d);
  const strong = Object.entries(byState).filter(([, list]) => new Set(list.map((d) => d.doc)).size >= 2);
  if (!strong.length) return [];
  // Si el año pasado vivia en ese mismo estado, es la misma historia: se dice una vez.
  const before = ctx.priorHeader && ctx.priorHeader.state;
  const moved = before && before !== home && strong.some(([state]) => state === before)
    ? ` Last year's return also gave a ${before} address (${ctx.priorHeader.city}).` : "";
  return [finding("MEDIUM", "State residency", "Residency — documents place the taxpayer in another state",
    strong.map(([state, list]) => `${new Set(list.map((d) => d.doc)).size} documents for the year are addressed to the taxpayer in ${state} (${[...new Set(list.map((d) => `${d.doc} — ${d.city}`))].join("; ")}), while the return gives a ${home} address.`).join(" ") + moved,
    "Confirm the dates the taxpayer lived in each state. If part of the year was spent in the other state, a part-year resident return is needed there and income has to be allocated by period.",
    "State residency rules; the state's part-year resident instructions", "Recipient addresses on the documents in the package; Form 1040 header."),
  ];
}

/* ---------------------------------------------------------------------------
 * Preguntas respondidas
 * ------------------------------------------------------------------------- */

function checkScheduleE1099Questions(ctx) {
  const lines = rf.linesOf(ctx.text);
  const a = lines.find((l) => /Did you make any payments in \d{4} that would require you to file Form\(s\) 1099/i.test(l));
  const b = lines.find((l) => /did you or will you file required Form\(s\) 1099/i.test(l));
  if (!a || !b) return [];
  const ans = (line) => (/\[ANSWER: (Yes|No)\]/.exec(line) || [])[1];
  if (ans(a) !== "Yes" || ans(b) !== "No") return [];
  return [finding("MEDIUM", "Questions", "Schedule E questions A and B — 1099s required and not filed",
    "Schedule E answers Yes to question A (payments that require Forms 1099) and No to question B (the required 1099s were not and will not be filed).",
    "If payments of $600 or more went to non-corporate providers, file the 1099-NECs (late) and answer B Yes; if there were none, answer A No. As filed, the return admits a failure to file.",
    "IRC §6041, §6721, §6722; Schedule E instructions", "Schedule E, questions A and B."),
  ];
}

function checkDigitalAssetsQuestion(ctx) {
  const line = rf.linesOf(ctx.text).find((l) => /dispose of a digital asset/i.test(l));
  if (!line || !/\[ANSWER: No\]/.test(line)) return [];
  const crypto = ctx.docs.filter((d) => d.types.includes("1099-da") || /\b(?:coinbase|kraken|gemini|crypto|bitcoin|digital asset)\b/i.test(`${d.name} ${String(d.text).slice(0, 3000)}`));
  if (!crypto.length) return [];
  return [finding("MEDIUM", "Questions", "Form 1040 — digital asset question answered No",
    `The return answers No to the digital asset question, and the package has ${crypto.map((d) => d.name).join("; ")}.`,
    "Answer the question Yes if there was any sale, exchange or receipt of a digital asset, and report the transactions on Form 8949.",
    "Form 1040 instructions, digital assets", `Documents: ${crypto.map((d) => d.name).join("; ")}.`),
  ];
}

/* ---------------------------------------------------------------------------
 * Mas arrastres: perdida operativa, QBI, intereses de inversion y del negocio
 * ------------------------------------------------------------------------- */

function checkNolCarryover(ctx) {
  if (!ctx.priorLines) return [];
  const priorAgi = ctx.priorLines["11"];
  if (!(priorAgi < -1000)) return [];
  const s1 = rf.schedule1(ctx.text);
  if (s1 && num(s1.nol) > 0) return [];
  return [finding("MEDIUM", "Carryover", "Schedule 1 line 8a — no net operating loss after a negative year",
    `Last year's adjusted gross income was ${fmt(priorAgi)} (negative), and this return carries no net operating loss on Schedule 1 line 8a.`,
    "Compute last year's NOL (Form 172 / the NOL worksheet: business losses, not personal deductions) and carry it forward. Post-2017 NOLs carry forward indefinitely and offset up to 80% of taxable income.",
    "IRC §172; Form 172 instructions", "Form 1040 line 11 of last year's return; Schedule 1 line 8a of this return.")];
}

function checkQbiLossCarryover(ctx) {
  if (!ctx.priorText) return [];
  const before = rf.qbiCarryforward(ctx.priorText);
  const now = rf.qbiCarryforward(ctx.text);
  const out = [];
  const lost = (out1, in1) => out1 !== null && out1 <= -1 && Math.abs(num(in1)) < Math.abs(out1) - 1;
  if (lost(before.qbiOut, now.qbiIn)) {
    out.push(finding("HIGH", "Carryover", "Form 8995/8995-A — qualified business loss carryforward dropped",
      `Last year's return carried ${fmt(before.qbiOut)} of qualified business net loss to this year, and this return brings in ${now.qbiIn ? fmt(now.qbiIn) : "nothing"} (Form 8995 line 3 / Form 8995-A Schedule C line 2).`,
      "Bring the carryforward in: it reduces this year's qualified business income, so leaving it out overstates the QBI deduction — an error the IRS can assess with interest and penalty.",
      "IRC §199A(c)(2); Treas. Reg. §1.199A-1(d)(2)(iii); Form 8995/8995-A instructions", "QBI loss carryforward on last year's Form 8995/8995-A; the carryforward line of this year's form."));
  }
  if (lost(before.reitOut, now.reitIn)) {
    out.push(finding("MEDIUM", "Carryover", "Form 8995/8995-A — REIT/PTP loss carryforward dropped",
      `Last year's return carried ${fmt(before.reitOut)} of qualified REIT dividends and PTP loss to this year, and this return brings in ${now.reitIn ? fmt(now.reitIn) : "nothing"}.`,
      "Bring the REIT/PTP loss carryforward in (Form 8995 line 7 / Form 8995-A line 29); it reduces this year's REIT/PTP component.",
      "IRC §199A(b)(1)(B); Form 8995/8995-A instructions", "REIT/PTP carryforward lines, last year and this year."));
  }
  return out;
}

function checkInvestmentInterestCarryover(ctx) {
  if (!ctx.priorText) return [];
  const before = rf.form4952(ctx.priorText);
  if (!(before.toNext > 0)) return [];
  const now = rf.form4952(ctx.text);
  if (now.fromPrior !== null && Math.abs(now.fromPrior - before.toNext) <= 1) return [];
  return [finding("MEDIUM", "Carryover", "Form 4952 line 2 — disallowed investment interest not brought forward",
    `Last year's Form 4952 carried ${fmt(before.toNext)} of disallowed investment interest to this year (line 7); this return's line 2 shows ${now.fromPrior ? fmt(now.fromPrior) : "nothing"}${rf.hasForm(ctx.text, "4952") ? "" : " and there is no Form 4952"}.`,
    "Enter the carryforward on Form 4952 line 2; it is deductible to the extent of this year's net investment income.",
    "IRC §163(d)(2); Form 4952 instructions", "Form 4952 line 7 last year; line 2 this year.")];
}

function checkBusinessInterestCarryover(ctx) {
  if (!ctx.priorText) return [];
  const before = rf.form8990(ctx.priorText);
  if (!(before.toNext > 0)) return [];
  const now = rf.form8990(ctx.text);
  if (now.fromPrior !== null && Math.abs(now.fromPrior - before.toNext) <= 1) return [];
  return [finding("MEDIUM", "Carryover", "Form 8990 line 2 — disallowed business interest not brought forward",
    `Last year's Form 8990 disallowed ${fmt(before.toNext)} of business interest (line 31); this return's line 2 shows ${now.fromPrior ? fmt(now.fromPrior) : "nothing"}.`,
    "Carry the disallowed business interest forward on Form 8990 line 2.", "IRC §163(j)(2); Form 8990 instructions", "Form 8990 line 31 last year; line 2 this year.")];
}

/* ---------------------------------------------------------------------------
 * Anticipos: multa por anticipos insuficientes, cuotas y debitos ya vencidos
 * ------------------------------------------------------------------------- */

const refundableCredits = (L) => num(L["27"]) + num(L["28"]) + num(L["29"]);

function checkEstimatedTaxPenalty(ctx) {
  const L = ctx.lines;
  const P = ctx.priorLines;
  if (!P || !(num(L["37"]) >= 1000) || num(L["38"]) > 0 || rf.hasForm(ctx.text, "2210")) return [];
  const tax = num(L["24"]) - refundableCredits(L);
  const priorTax = num(P["24"]) - refundableCredits(P);
  if (tax <= 0 || priorTax <= 0 || P["24"] === null || L["24"] === null) return [];
  const status = ctx.header && ctx.header.filingStatus;
  const highIncome = num(P["11"]) > (status === "mfs" ? 75000 : 150000);
  const priorSafe = priorTax * (highIncome ? 1.1 : 1);
  const required = Math.min(tax * 0.9, priorSafe);
  const paid = num(L["25d"]) + num(L["26"]);
  if (paid + 1 >= required) return [];
  return [finding("MEDIUM", "Payments", "Form 2210 — estimated tax underpaid with no penalty computed",
    `Withholding and estimates add to ${fmt(paid)}; the safe harbor was the smaller of 90% of this year's tax (${fmt(tax * 0.9)}) and ${highIncome ? "110%" : "100%"} of last year's tax (${fmt(priorSafe)}), so at least ${fmt(required - paid)} was underpaid. Line 38 is blank and there is no Form 2210.`,
    "Compute the underpayment penalty on Form 2210 (the annualized-income method can reduce it when income came late in the year) and enter it on line 38, or document the exception that applies.",
    "IRC §6654; Form 2210 instructions", "Form 1040 lines 24-26, 37-38 this year; lines 11 and 24 of last year's return.")];
}

function checkVouchersPastDue(ctx) {
  const vouchers = rf.estimateVouchers(ctx.text).filter((v) => v.due && v.amount > 0);
  const toDate = (s) => { const [m, d, y] = s.split("/").map(Number); return new Date(Date.UTC(y < 100 ? 2000 + y : y, m - 1, d)); };
  const past = vouchers.filter((v) => toDate(v.due) < ctx.now);
  if (!past.length) return [];
  const total = past.reduce((s, v) => s + v.amount, 0);
  return [finding("MEDIUM", "Payments", "Form 1040-ES — estimate vouchers already past due",
    `${past.length} of the ${vouchers.length} estimate vouchers printed with this return (${fmt(total)}) were due on ${past.map((v) => v.due).join(", ")}, before this review.`,
    "Tell the client to pay the overdue installments now (the underpayment penalty runs from each due date) or confirm they were paid; if the plan changed, reprint the vouchers with the remaining amounts.",
    "IRC §6654; Form 1040-ES instructions", "Form 1040-ES vouchers in the return.")];
}

function checkDebitDatesPast(ctx) {
  const toDate = (s) => { const [m, d, y] = s.split("/").map(Number); return new Date(Date.UTC(y < 100 ? 2000 + y : y, m - 1, d)); };
  const dates = [...new Set(rf.requestedDebitDates(ctx.text))].filter((d) => toDate(d) < ctx.now);
  if (!dates.length) return [];
  return [finding("MEDIUM", "Payments", "Electronic funds withdrawal — requested date already passed",
    `The return schedules an electronic withdrawal for ${dates.join(", ")}, which is before this review.`,
    "Update the requested payment date before filing; a past date can reject the payment or the e-file, and the balance stays unpaid.",
    "Form 8879 / e-file payment instructions", "Electronic funds withdrawal section of the return.")];
}

/**
 * El sobrepago estatal que el año pasado se aplico a este año. Solo California (540/540NR), el
 * unico con los dos renglones verificados en paquetes reales; los demas estados quedan para el
 * modelo.
 */
function checkCaliforniaOverpaymentApplied(ctx) {
  if (!ctx.priorText || !ctx.taxYear) return [];
  const priorLines = rf.linesOf(ctx.priorText);
  const applied = priorLines
    .filter((l) => new RegExp(`Amount of line \\d+ you want applied to your ${ctx.taxYear} estimated tax`, "i").test(l) && !/Amount of line 34 you want applied/i.test(l))
    .map((l) => /@?\s*\d{2,3}\s+([\d,]+)\.?\s*$/.exec(l)).filter(Boolean).map((m) => Number(m[1].replace(/,/g, "")));
  const credit = applied.length ? Math.max(...applied) : 0;
  if (credit < 1) return [];
  const line = rf.linesOf(ctx.text).find((l) => new RegExp(`${ctx.taxYear} California estimated tax and other payments`, "i").test(l));
  if (!line) return [];
  const m = /@?\s*\d{2,3}\s+([\d,]+)\.?\s*$/.exec(line);
  const paid = m ? Number(m[1].replace(/,/g, "")) : 0;
  if (paid + 1 >= credit) return [];
  return [finding("HIGH", "Carryover", "California — last year's overpayment not applied to this year",
    `Last year's California return applied ${fmt(credit)} of its overpayment to ${ctx.taxYear} estimated tax, and this year's "${ctx.taxYear} California estimated tax and other payments" line shows ${paid ? fmt(paid) : "nothing"}.`,
    "Include the applied overpayment with this year's estimated payments on the California return (Form 540 line 72 / 540NR equivalent); confirm with the FTB account.",
    "FTB Form 540 instructions", "Form 540 line 98 last year; line 72 this year.")];
}

function checkRefundAccountChanged(ctx) {
  if (!ctx.priorText) return [];
  const now = rf.refundAccount(ctx.text);
  const before = rf.refundAccount(ctx.priorText);
  if (!now || !before) return [];
  const changed = (a, b) => a && b && a !== b;
  if (!changed(now.routing, before.routing) && !changed(now.account, before.account)) return [];
  return [finding("LOW", "Payments", "Direct deposit — bank account differs from last year",
    `The refund account on this return ends in ${String(now.account || now.routing).slice(-4)}; last year's ended in ${String(before.account || before.routing).slice(-4)}.`,
    "Confirm the new account with the client directly (not by email): a wrong or altered account sends the refund to someone else.",
    "Form 1040 instructions, line 35", "Form 1040 lines 35b-35d, this year and last year.")];
}

/* ---------------------------------------------------------------------------
 * Deducciones y creditos
 * ------------------------------------------------------------------------- */

const STANDARD = {
  2022: { base: { single: 12950, mfs: 12950, mfj: 25900, qss: 25900, hoh: 19400 }, extraMarried: 1400, extraSingle: 1750 },
  2023: { base: { single: 13850, mfs: 13850, mfj: 27700, qss: 27700, hoh: 20800 }, extraMarried: 1500, extraSingle: 1850 },
  2024: { base: { single: 14600, mfs: 14600, mfj: 29200, qss: 29200, hoh: 21900 }, extraMarried: 1550, extraSingle: 1950 },
  2025: { base: { single: 15750, mfs: 15750, mfj: 31500, qss: 31500, hoh: 23625 }, extraMarried: 1600, extraSingle: 2000 },
};

function checkStandardDeduction(ctx) {
  const table = STANDARD[ctx.taxYear];
  const status = ctx.header && ctx.header.filingStatus;
  const b = ctx.boxes;
  if (!table || !status || !b || !b.anyX || b.dependentOfAnother) return [];
  if (rf.scheduleA(ctx.text) || rf.hasForm(ctx.text, "SCH A")) return [];
  const line12 = ctx.lines["12"];
  if (line12 === null || line12 === undefined) return [];
  const extra = (b.over65 + b.blind) * (["mfj", "mfs", "qss"].includes(status) ? table.extraMarried : table.extraSingle);
  const expected = table.base[status] + extra;
  if (Math.abs(line12 - expected) <= 1) return [];
  return [finding("MEDIUM", "Deductions", "Form 1040 line 12 — standard deduction does not match the filing status",
    `Line 12 is ${fmt(line12)}; the ${ctx.taxYear} standard deduction for ${STATUS_LABEL[status]}${extra ? ` with ${b.over65 + b.blind} age/blindness box${b.over65 + b.blind > 1 ? "es" : ""}` : ""} is ${fmt(expected)}.`,
    "Check the filing status and the age/blindness boxes; if the difference is deliberate (dual-status, a dependent's limited deduction), document it.",
    "IRC §63(c); Form 1040 instructions, line 12", "Form 1040 filing status, line 12 and the boxes on line 12.")];
}

function saltCap(year, status, magi) {
  const mfs = status === "mfs";
  if (year >= 2025 && year <= 2029) {
    const base = mfs ? 20000 : 40000;
    const floor = mfs ? 5000 : 10000;
    const over = Math.max(0, magi - (mfs ? 250000 : 500000));
    return Math.max(floor, base - 0.3 * over);
  }
  return mfs ? 5000 : 10000;
}

function checkSaltAndItemized(ctx) {
  const a = rf.scheduleA(ctx.text);
  const status = ctx.header && ctx.header.filingStatus;
  if (!a || !ctx.taxYear) return [];
  const out = [];
  if (a.salt !== null && a.saltAllowed !== null && status) {
    const cap = saltCap(ctx.taxYear, status, num(ctx.lines["11"]));
    const allowed = Math.min(a.salt, cap);
    if (a.saltAllowed > allowed + 1) {
      out.push(finding("HIGH", "Deductions", "Schedule A line 5e — state and local taxes over the cap",
        `Line 5e deducts ${fmt(a.saltAllowed)}; with ${fmt(a.salt)} of taxes on line 5d and modified AGI of ${fmt(ctx.lines["11"])}, the ${ctx.taxYear} limit for ${STATUS_LABEL[status]} is ${fmt(allowed)}.`,
        "Limit line 5e to the cap.", "IRC §164(b)(6)-(7); Schedule A instructions, line 5e", "Schedule A lines 5d-5e; Form 1040 line 11."));
    } else if (a.saltAllowed < allowed - 1) {
      out.push(finding("MEDIUM", "Deductions", "Schedule A line 5e — state and local taxes below the allowed cap",
        `Line 5e deducts ${fmt(a.saltAllowed)}, but with ${fmt(a.salt)} on line 5d the ${ctx.taxYear} limit for ${STATUS_LABEL[status]} at this income is ${fmt(allowed)}.`,
        `Recompute line 5e with the ${ctx.taxYear} cap${ctx.taxYear >= 2025 ? " ($40,000, reduced by 30% of modified AGI over $500,000, never below $10,000; half for married filing separately)" : ""}.`,
        "IRC §164(b)(6)-(7); Schedule A instructions, line 5e", "Schedule A lines 5d-5e; Form 1040 line 11."));
    }
  }
  const table = STANDARD[ctx.taxYear];
  if (table && status && a.total !== null && a.total > 0 && status !== "mfs") {
    const standard = table.base[status];
    if (a.total + 1 < standard && ctx.boxes && !ctx.boxes.dependentOfAnother) {
      out.push(finding("MEDIUM", "Deductions", "Schedule A — itemized deductions below the standard deduction",
        `Itemized deductions total ${fmt(a.total)}, less than the ${fmt(standard)} standard deduction for ${STATUS_LABEL[status]}.`,
        "Take the standard deduction unless there is a reason to itemize (a state that requires matching the federal choice with a larger state benefit); if so, check the election box on Schedule A line 18 and document it.",
        "IRC §63; Schedule A line 18", "Schedule A line 17; Form 1040 line 12."));
    }
  }
  return out;
}

const EIC_INVESTMENT_LIMIT = { 2022: 10300, 2023: 11000, 2024: 11600, 2025: 11950 };

function checkEicInvestmentIncome(ctx) {
  const L = ctx.lines;
  const limit = EIC_INVESTMENT_LIMIT[ctx.taxYear];
  if (!limit || !(num(L["27"]) > 0)) return [];
  const investment = num(L["2a"]) + num(L["2b"]) + num(L["3b"]) + Math.max(0, num(L["7"]));
  if (investment <= limit) return [];
  return [finding("HIGH", "Credits", "Form 1040 line 27 — earned income credit over the investment income limit",
    `The return claims ${fmt(L["27"])} of earned income credit with ${fmt(investment)} of interest, dividends and capital gains; the ${ctx.taxYear} limit is ${fmt(limit)}.`,
    "Remove the credit (investment income above the limit disqualifies it entirely) unless the investment income figure is wrong.",
    "IRC §32(i); Form 1040 instructions, line 27", "Form 1040 lines 2a, 2b, 3b, 7 and 27.")];
}

const KIDDIE_THRESHOLD = { 2022: 2300, 2023: 2500, 2024: 2600, 2025: 2700 };

function checkKiddieTax(ctx) {
  const threshold = KIDDIE_THRESHOLD[ctx.taxYear];
  if (!threshold || !ctx.boxes || !ctx.boxes.dependentOfAnother || rf.hasForm(ctx.text, "8615")) return [];
  const L = ctx.lines;
  const unearned = num(L["2b"]) + num(L["3b"]) + Math.max(0, num(L["7"]));
  if (unearned <= threshold) return [];
  return [finding("MEDIUM", "Tax computation", "Form 8615 — dependent with unearned income and no kiddie tax",
    `The return says the filer can be claimed as someone's dependent and reports ${fmt(unearned)} of interest, dividends and capital gains (over ${fmt(threshold)}), with no Form 8615.`,
    "If the filer is under 18 (or a full-time student under 24 without earned income over half their support), compute the tax on unearned income at the parents' rate on Form 8615.",
    "IRC §1(g); Form 8615 instructions", "Form 1040 dependent box and lines 2b, 3b, 7.")];
}

function checkSelfEmploymentTax(ctx) {
  const s1 = rf.schedule1(ctx.text);
  if (!s1 || !(num(s1.business) >= 400) || rf.hasForm(ctx.text, "SCH SE")) return [];
  return [finding("HIGH", "Tax computation", "Schedule SE — business profit with no self-employment tax",
    `Schedule 1 line 3 reports ${fmt(s1.business)} of business income, and the return has no Schedule SE.`,
    "Compute self-employment tax on Schedule SE (net earnings of $400 or more) and take the deduction for half of it on Schedule 1 line 15.",
    "IRC §1401-1402; Schedule SE instructions", "Schedule 1 line 3; forms in the return.")];
}

function checkQbiDeduction(ctx) {
  const s1 = rf.schedule1(ctx.text);
  if (!s1 || !(num(s1.business) > 0) || !(num(ctx.lines["15"]) > 0)) return [];
  if (num(ctx.lines["13"]) > 0 || rf.hasForm(ctx.text, "8995") || rf.hasForm(ctx.text, "8995-A")) return [];
  return [finding("MEDIUM", "Deductions", "Form 8995 — business income with no qualified business income deduction",
    `Schedule 1 line 3 reports ${fmt(s1.business)} of business income, taxable income is positive, and line 13 has no QBI deduction (no Form 8995 or 8995-A).`,
    "Compute the deduction on Form 8995 (or 8995-A above the threshold, where specified service businesses and the W-2 wage limit apply).",
    "IRC §199A; Form 8995 instructions", "Schedule 1 line 3; Form 1040 lines 13 and 15.")];
}

function checkSeniorDeduction(ctx) {
  if (!(ctx.taxYear >= 2025 && ctx.taxYear <= 2028) || !ctx.boxes || !ctx.boxes.over65) return [];
  const status = ctx.header && ctx.header.filingStatus;
  if (!status || status === "mfs") return [];
  const magi = num(ctx.lines["11"]);
  const joint = status === "mfj";
  const full = joint ? 150000 : 75000;
  const amount = Math.max(0, 6000 * ctx.boxes.over65 - 0.06 * Math.max(0, magi - full));
  if (amount < 100 || num(ctx.lines["13b"]) > 0 || rf.hasForm(ctx.text, "SCH 1-A")) return [];
  return [finding("MEDIUM", "Deductions", "Schedule 1-A — senior deduction not claimed",
    `${ctx.boxes.over65 > 1 ? "Both spouses were" : "The filer was"} 65 or older, modified AGI is ${fmt(magi)}, and line 13b is blank: the deduction for seniors is worth about ${fmt(amount)}.`,
    "Claim the enhanced deduction for seniors on Schedule 1-A Part V ($6,000 per qualifying person, reduced by 6% of modified AGI over $75,000 / $150,000 joint; a valid SSN is required).",
    "IRC §151(d)(5)(C) as added by P.L. 119-21; Schedule 1-A instructions", "Form 1040 line 12 boxes, lines 11 and 13b.")];
}

function checkChildCredits(ctx) {
  const L = ctx.lines;
  const out = [];
  if ((num(L["19"]) > 0 || num(L["28"]) > 0) && !rf.hasForm(ctx.text, "SCH 8812")) {
    out.push(finding("MEDIUM", "Credits", "Schedule 8812 — child tax credit claimed without the schedule",
      `Line 19 (${fmt(L["19"])}) or line 28 (${fmt(L["28"])}) claims the child tax credit or the credit for other dependents, and the return has no Schedule 8812.`,
      "Attach Schedule 8812; the IRS computes and verifies the credit from it.", "IRC §24; Schedule 8812 instructions", "Form 1040 lines 19 and 28; forms in the return."));
  }
  const deps = (ctx.header && ctx.header.dependents) || [];
  const status = ctx.header && ctx.header.filingStatus;
  const phaseOut = status === "mfj" ? 400000 : 200000;
  if (deps.length && L["19"] === null && !(num(L["28"]) > 0) && num(L["16"]) > 500 * deps.length && num(L["11"]) > 0 && num(L["11"]) < phaseOut) {
    out.push(finding("MEDIUM", "Credits", "Form 1040 line 19 — dependents with no child tax credit or credit for other dependents",
      `The return lists ${deps.length} dependent${deps.length > 1 ? "s" : ""}, adjusted gross income is ${fmt(L["11"])} (below the ${fmt(phaseOut)} phase-out) and line 19 is blank.`,
      "Each dependent with a valid SSN gives $2,000-$2,200 (child under 17) or $500 (other dependent). Confirm who qualifies and complete Schedule 8812.",
      "IRC §24; Schedule 8812 instructions", "Dependents section; Form 1040 lines 11, 16 and 19."));
  }
  return out;
}

/** Documentos del año que tienen que tener su formulario (venta de la vivienda, corretaje, hipoteca, canje, codigos del W-2). */
function moreDocumentChecks(ctx) {
  const out = [];
  const docsOf = (type) => pd.has(ctx.docs, type).filter((d) => !d.year || !ctx.taxYear || d.year === ctx.taxYear);
  const names = (docs) => docs.map((d) => d.name).join("; ");
  const capitalForms = rf.hasForm(ctx.text, "SCH D") || rf.hasForm(ctx.text, "8949");
  const s = docsOf("1099-s");
  if (s.length && !capitalForms && !rf.hasForm(ctx.text, "4797")) {
    out.push(finding("HIGH", "Income", "Form 1099-S — real estate sale not reported",
      `The package has ${names(s)} and the return has no Schedule D, Form 8949 or Form 4797.`,
      "Report the sale on Form 8949 / Schedule D (a main home sale excluded under section 121 still goes on Form 8949 when a 1099-S was issued) or on Form 4797 if it was business or rental property.",
      "IRC §§121, 1001; Form 8949 instructions", `1099-S: ${names(s)}.`));
  }
  const b = docsOf("1099-b");
  if (b.length && !capitalForms) {
    out.push(finding("HIGH", "Income", "Form 1099-B — sales with no Schedule D or Form 8949",
      `The package has ${b.length} statement${b.length > 1 ? "s" : ""} with Form 1099-B sales (${names(b)}) and the return has no Schedule D or Form 8949.`,
      "Report every sale on Form 8949 / Schedule D; the IRS matches 1099-B proceeds and assumes zero basis for what is missing.",
      "IRC §1001; Schedule D and Form 8949 instructions", `1099-B: ${names(b)}.`));
  }
  const m = docsOf("1098");
  const a = rf.scheduleA(ctx.text);
  if (m.length && a && !(num(a.mortgage1098) > 0) && !/Mortgage interest paid to banks, etc\.[^\n]*\d/i.test(ctx.text)) {
    out.push(finding("MEDIUM", "Deductions", "Form 1098 — mortgage interest not deducted",
      `The return itemizes, the package has ${names(m)}, and Schedule A line 8a is blank (nor does Schedule E carry mortgage interest).`,
      "Deduct the qualified residence interest on Schedule A line 8a (or on Schedule E/C if the property is rented or used in a business), within the acquisition-debt limit.",
      "IRC §163(h); Schedule A instructions, line 8", `1098: ${names(m)}.`));
  }
  const exchange = pd.has(ctx.docs, "settlement").filter((d) => /\b1031\b|qualified intermediary|exchange accommodat/i.test(d.text) && (!d.year || !ctx.taxYear || d.year === ctx.taxYear));
  if (exchange.length && !rf.hasForm(ctx.text, "8824")) {
    out.push(finding("HIGH", "Income", "Form 8824 — like-kind exchange with no Form 8824",
      `The package has settlement documents for a section 1031 exchange (${names(exchange)}) and the return has no Form 8824.`,
      "Report the exchange on Form 8824 (relinquished and replacement property, deferred gain, boot and basis of the new property).",
      "IRC §1031; Form 8824 instructions", `Settlement documents: ${names(exchange)}.`));
  }
  const codes = new Set();
  for (const w2 of pd.has(ctx.docs, "w2")) {
    for (const mm of String(w2.text).matchAll(/\b12[a-d]\.?\s+(?:Code\s+)?([A-Z]{1,2})\s+\$?\s*[\d,]+\.\d{2}\b/g)) codes.add(mm[1]);
  }
  if (codes.has("W") && !rf.hasForm(ctx.text, "8889")) {
    out.push(finding("MEDIUM", "Deductions", "Form 8889 — W-2 code W (employer HSA contributions) with no Form 8889",
      "A W-2 in the package reports employer contributions to a health savings account (box 12, code W), and the return has no Form 8889.",
      "File Form 8889: employer contributions count toward the annual limit, and any excess is taxable.", "IRC §223; Form 8889 instructions", "W-2 box 12; forms in the return."));
  }
  if (codes.has("T") && !rf.hasForm(ctx.text, "8839")) {
    out.push(finding("MEDIUM", "Income", "Form 8839 — W-2 code T (adoption benefits) with no Form 8839",
      "A W-2 in the package reports employer-provided adoption benefits (box 12, code T), and the return has no Form 8839.",
      "File Form 8839 to compute the excludable part; the rest is wages on line 1f.", "IRC §137; Form 8839 instructions", "W-2 box 12; forms in the return."));
  }
  const L = ctx.lines;
  if ((num(L["2b"]) > 1500 || num(L["3b"]) > 1500) && !rf.hasForm(ctx.text, "SCH B")) {
    out.push(finding("MEDIUM", "Income", "Schedule B — required and not attached",
      `Taxable interest (${fmt(L["2b"])}) or ordinary dividends (${fmt(L["3b"])}) exceed $1,500, and the return has no Schedule B.`,
      "Attach Schedule B listing each payer and answer the foreign account and foreign trust questions in Part III.",
      "Schedule B instructions", "Form 1040 lines 2b and 3b; forms in the return."));
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Importes de los documentos contra los renglones (solo hacia un lado)
 *
 * Cada emisor arma su 1099 a su manera, asi que solo se toma el importe que va pegado a su
 * casilla ("1a Total Ordinary Dividends . . . 60.16", "1. INTEREST INCOME $1,363.88") y, si un
 * documento lo repite (resumen y detalle), el mayor, no la suma. Con eso la suma de los
 * documentos es un piso: si la declaracion reporta menos que el piso, falta algo. Si reporta
 * mas no se dice nada — puede haber documentos que no se leyeron o K-1 que suman.
 * ------------------------------------------------------------------------- */

const BOX_AMOUNT = {
  interest: /(?:^|\s)1\.?\s*[-–]?\s*Interest income[\s.]*\$?\s*([\d,]+\.\d{2})/gi,
  dividends: /\b1a\.?\s*[-–]?\s*Total ordinary dividends[\s.]*\$?\s*([\d,]+\.\d{2})/gi,
  retirement: /(?:^|\s)1\.?\s*Gross distribution[\s.]*\$?\s*([\d,]+\.\d{2})/gi,
  socialSecurity: /Box 5\.?\s*Net Benefits for \d{4}[^$\d]{0,60}\$?\s*([\d,]+\.\d{2})/gi,
  nonemployee: /(?:^|\s)1\.?\s*Nonemployee compensation[\s.]*\$?\s*([\d,]+\.\d{2})/gi,
};

function docFloor(docs, kind) {
  const seen = new Set();
  let total = 0;
  const used = [];
  for (const d of docs) {
    const re = BOX_AMOUNT[kind];
    re.lastIndex = 0;
    const values = [...String(d.text || "").matchAll(re)].map((m) => Number(m[1].replace(/,/g, "")));
    if (!values.length) continue;
    const top = Math.max(...values);
    const key = `${top}`;
    if (!top || seen.has(key)) continue; // el mismo resumen bajado dos veces
    seen.add(key);
    total += top;
    used.push(d.name);
  }
  return { total, used };
}

function documentAmountChecks(ctx) {
  const L = ctx.lines;
  const out = [];
  const docsOf = (...types) => ctx.docs.filter((d) => d.text && types.some((t) => d.types.includes(t)) && (!d.year || !ctx.taxYear || d.year === ctx.taxYear));
  const short = (floor, reported) => floor.total > 0 && reported + Math.max(100, floor.total * 0.05) < floor.total;
  const pairs = [
    ["interest", docsOf("1099-int"), num(L["2b"]), "line 2b (taxable interest)", "1099-INT box 1", "Form 1040 line 2b — interest on the 1099s exceeds the return", "IRC §61(a)(4); Schedule B instructions"],
    ["dividends", docsOf("1099-div"), num(L["3b"]), "line 3b (ordinary dividends)", "1099-DIV box 1a", "Form 1040 line 3b — dividends on the 1099s exceed the return", "IRC §61(a)(7); Schedule B instructions"],
    ["retirement", docsOf("1099-r"), num(L["4a"]) + num(L["5a"]), "lines 4a and 5a (gross distributions)", "1099-R box 1", "Form 1040 lines 4a-5a — distributions on the 1099-Rs exceed the return", "IRC §§72, 402, 408; Form 1040 instructions, lines 4-5"],
    ["socialSecurity", docsOf("ssa-1099"), num(L["6a"]), "line 6a (social security benefits)", "SSA-1099 box 5", "Form 1040 line 6a — benefits on the SSA-1099 exceed the return", "IRC §86; Form 1040 instructions, line 6"],
  ];
  for (const [kind, docs, reported, where, box, title, authority] of pairs) {
    if (!docs.length) continue;
    const floor = docFloor(docs, kind);
    if (!short(floor, reported)) continue;
    out.push(finding("MEDIUM", "Income", title,
      `The ${box} amounts in the package add to at least ${fmt(floor.total)} (${floor.used.join("; ")}), and ${where} reports ${fmt(reported)}.`,
      "Find the statement that was not entered, or document the adjustment that explains the difference (nominee amounts, accrued interest, bond premium, a rollover) on the form where it belongs. The IRS matches each payer's figure.",
      authority, `${box}: ${floor.used.join("; ")}.`));
  }
  const nec = docsOf("1099-nec");
  if (nec.length) {
    const lines = rf.linesOf(ctx.text);
    const receipts = rf.lineAmount(lines, /Gross receipts or sales\.\s*See instructions for line 1/i, "1");
    const floor = docFloor(nec, "nonemployee");
    if (receipts !== null && short(floor, receipts)) {
      out.push(finding("MEDIUM", "Income", "Schedule C line 1 — 1099-NEC income exceeds gross receipts",
        `The 1099-NECs in the package add to at least ${fmt(floor.total)} (${floor.used.join("; ")}), and Schedule C line 1 reports ${fmt(receipts)} of gross receipts.`,
        "Include every 1099-NEC in gross receipts (and any other business income on top); if one belongs to another activity, report it there.",
        "IRC §61; Schedule C instructions, line 1", `1099-NEC: ${floor.used.join("; ")}.`));
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Todo junto
 * ------------------------------------------------------------------------- */

const CHECKS = [
  documentAmountChecks,
  checkSpouseSsn, checkDependents, checkFilingStatusChange,
  checkOverpaymentApplied, checkCapitalLossCarryover, checkSection179Carryover, checkInstallmentSaleContinues,
  checkNolCarryover, checkQbiLossCarryover, checkInvestmentInterestCarryover, checkBusinessInterestCarryover,
  checkEstimatesPlannedNotPaid, checkExtensionPayment, checkEstimatedTaxPenalty, checkVouchersPastDue, checkDebitDatesPast, checkRefundAccountChanged, checkCaliforniaOverpaymentApplied,
  checkW2AgainstReturn, presenceChecks, moreDocumentChecks, checkArithmetic1040, checkThresholdForms,
  checkStandardDeduction, checkSaltAndItemized, checkEicInvestmentIncome, checkKiddieTax, checkSelfEmploymentTax, checkQbiDeduction, checkSeniorDeduction, checkChildCredits,
  checkStateMove, checkResidencyAgainstDocuments, checkScheduleE1099Questions, checkDigitalAssetsQuestion,
];

function runIndividualChecks(files, meta = {}) {
  let ctx = null;
  try { ctx = context(files, meta); } catch (error) { console.warn(`[individual] ${error.message}`); }
  if (!ctx) return [];
  const out = [];
  for (const check of CHECKS) {
    try { out.push(...check(ctx)); } catch (error) { console.warn(`[individual] ${check.name}: ${error.message}`); }
  }
  return out;
}

module.exports = {
  runIndividualChecks, context,
  checkSpouseSsn, checkDependents, checkFilingStatusChange, checkOverpaymentApplied,
  checkCapitalLossCarryover, checkSection179Carryover, checkInstallmentSaleContinues,
  checkEstimatesPlannedNotPaid, checkExtensionPayment, checkW2AgainstReturn, w2Amounts,
  presenceChecks, checkArithmetic1040, checkThresholdForms, documentStates,
  checkResidencyAgainstDocuments, checkScheduleE1099Questions, checkDigitalAssetsQuestion,
  checkNolCarryover, checkQbiLossCarryover, checkInvestmentInterestCarryover, checkBusinessInterestCarryover,
  checkEstimatedTaxPenalty, checkVouchersPastDue, checkDebitDatesPast, checkRefundAccountChanged, checkCaliforniaOverpaymentApplied,
  checkStandardDeduction, checkSaltAndItemized, saltCap, checkEicInvestmentIncome, checkKiddieTax,
  checkSelfEmploymentTax, checkQbiDeduction, checkSeniorDeduction, checkChildCredits, moreDocumentChecks, documentAmountChecks, checkStateMove,
  digitDistance,
};
