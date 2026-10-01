"use strict";

/**
 * planning-strategies.js — que estrategias aplican a un cliente y con que montos.
 *
 * Antes el modelo elegia libremente 3 a 5 estrategias e inventaba los montos (cuanto equipo
 * comprar, cuanto poner en un plan de retiro), con azar en cada corrida: el mismo cliente daba
 * escenarios distintos cada vez, y "Best" era el numero mas grande aunque fuera una compra de
 * equipos que el cliente no necesitaba. En una prueba real propuso un Solo 401(k) a una empresa
 * con empleados y conto de nuevo un seguro medico que la S-corp ya deducia.
 *
 * Ahora las reglas viven aca: cada estrategia mira los datos del perfil, decide si aplica y
 * calcula sus ajustes con los limites legales del año (lib/tax-calculations.js). Los mismos datos
 * dan siempre las mismas estrategias y los mismos numeros. El modelo solo redacta los textos.
 *
 * Tres tipos de resultado:
 *  - escenarios de ahorro ("savings"): van a la tabla y compiten por "Best";
 *  - escenarios de riesgo ("risk"): muestran lo que cuesta corregir un riesgo, nunca son "Best";
 *  - avisos sin numero ("items"): cumplimiento y temas para conversar.
 * Un escenario que exige gastar plata (equipos) se marca y tampoco compite por "Best": su ahorro
 * depende de una compra, no de una decision de planificacion.
 *
 * Las descripciones van en ingles porque las lee el cliente final.
 */

const tax = require("./tax-calculations");

/** Debajo de esta proporcion de sueldo sobre la ganancia, el sueldo del dueño es un riesgo. */
const REASONABLE_COMP_FLAG = 0.25;
/**
 * Sueldo de referencia para mostrar lo que cuesta corregirlo: 35% de la ganancia antes del
 * sueldo de los dueños. No es una regla del IRS (no hay ninguna): es un punto de partida que el
 * contador reemplaza por un sueldo de mercado para el puesto.
 */
const REASONABLE_COMP_TARGET = 0.35;
/** Ganancia minima para que pasar a S-corp compense nomina y una declaracion mas. */
const SCORP_ELECTION_MIN_PROFIT = 60000;
/** Costo anual supuesto de una S-corp: nomina y la declaracion 1120-S. */
const SCORP_ANNUAL_COST = 2000;
/** Aporte safe harbor no electivo de un 401(k). */
const SAFE_HARBOR_PCT = 0.03;
/** Lo que el empleado necesita de su sueldo para que le retengan el FICA. */
const FICA_EMPLOYEE_SHARE = 0.0765;

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const whole = (n) => Math.round(Number(n) || 0);
const nonNeg = (n) => { const v = Number(n) || 0; return v > 0 ? v : 0; };

/** Los datos del perfil que usan las reglas, ya como numeros. */
function facts(profile) {
  const pf = tax.applyAdjustments(profile, []);
  const status = tax.normalizeStatus(profile.filingStatus);
  const ownerWages = pf.ownerWages;
  const ownerCount = ownerWages > 0 ? Math.min(2, Math.max(1, Math.round(Number(profile.ownerCount) || 1))) : 0;
  return {
    pf,
    status,
    isScorp: pf.sCorpIncome > 0,
    hasSE: pf.netSEIncome > 0,
    ownerWages,
    ownerCount,
    employeeWages: nonNeg(profile.employeeWages),
    hasRetirementPlan: profile.hasRetirementPlan === true || profile.hasRetirementPlan === "true",
    age50: Math.min(2, Math.max(0, Math.round(Number(profile.ownersAge50Plus) || 0))),
    age55: Math.min(2, Math.max(0, Math.round(Number(profile.ownersAge55Plus) || 0))),
    premiumsByBusiness: nonNeg(profile.healthPremiumsPaidByBusiness),
    premiumsPersonal: nonNeg(profile.healthPremiumsPaidPersonally),
    hsaEligible: String(profile.hsaEligible || "unknown").toLowerCase(),
    aptcRepayment: nonNeg(profile.excessAptcRepayment),
    plannedPurchases: nonNeg(profile.plannedAssetPurchases),
    purchaseNotes: (Array.isArray(profile.assetPurchaseNotes) ? profile.assetPurchaseNotes : [])
      .map((s) => String(s || "").trim()).filter(Boolean).slice(0, 4),
    dependents: Number(profile.dependents) || 0,
  };
}

// ---------------------------------------------------------------------------
// Estrategias. Cada una devuelve null si no aplica, o una definicion con ajustes en valores
// absolutos (newValue), para que la edicion manual del contador los muestre tal cual.
// ---------------------------------------------------------------------------

function retirementPlan(profile, year, f, ctx) {
  if (f.hasRetirementPlan) return null;
  if (!(f.isScorp && f.ownerWages > 0) && !f.hasSE) return null;
  const limits = ctx.limits.retirement;
  const hasEmployees = f.employeeWages > 0;
  const pf = f.pf;

  // Las personas que participan: los dueños en la nomina de la S-corp, o el titular del negocio.
  const participants = f.isScorp ? f.ownerCount : 1;
  const comp = f.isScorp
    ? f.ownerWages / participants
    // Ganancia neta del autonomo para el plan: SE income menos la mitad del SE tax.
    : Math.max(0, pf.netSEIncome - tax.calcSETax(pf.netSEIncome, year).deduction);

  let deferrals = 0;
  let ownerEmployer = 0;
  for (let i = 0; i < participants; i += 1) {
    const catchUp = i < f.age50 ? limits.catchUp50 : 0;
    // Un dueño de S-corp necesita que le quede sueldo para la retencion de FICA.
    const deferral = Math.min(limits.employee401k + catchUp, f.isScorp ? comp * (1 - FICA_EMPLOYEE_SHARE) : comp);
    const employer = hasEmployees
      ? comp * SAFE_HARBOR_PCT
      : Math.min(f.isScorp ? comp * 0.25 : comp * 0.20, Math.max(0, limits.defined401kTotal - Math.min(deferral, limits.employee401k)));
    deferrals += whole(deferral);
    ownerEmployer += whole(employer);
  }
  const employeeCost = hasEmployees ? whole(f.employeeWages * SAFE_HARBOR_PCT) : 0;
  if (deferrals + ownerEmployer <= 0) return null;

  const adjustments = [
    { field: "retirementContribution", newValue: whole(pf.retirementContribution + deferrals + (f.isScorp ? 0 : ownerEmployer)), rationale: `Owner pre-tax deferrals${f.isScorp ? "" : " and employer contribution"} (${year} limits).` },
  ];
  if (f.isScorp) {
    adjustments.push({ field: "sCorpIncome", newValue: whole(pf.sCorpIncome - ownerEmployer - employeeCost), rationale: "The S corporation deducts the employer contributions." });
  } else if (employeeCost > 0) {
    adjustments.push({ field: "netSEIncome", newValue: whole(pf.netSEIncome - employeeCost), rationale: "The business deducts the safe-harbor contributions for employees." });
  }

  // Con un plan en el trabajo, la IRA tradicional deja de ser deducible a partir de cierto ingreso.
  let iraNote = "";
  if (pf.iraDeduction > 0) {
    const magi = ctx.baseCalc.agi + pf.iraDeduction - deferrals - ownerEmployer - employeeCost;
    const both = f.status === "MFJ" && participants >= 2;
    const allowed = f.status === "MFJ" && !both
      ? tax.iraDeductionAllowed(pf.iraDeduction / 2, magi, f.status, year) + tax.iraDeductionAllowed(pf.iraDeduction / 2, magi, f.status, year, { spouseOnly: true })
      : tax.iraDeductionAllowed(pf.iraDeduction, magi, f.status, year);
    if (allowed < pf.iraDeduction) {
      adjustments.push({ field: "iraDeduction", newValue: whole(allowed), rationale: "Plan participants are active participants: the traditional IRA deduction phases out at this income." });
      iraNote = ` The ${money(pf.iraDeduction)} traditional IRA deduction drops to ${money(allowed)} once the owners are covered by a workplace plan (they can still make nondeductible or backdoor Roth contributions).`;
    }
  }

  const who = f.isScorp ? `${participants} owner${participants > 1 ? "s" : ""} on payroll (salary ${money(f.ownerWages)})` : "the owner";
  const catchUpNote = f.age50 > 0 ? ` Includes the age-50 catch-up for ${Math.min(f.age50, participants)} owner(s); owners aged 60–63 can add ${money(limits.catchUp60to63 - limits.catchUp50)} more.` : "";
  if (hasEmployees) {
    return {
      id: "retirement-401k",
      name: "Safe harbor 401(k) for the business",
      category: "Retirement Planning",
      kind: "savings",
      combinable: true,
      complexity: "Complex",
      deadline: `Dec 31, ${year}`,
      extraCost: employeeCost,
      requiresSpending: 0,
      adjustments,
      description: "Set up a 401(k) for the business so the owners can defer part of their salary before tax. As a safe-harbor plan the business also contributes 3% of pay for every eligible employee — a real cost to weigh against the tax savings.",
      cpaNote: `Deferrals ${money(deferrals)} for ${who}; 3% safe-harbor nonelective ${money(ownerEmployer)} to the owners and up to ${money(employeeCost)} to employees (3% of ${money(f.employeeWages)} non-owner wages — excludable employees lower it). A Solo 401(k) is not available because the business has employees.${catchUpNote}${iraNote} Profit sharing beyond 3% or a cash balance plan needs nondiscrimination testing.`,
      assumptions: [
        `Employee cost assumes every non-owner wage dollar belongs to an eligible employee (upper bound).`,
        `Deferrals limited to ${money(limits.employee401k)} per owner plus catch-up, and to salary net of FICA.`,
      ],
    };
  }
  return {
    id: "retirement-401k",
    name: "Solo 401(k) for the owners",
    category: "Retirement Planning",
    kind: "savings",
    combinable: true,
    complexity: "Moderate",
    deadline: `Dec 31, ${year}`,
    extraCost: 0,
    requiresSpending: 0,
    adjustments,
    description: f.isScorp
      ? "Set up a Solo 401(k) so each owner can defer salary and the S corporation can add up to 25% of salary. The money stays yours, invested for retirement, and comes off this year's taxable income."
      : "Set up a Solo 401(k) so you can defer part of your business income and add an employer contribution. The money stays yours, invested for retirement, and comes off this year's taxable income.",
    cpaNote: `Deferrals ${money(deferrals)} and employer contribution ${money(ownerEmployer)} for ${who}.${catchUpNote}${iraNote} Available only while the business has no employees other than the owners and their spouses.`,
    assumptions: [`${year} limits: ${money(limits.employee401k)} deferral, ${money(limits.defined401kTotal)} total per person.`],
  };
}

function hsa(profile, year, f, ctx) {
  if (f.hsaEligible === "no" || f.hsaEligible === "false") return null;
  const limits = ctx.limits.hsa;
  const family = f.status === "MFJ" || f.dependents > 0;
  const holders = f.status === "MFJ" ? 2 : 1;
  const limit = (family ? limits.family : limits.self) + limits.catchUp55 * Math.min(f.age55, holders);
  if (f.pf.hsaContribution >= limit) return null;
  return {
    id: "hsa",
    name: family ? "Fund a family HSA" : "Fund an HSA",
    category: "Business Deductions",
    kind: "savings",
    combinable: true,
    complexity: "Simple",
    deadline: `Apr 15, ${year + 1}`,
    extraCost: 0,
    requiresSpending: 0,
    adjustments: [{ field: "hsaContribution", newValue: whole(limit), rationale: `${year} ${family ? "family" : "self-only"} HSA limit${f.age55 > 0 ? " with the age-55 catch-up" : ""}.` }],
    description: "If your health plan is an HSA-eligible high-deductible plan, contribute the maximum to a Health Savings Account. Contributions are deductible, grow tax-free, and pay medical costs tax-free.",
    cpaNote: `Contribution to ${money(limit)} (${family ? "family" : "self-only"} limit${limits.estimated ? ", estimated" : ""}). Requires HSA-eligible HDHP coverage and no other disqualifying coverage; confirm the plan before recommending.`,
    assumptions: ["Requires HSA-eligible high-deductible health plan (HDHP) coverage."],
  };
}

function healthInsurance(profile, year, f) {
  if (f.pf.selfEmployedHealthInsurance > 0) return null;
  if (!(f.isScorp && f.ownerWages > 0) && !f.hasSE) return null;
  // Si el negocio ya paga un seguro medico, ese es el aviso de cumplimiento: sumar las primas
  // pagadas en persona podria contar dos veces las mismas.
  if (f.premiumsPersonal <= 0 || f.premiumsByBusiness > 0) return null;
  const pf = f.pf;
  const limit = f.isScorp ? f.ownerWages : pf.netSEIncome;
  const amount = whole(Math.min(f.premiumsPersonal, limit));
  if (amount <= 0) return null;
  const adjustments = f.isScorp
    ? [
        { field: "wages", newValue: whole(pf.wages + amount), rationale: "Premiums the S corporation pays for >2% shareholders go in W-2 Box 1 (not FICA wages)." },
        { field: "sCorpIncome", newValue: whole(pf.sCorpIncome - amount), rationale: "The S corporation deducts the premiums it pays." },
        { field: "selfEmployedHealthInsurance", newValue: amount, rationale: "Self-employed health insurance deduction (Schedule 1, line 17)." },
      ]
    : [{ field: "selfEmployedHealthInsurance", newValue: amount, rationale: "Self-employed health insurance deduction (Schedule 1, line 17)." }];
  return {
    id: "health-insurance",
    name: "Deduct health insurance through the business",
    category: "Business Deductions",
    kind: "savings",
    combinable: true,
    complexity: "Simple",
    deadline: `Dec 31, ${year}`,
    extraCost: 0,
    requiresSpending: 0,
    adjustments,
    description: f.isScorp
      ? "Have the S corporation pay or reimburse your health insurance premiums and report them on your W-2. That turns the premiums into a deduction on your personal return."
      : "Deduct the health insurance premiums you pay as a self-employed person on your personal return.",
    cpaNote: `Premiums paid personally: ${money(f.premiumsPersonal)}; deductible ${money(amount)} (limited to ${f.isScorp ? "the owners' S-corp wages" : "net SE income"}).${f.isScorp ? " Notice 2008-1: the S corporation must pay or reimburse the premiums and include them in Box 1." : ""} Premiums paid by a premium tax credit do not qualify.`,
    assumptions: ["Premiums are for the owners' own coverage and not paid by a premium tax credit."],
  };
}

function reasonableCompensation(profile, year, f) {
  if (!f.isScorp || f.ownerWages <= 0) return null;
  const profit = f.ownerWages + f.pf.sCorpIncome;
  if (profit <= 50000 || f.ownerWages / profit >= REASONABLE_COMP_FLAG) return null;
  const target = Math.round((profit * REASONABLE_COMP_TARGET) / 1000) * 1000;
  if (target <= f.ownerWages) return null;
  const pct = Math.round((f.ownerWages / profit) * 100);
  return {
    id: "reasonable-comp",
    name: `Raise owner salary to ${money(target)} (reasonable compensation)`,
    category: "Entity Structure",
    kind: "risk",
    combinable: false,
    complexity: "Moderate",
    deadline: `Dec 31, ${year}`,
    extraCost: 0,
    requiresSpending: 0,
    adjustments: [{ field: "ownerWages", newValue: target, rationale: `Illustrative: ${Math.round(REASONABLE_COMP_TARGET * 100)}% of the business's profit before owner salary. Replace with a market salary for the owners' roles.` }],
    description: "Your salary is low compared with the profit of the business, which the IRS can challenge. Raising it costs more payroll tax — the cost is shown here — and lowers that risk.",
    cpaNote: `Owner salary ${money(f.ownerWages)} is ${pct}% of ${money(profit)} of profit before owner salary. The ${money(target)} figure is illustrative (${Math.round(REASONABLE_COMP_TARGET * 100)}%), not an IRS rule: benchmark the owners' duties against market pay. The cost includes both halves of FICA on the raise and the lower QBI deduction.`,
    assumptions: [`Salary target ${Math.round(REASONABLE_COMP_TARGET * 100)}% of profit before owner salary (illustrative).`],
  };
}

function plannedEquipment(profile, year, f, ctx) {
  if (f.plannedPurchases <= 0 || (!f.isScorp && !f.hasSE)) return null;
  const pct = ctx.limits.bonusPct;
  return {
    id: "equipment",
    name: `Place planned equipment (${money(f.plannedPurchases)}) in service by Dec 31`,
    category: "Business Deductions",
    kind: "savings",
    combinable: false,
    complexity: "Moderate",
    deadline: `Dec 31, ${year}`,
    extraCost: 0,
    requiresSpending: whole(f.plannedPurchases),
    adjustments: [{ field: "bonusDepreciation", newValue: whole(f.plannedPurchases * pct), rationale: `${Math.round(pct * 100)}% bonus depreciation on planned purchases placed in service in ${year}.` }],
    description: "You plan to buy equipment for the business. Placing it in service before year-end lets you deduct its full cost this year.",
    cpaNote: `Planned purchases of ${money(f.plannedPurchases)} from the documents or instructions. ${Math.round(pct * 100)}% bonus depreciation (property acquired after Jan 19, 2025); §179 is an alternative. The saving is mostly timing — the same cost would be depreciated later. Check state conformity.`,
    assumptions: ["Only planned purchases count: the saving depends on the spending, so this is never marked Best."],
  };
}

function scorpElection(profile, year, f) {
  if (f.isScorp || !f.hasSE || f.pf.netSEIncome < SCORP_ELECTION_MIN_PROFIT) return null;
  const pf = f.pf;
  const salary = Math.round((pf.netSEIncome * REASONABLE_COMP_TARGET) / 1000) * 1000;
  const employer = tax.calcOwnerPayrollTax(salary, 1, year).employer;
  return {
    id: "scorp-election",
    name: "Elect S corporation status",
    category: "Entity Structure",
    kind: "savings",
    combinable: false,
    complexity: "Complex",
    deadline: `Form 2553 by Mar 15, ${year}`,
    extraCost: SCORP_ANNUAL_COST,
    requiresSpending: 0,
    adjustments: [
      { field: "netSEIncome", newValue: 0, rationale: "Business income moves into the S corporation." },
      { field: "ownerWages", newValue: salary, rationale: `Reasonable salary, illustrative ${Math.round(REASONABLE_COMP_TARGET * 100)}% of profit.` },
      { field: "wages", newValue: whole(pf.wages + salary), rationale: "The owner's salary is W-2 wages." },
      { field: "sCorpIncome", newValue: whole(pf.netSEIncome - salary - employer), rationale: "Profit after salary and the employer half of FICA flows through the K-1." },
      { field: "w2Wages", newValue: whole(pf.w2Wages + salary), rationale: "The salary counts as W-2 wages for the QBI wage limit." },
    ],
    description: "Electing S corporation status lets you pay yourself a reasonable salary and take the rest of the profit as distributions, which are not subject to self-employment tax.",
    cpaNote: `Salary ${money(salary)} (illustrative ${Math.round(REASONABLE_COMP_TARGET * 100)}% of ${money(pf.netSEIncome)}); FICA on the salary replaces SE tax on the whole profit. Net of an assumed ${money(SCORP_ANNUAL_COST)}/yr for payroll and the 1120-S. State franchise/minimum taxes vary.`,
    assumptions: [`Annual cost of ${money(SCORP_ANNUAL_COST)} for payroll and an extra return.`, "Salary must be reasonable for the owner's role."],
  };
}

/** Avisos sin numero: cumplimiento y temas para conversar. */
function planItems(profile, year, f) {
  const items = [];
  if (f.isScorp && f.premiumsByBusiness > 0 && f.pf.selfEmployedHealthInsurance <= 0) {
    items.push({
      id: "health-insurance-w2",
      kind: "compliance",
      title: "Report owner health insurance on the W-2",
      category: "Business Deductions",
      complexity: "Simple",
      deadline: `W-2s for ${year}`,
      requiresAction: true,
      description: `The business pays ${money(f.premiumsByBusiness)} of health insurance, but it is not on the owners' W-2s and no self-employed health insurance deduction is claimed. If it covers the owners, it belongs in W-2 Box 1 and is then deducted on the personal return.`,
      cpaNote: "For >2% shareholders (Notice 2008-1): add the premiums to Box 1 (not FICA wages under §3121(a)(2)(B)), then claim Schedule 1 line 17. Roughly tax-neutral — a reporting fix, not a new deduction. Does not apply to premiums for non-owner employees.",
    });
  }
  if (f.aptcRepayment > 0) {
    items.push({
      id: "premium-tax-credit",
      kind: "compliance",
      title: "Stop the advance premium tax credit",
      category: "Credits & Incentives",
      complexity: "Simple",
      deadline: "As soon as possible",
      requiresAction: true,
      description: `You repaid ${money(f.aptcRepayment)} of advance premium tax credit with your last return. At your income no credit applies, so update the Marketplace application or decline the advance credit to avoid repaying it again.`,
      cpaNote: "Form 8962 reconciliation: at this household income the premium tax credit is zero, so every advance payment is repaid. Coordinate with any self-employed health insurance deduction.",
    });
  }
  if (f.hasRetirementPlan && ((f.isScorp && f.ownerWages > 0) || f.hasSE)) {
    items.push({
      id: "retirement-existing",
      kind: "discussion",
      title: "Make sure the owners max out the existing retirement plan",
      category: "Retirement Planning",
      complexity: "Simple",
      deadline: `Dec 31, ${year}`,
      requiresAction: false,
      description: "The business already has a retirement plan. Confirm the owners are contributing the maximum the plan allows.",
      cpaNote: "Check current deferrals and employer contributions against the plan document and the annual limits.",
    });
  }
  if (f.plannedPurchases <= 0 && f.purchaseNotes.length && (f.isScorp || f.hasSE)) {
    items.push({
      id: "capital-spending",
      kind: "discussion",
      title: "Plan the timing of upcoming capital spending",
      category: "Business Deductions",
      complexity: "Moderate",
      deadline: `Dec 31, ${year}`,
      requiresAction: false,
      description: "The documents point to upcoming capital spending. Equipment and improvements placed in service before year-end can be deducted in full this year; the amount is needed to model it.",
      cpaNote: `Signals: ${f.purchaseNotes.join("; ")}. Enter the planned amount to model it (100% bonus depreciation; qualified improvement property is 15-year, bonus-eligible).`,
    });
  }
  return items;
}

const STRATEGIES = [retirementPlan, healthInsurance, hsa, reasonableCompensation, plannedEquipment, scorpElection];

/**
 * El "Combined plan" junta las estrategias de ahorro que se pueden sumar sin gastar plata y que
 * solas dejan un beneficio neto positivo: sumar una que cuesta mas de lo que ahorra solo
 * esconderia el costo. Los ajustes se suman como diferencias contra la base y vuelven a valores
 * absolutos.
 */
function combinedPlan(defs, profile, year, baseTotal) {
  const parts = defs.filter((d) => d.kind === "savings" && d.combinable && !d.requiresSpending
    && baseTotal - tax.computeScenarioTax(profile, d.adjustments, year).total - (d.extraCost || 0) > 0);
  if (parts.length < 2) return null;
  const pf = tax.applyAdjustments(profile, []);
  const deltas = new Map();
  for (const def of parts) {
    for (const adj of def.adjustments) {
      deltas.set(adj.field, (deltas.get(adj.field) || 0) + (Number(adj.newValue) - pf[adj.field]));
    }
  }
  return {
    id: "combined",
    name: "Combined plan",
    category: "Combined",
    kind: "savings",
    combinable: false,
    complexity: parts.some((p) => p.complexity === "Complex") ? "Complex" : "Moderate",
    deadline: parts.some((p) => p.deadline === `Dec 31, ${year}`) ? `Dec 31, ${year}` : parts[0].deadline,
    extraCost: parts.reduce((sum, p) => sum + (p.extraCost || 0), 0),
    requiresSpending: 0,
    adjustments: [...deltas.entries()].map(([field, delta]) => ({ field, newValue: whole(pf[field] + delta), rationale: "Sum of the combined strategies." })),
    description: `${parts.map((p) => p.name).join(" + ")}, applied together.`,
    cpaNote: `Combines: ${parts.map((p) => p.name).join("; ")}. Conditions of each strategy still apply.`,
    assumptions: parts.flatMap((p) => p.assumptions || []),
    parts: parts.map((p) => p.id),
  };
}

/**
 * Las definiciones de escenarios y los avisos para un perfil. Puro: los mismos datos dan el
 * mismo resultado.
 */
function planStrategies(profile, year) {
  const f = facts(profile);
  const ctx = { limits: tax.limitsFor(year), baseCalc: tax.computeScenarioTax(profile, [], year) };
  const defs = STRATEGIES.map((fn) => fn(profile, year, f, ctx)).filter(Boolean);
  const combined = combinedPlan(defs, profile, year, ctx.baseCalc.total);
  if (combined) defs.push(combined);
  // La marca que distingue un escenario de las reglas de uno escrito por el modelo.
  defs.forEach((def) => { def.rule = true; });
  return { defs, items: planItems(profile, year, f) };
}

/** Beneficio neto: el ahorro de impuestos menos lo que cuesta en plata (aportes a empleados). */
function netBenefit(scenario) {
  return Math.round(((scenario?.savingsVsBase?.dollars || 0) - (scenario?.extraCost || 0)) * 100) / 100;
}

/**
 * "Best": el escenario de ahorro con mayor beneficio neto que no dependa de gastar plata.
 * Los de riesgo, los que exigen una compra y los agregados a mano no compiten.
 */
function pickRecommended(scenarios) {
  let best = null;
  for (const s of Array.isArray(scenarios) ? scenarios : []) {
    if (!s || s.isBase || s.kind !== "savings" || (s.requiresSpending || 0) > 0) continue;
    const value = netBenefit(s);
    if (value > 0 && (!best || value > best.value)) best = { id: s.id, value };
  }
  return best ? best.id : null;
}

/**
 * Como se lee el monto de una tarjeta de oportunidad en el deck y el PDF. Una estrategia con un
 * costo en plata (aportes a empleados) muestra los dos numeros: el ahorro solo enganaria.
 */
function opportunityAmountText(o, fmt) {
  if (o?.kind === "risk") return `cost ${fmt(Math.abs(Number(o.taxSavings) || 0))}`;
  if (o?.kind === "compliance") return "compliance";
  if (o?.kind === "discussion") return "to discuss";
  if (Number(o?.extraCost) > 0) return `${fmt(o.taxSavings)} tax savings · up to ${fmt(o.extraCost)} cost`;
  const min = Number(o?.estimatedSavings?.min) || 0;
  const max = Number(o?.estimatedSavings?.max) || 0;
  if (!max) return "";
  return min === max || !min ? `${fmt(max)} potential savings` : `${fmt(min)}–${fmt(max)} potential savings`;
}

module.exports = {
  REASONABLE_COMP_FLAG, REASONABLE_COMP_TARGET, SCORP_ELECTION_MIN_PROFIT, SCORP_ANNUAL_COST, SAFE_HARBOR_PCT,
  planStrategies, netBenefit, pickRecommended, opportunityAmountText,
};
