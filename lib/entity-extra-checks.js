"use strict";

/**
 * entity-extra-checks.js — cruces de 1065, 1120-S y 1120 socio por socio y año contra año.
 *
 * Los cruces de entidad que ya existian miran la declaracion como un todo (el balance cuadra, el
 * M-2 se arrastra, los K-1 suman el Schedule K). Lo que se escapaba esta un nivel mas abajo: cada
 * socio contra si mismo el año anterior. Un socio que no aparece mas y nunca recibio un K-1
 * final, una cuenta de capital que no abre donde cerro, un porcentaje que cambia sin que nadie
 * lo registre, una pregunta del Schedule B que dice que nadie tiene el 50% cuando un K-1 dice que
 * si. Tambien lo que ata dentro de la misma declaracion y el software no controla: pagos
 * garantizados de la pagina 1 contra el Schedule K, el M-2 contra el capital del balance, el
 * inventario inicial contra el final del año anterior, y los K-1 recibidos contra lo cargado.
 */

const { splitReturns } = require("./prior-year-bridge");
const { textOf, linesOf, lineAmount } = require("./return-facts");
const ef = require("./entity-facts");
const pd = require("./package-docs");
const rf = require("./return-facts");

const fmt = (n) => `${Number(n) < 0 ? "-" : ""}$${Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US")}`;
const pct = (n) => `${Number(n.toFixed(3))}%`;
const tail4 = (tin) => `…${String(tin || "").slice(-4)}`;
const has = (v) => v !== null && v !== undefined;
const differs = (a, b, tol = 1) => has(a) && has(b) && Math.abs(a - b) > tol;
const ownerLabel = (k) => `${k.name || "an owner"} (${tail4(k.tin)})`;

function finding(severity, category, title, detail, action, authority, evidence) {
  return { severity, category, title, detail, action, authority, evidence };
}

function taxYearOf(meta, text) {
  const chosen = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
  if (Number.isFinite(chosen) && chosen > 2000) return chosen;
  const m = /Form (?:1065|1120-?S|1120) \((\d{4})\)/.exec(text);
  return m ? Number(m[1]) : null;
}

function context(files, meta = {}) {
  const { current, prior } = splitReturns(files, meta);
  if (!current) return null;
  const text = textOf(current);
  const type = ef.entityType(text);
  if (!type) return null;
  const priorText = prior ? textOf(prior) : "";
  const sameType = priorText && ef.entityType(priorText) === type;
  return {
    files, meta, current, prior, text, type,
    taxYear: taxYearOf(meta, text),
    textLines: linesOf(text),
    priorText: sameType ? priorText : "",
    lines: ef.entityLines(text),
    priorLines: sameType ? ef.entityLines(priorText) : null,
    k1s: ef.issuedK1s(text),
    priorK1s: sameType ? ef.issuedK1s(priorText) : [],
    boxes: ef.returnBoxes(text),
  };
}

/* ---------------------------------------------------------------------------
 * Socio por socio contra el año anterior
 * ------------------------------------------------------------------------- */

function checkOwnerCapitalContinuity(ctx) {
  if (ctx.type !== "1065" || !ctx.priorK1s.length) return [];
  const breaks = [];
  for (const k of ctx.k1s) {
    if (!k.tin || k.capital.beginning === null) continue;
    const candidates = ctx.priorK1s.filter((p) => p.tin === k.tin && p.capital.ending !== null);
    if (!candidates.length) continue;
    if (candidates.some((p) => !differs(p.capital.ending, k.capital.beginning))) continue;
    breaks.push(`${ownerLabel(k)} opens at ${fmt(k.capital.beginning)} and closed last year at ${candidates.map((p) => fmt(p.capital.ending)).join(" or ")}`);
  }
  if (!breaks.length) return [];
  return [finding("MEDIUM", "Partner capital", "Schedule K-1 item L — capital does not open where it closed last year",
    `${breaks.join("; ")}.`,
    "Tie each partner's beginning capital to last year's ending capital; a difference is a contribution, distribution or adjustment recorded outside the return, or a K-1 built on the wrong prior-year figures.",
    "Form 1065 Schedule K-1 instructions, item L", "Item L of every partner K-1, this year and last year.")];
}

function checkOwnersInAndOut(ctx) {
  if (!ctx.priorK1s.length || !ctx.k1s.length) return [];
  const out = [];
  const nowTins = new Set(ctx.k1s.map((k) => k.tin).filter(Boolean));
  const gone = ctx.priorK1s.filter((p) => p.tin && !nowTins.has(p.tin) && !p.final);
  if (gone.length) {
    out.push(finding("HIGH", "Owners", "Schedule K-1 — an owner from last year has no K-1 this year",
      `${gone.map(ownerLabel).join("; ")} received a K-1 last year that was not marked final, and there is no K-1 for ${gone.length > 1 ? "them" : "that owner"} this year.`,
      "If the owner left during this year, issue a final K-1 for the part of the year they held the interest; if they left last year, last year's K-1 should have been final. Either way the ownership change has to show in the percentages and capital.",
      "IRC §706(c)-(d); Schedule K-1 instructions", "Owner identifying numbers on the K-1s, this year and last year."));
  }
  const zeroed = ctx.k1s.filter((k) => {
    const endings = [k.profit[1], k.loss[1], k.capitalPct[1]].filter((v) => v !== undefined);
    return endings.length && endings.every((v) => v === 0) && !k.final;
  });
  if (zeroed.length) {
    out.push(finding("HIGH", "Owners", "Schedule K-1 — owner at 0% at year end without a final K-1",
      `${zeroed.map(ownerLabel).join("; ")} end${zeroed.length > 1 ? "" : "s"} the year with 0% of profit, loss and capital, and the Final K-1 box is not checked.`,
      "Check the Final K-1 box and make sure the capital account closes to zero with the redemption or sale.",
      "Schedule K-1 instructions, Final K-1", "Item J and the Final K-1 box of each K-1."));
  }
  const moved = [];
  for (const k of ctx.k1s) {
    if (!k.tin || k.profit.length < 1) continue;
    const prior = ctx.priorK1s.filter((p) => p.tin === k.tin && p.profit.length >= 2);
    if (!prior.length) continue;
    if (prior.some((p) => Math.abs(p.profit[1] - k.profit[0]) < 0.0005)) continue;
    moved.push(`${ownerLabel(k)} begins this year at ${k.profit[0]}% of profit and ended last year at ${prior.map((p) => `${p.profit[1]}%`).join(" or ")}`);
  }
  if (moved.length) {
    out.push(finding("MEDIUM", "Owners", "Schedule K-1 item J — beginning percentages differ from last year's ending",
      `${moved.join("; ")}.`,
      "The beginning percentages must equal last year's ending percentages; a change between years means an ownership change that was not recorded in either return.",
      "Form 1065 Schedule K-1 instructions, item J", "Item J of every partner K-1, this year and last year."));
  }
  return out;
}

/* Una nota del papel de trabajo que dice que un socio salio en el año, contra su K-1. */
const NAME = "([A-Z][a-z]+(?:\\s+[A-Z][a-z.']*){1,3})";
const DATE = "(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})";
const EXIT_NOTES = [
  new RegExp(`\\b${NAME}\\s+(?:was\\s+|were\\s+)?(?:brought|bought)\\s+out\\s+(?:on\\s+|as of\\s+|effective\\s+)?${DATE}`, "g"),
  new RegExp(`\\b(?:[Bb]uy-?out|[Rr]edemption|[Ww]ithdrawal)\\s+of\\s+${NAME}\\s+(?:on|as of|effective)\\s+${DATE}`, "g"),
  new RegExp(`\\b${NAME}\\s+(?:withdrew|exited|left the (?:partnership|company|LLC)|sold (?:his|her|their|its) (?:entire )?(?:interest|units|membership interest|shares))\\b[^.\\n]{0,40}?(?:on|as of|effective)\\s+${DATE}`, "g"),
];

function yearOfDate(date) {
  const y = Number(String(date).split("/")[2]);
  return y < 100 ? 2000 + y : y;
}

function checkOwnerExitNotes(ctx) {
  if (!ctx.k1s.length || !ctx.taxYear) return [];
  const exclude = new Set([ctx.current, ctx.prior].filter(Boolean));
  const notes = new Map();
  for (const doc of pd.packageDocuments(ctx.files, { exclude })) {
    if (!doc.text) continue;
    for (const re of EXIT_NOTES) {
      re.lastIndex = 0;
      for (const m of doc.text.matchAll(re)) {
        if (yearOfDate(m[2]) !== ctx.taxYear) continue;
        const key = `${m[1].toUpperCase()}|${m[2]}`;
        if (!notes.has(key)) notes.set(key, { name: m[1], date: m[2], doc: doc.name });
      }
    }
  }
  const out = [];
  for (const note of notes.values()) {
    const words = note.name.toUpperCase().split(/\s+/);
    const surname = words[words.length - 1].replace(/[^A-Z'-]/g, "");
    if (surname.length < 3) continue;
    const re = new RegExp(`\\b${surname}\\b`);
    let matches = ctx.k1s.filter((k) => re.test(String(k.name || "").toUpperCase()));
    if (matches.length > 1) matches = matches.filter((k) => new RegExp(`\\b${words[0]}\\b`).test(String(k.name).toUpperCase()));
    if (matches.length !== 1) continue;
    const k = matches[0];
    if (k.final) continue;
    const share = ef.endingShare(k);
    out.push(finding("HIGH", "Owners", "Schedule K-1 — owner left during the year and the K-1 is not final",
      `${note.doc} records that ${note.name} left the ${ctx.type === "1065" ? "partnership" : "corporation"} on ${note.date}, but the K-1 for ${ownerLabel(k)} is not marked final${share > 0 ? ` and still shows ${pct(share)} at year end` : ""}.`,
      "Issue a final K-1 that closes the owner's capital account, allocate the year's income through the exit date (interim closing or proration, per the agreement), and move the percentage to the remaining owners. Consider whether a section 754 election or a section 743(b) adjustment applies to the transfer.",
      "IRC §§706(c)-(d), 743, 754; Schedule K-1 instructions", `Workpaper note in ${note.doc}; the owner's K-1.`));
  }
  return out;
}

function checkDuplicateOwnerTins(ctx) {
  const counts = new Map();
  for (const k of ctx.k1s) if (k.tin) counts.set(k.tin, (counts.get(k.tin) || 0) + 1);
  const dup = [...counts.entries()].filter(([, n]) => n > 1);
  if (!dup.length) return [];
  return [finding("LOW", "Owners", "Schedule K-1 — two owners share one identifying number",
    `${dup.map(([tin, n]) => `${n} K-1s use the number ending ${String(tin).slice(-4)}`).join("; ")}.`,
    "Confirm each owner's TIN. A trust uses the grantor's SSN only if it is a grantor trust reported that way; otherwise it needs its own EIN, and two K-1s under one number are matched to one person.",
    "IRC §6109; Schedule K-1 instructions, items E and F", "Identifying numbers on the K-1s.")];
}

/* ---------------------------------------------------------------------------
 * Preguntas del Schedule B contra los K-1
 * ------------------------------------------------------------------------- */

const Q2A = /Did any foreign or domestic corporation, partnership \(including any entity treated as a partnership\), trust, or tax-exempt/i;
const Q2B = /Did any individual or estate own, directly or indirectly, an interest of 50% or more/i;

/** Apellidos de un socio persona: la ultima palabra, sin "TRUSTEE", "TRUST" ni sufijos; los compuestos se parten. */
function surnames(name) {
  const clean = String(name || "").toUpperCase()
    .replace(/\b(?:TRUSTEES?|TTEES?|JR|SR|III|II|IV|MD|ESQ|CPA)\b\.?/g, " ")
    .replace(/\b(?:THE|FAMILY|TRUST|REVOCABLE|IRREVOCABLE|LIVING|GRANTOR|DTD|DATED|FBO|ESTATE|OF|AND)\b/g, " ");
  const words = clean.split(/[^A-Z'-]+/).filter((w) => w.length >= 3);
  if (!words.length) return [];
  return words[words.length - 1].split("-").filter((w) => w.length >= 3);
}

function checkFiftyPercentOwner(ctx) {
  if (ctx.type !== "1065" || !ctx.k1s.length) return [];
  const q2a = ef.answerAfter(ctx.textLines, Q2A);
  const q2b = ef.answerAfter(ctx.textLines, Q2B);
  const hasB1 = ef.entityHasForm(ctx.text, "B-1");
  const out = [];
  const big = ctx.k1s.map((k) => ({ k, share: ef.endingShare(k) })).filter((x) => x.share >= 50);
  for (const { k, share } of big) {
    const question = k.ownerKind === "individual" ? "2b" : k.ownerKind === "entity" ? "2a" : null;
    const answer = question === "2a" ? q2a : question === "2b" ? q2b : null;
    if (answer === "No") {
      out.push(finding("HIGH", "Schedule B", `Form 1065 Schedule B question ${question} — answered No with a 50% owner`,
        `Question ${question} says no ${question === "2a" ? "entity" : "individual or estate"} owns 50% or more, but the K-1 for ${ownerLabel(k)} shows ${pct(share)} at year end.`,
        `Answer Yes and attach Schedule B-1${hasB1 ? "" : " (not in the return)"}.`,
        "Form 1065 Schedule B, question 2; Schedule B-1 instructions", `Schedule B question ${question}; item J of the K-1.`));
    } else if (answer === "Yes" && !hasB1) {
      out.push(finding("MEDIUM", "Schedule B", "Schedule B-1 — required by question 2 and not attached",
        `Schedule B question ${question} is answered Yes and ${ownerLabel(k)} holds ${pct(share)}, but the return has no Schedule B-1.`,
        "Attach Schedule B-1 listing the 50%-or-more owners.", "Schedule B-1 instructions", `Schedule B question ${question}; forms in the return.`));
    } else if (answer === "Yes" && hasB1 && k.tin) {
      const start = ctx.textLines.findIndex((l) => /^\s*SCHEDULE B-1\b/.test(l));
      let end = start + 1;
      while (start >= 0 && end < Math.min(ctx.textLines.length, start + 70) && !/^--- Page \d+ ---|Schedule B-1 \(Form 1065\) \(Rev/.test(ctx.textLines[end])) end += 1;
      const section = start >= 0 ? ctx.textLines.slice(start, end + 1).join(" ") : "";
      if (section && !section.includes(k.tin)) {
        out.push(finding("MEDIUM", "Schedule B", "Schedule B-1 — does not list the 50% owner",
          `Schedule B-1 is attached, but it does not list ${ownerLabel(k)}, whose K-1 shows ${pct(share)} at year end.`,
          "List every direct or constructive owner of 50% or more on Schedule B-1 with its identifying number and percentage.",
          "Schedule B-1 instructions", "Schedule B-1; item J of the K-1."));
      }
    }
  }
  // Propiedad constructiva: una familia que junta el 50% entre varios K-1 (IRC §267(c)).
  if (!big.length && q2b === "No") {
    const groups = new Map();
    for (const k of ctx.k1s) {
      if (k.ownerKind !== "individual") continue;
      for (const s of surnames(k.name)) {
        const g = groups.get(s) || { share: 0, owners: [] };
        if (!g.owners.includes(k)) { g.share += ef.endingShare(k); g.owners.push(k); }
        groups.set(s, g);
      }
    }
    const top = [...groups.entries()].filter(([, g]) => g.owners.length >= 2 && g.share >= 50).sort((a, b) => b[1].share - a[1].share)[0];
    if (top) {
      const [surname, g] = top;
      out.push(finding("MEDIUM", "Schedule B", "Schedule B question 2b — family members may reach 50% together",
        `Question 2b is answered No, but ${g.owners.length} owners with the surname ${surname} hold ${pct(g.share)} together (${g.owners.map((k) => `${k.name} ${pct(ef.endingShare(k))}`).join("; ")}).`,
        `If they are family (spouse, ancestors, descendants, siblings) or trusts for their benefit, constructive ownership attributes each one's interest to the others and the answer is Yes, with Schedule B-1${hasB1 ? "" : " (not in the return)"}. Confirm the relationships.`,
        "Form 1065 Schedule B, question 2b; IRC §267(c)", "Schedule B question 2b; item J of the K-1s."));
    }
  }
  return out;
}

/* Un K-1 recibido que muestra 20% o mas de otra sociedad contra la pregunta que lo declara. */
const Q_OWN_PARTNERSHIP = /Own directly an interest of 20% or more, or own, directly or indirectly, an interest of 50% or more in the profit, loss, or capital/i;

function checkInvesteeOwnership(ctx) {
  const answer = ef.answerAfter(ctx.textLines, Q_OWN_PARTNERSHIP);
  if (answer !== "No") return [];
  const own = ef.entityEin(ctx.text);
  const big = ef.receivedK1s(ctx.files, ctx.meta)
    .filter((r) => r.k1 && r.k1.form === "1065" && (!own || !r.k1.tin || r.k1.tin === own) && (!r.year || r.year === ctx.taxYear))
    .map((r) => ({ r, share: ef.endingShare(r.k1) })).filter((x) => x.share >= 20);
  if (!big.length) return [];
  const q = ctx.type === "1065" ? "Schedule B question 3b" : ctx.type === "1120-S" ? "Schedule B question 4b" : "Schedule K question 5b";
  return [finding("MEDIUM", "Schedule B", `${q} — answered No with a 20% interest in a partnership`,
    `The return says it holds no 20% interest in a partnership, but ${big.map(({ r, share }) => `the K-1 in ${r.name} shows ${pct(share)}`).join("; ")}.`,
    "Answer Yes and complete the table (name, EIN, country, percentage) for each partnership held at 20% or more.",
    `Form ${ctx.type} instructions, ${q}`, `${q}; item J of the K-1s received.`)];
}

function checkScheduleG(ctx) {
  if (ctx.type !== "1120") return [];
  const a = ef.answerAfter(ctx.textLines, /complete Part I of Schedule G \(Form 1120\)|own directly 20% or more, or own, directly or indirectly, 50% or more of the total voting power of all classes of the corporation.s stock entitled to vote\? If "Yes," complete Part I/i);
  const b = ef.answerAfter(ctx.textLines, /Did any individual or estate own directly 20% or more/i);
  if (a !== "Yes" && b !== "Yes") return [];
  if (ef.entityHasForm(ctx.text, "G")) return [];
  return [finding("MEDIUM", "Schedule K", "Schedule G — required by Schedule K question 4 and not attached",
    `Schedule K question 4${a === "Yes" ? "a" : "b"} is answered Yes (an owner of 20% or more), and the return has no Schedule G.`,
    "Attach Schedule G (Form 1120) listing those owners.", "Form 1120 Schedule K, question 4; Schedule G instructions", "Schedule K question 4; forms in the return.")];
}

/* ---------------------------------------------------------------------------
 * Lo que ata dentro de la misma declaracion
 * ------------------------------------------------------------------------- */

function checkGuaranteedPayments(ctx) {
  if (ctx.type !== "1065") return [];
  const { guaranteedPage1: p1, guaranteedK: k } = ctx.lines;
  if (!(p1 > 0) && !(k > 0)) return [];
  if (!differs(p1 || 0, k || 0)) return [];
  return [finding("MEDIUM", "Guaranteed payments", "Form 1065 line 10 and Schedule K line 4c — guaranteed payments differ",
    `Page 1 line 10 deducts ${fmt(p1 || 0)} of guaranteed payments and Schedule K line 4c reports ${fmt(k || 0)}.`,
    "The same guaranteed payments are deducted on page 1 and reported to the partners on Schedule K and the K-1s (box 4); correct whichever is wrong.",
    "Form 1065 instructions, line 10 and Schedule K line 4", "Form 1065 page 1 line 10; Schedule K line 4c.")];
}

function checkReasonableCompensation(ctx) {
  if (ctx.type !== "1120-S") return [];
  const { officerComp, distributions, ordinary } = ctx.lines;
  if (officerComp > 0 || !(ordinary > 0)) return [];
  const before = ctx.priorLines && ctx.priorLines.officerComp > 0 ? ctx.priorLines.officerComp : 0;
  if (distributions > 0) {
    return [finding("MEDIUM", "Shareholder compensation", "Form 1120-S line 7 — distributions with no officer compensation",
      `The corporation distributed ${fmt(distributions)} (Schedule K line 16d) on ${fmt(ordinary)} of ordinary income and paid no officer compensation (line 7).${before ? ` Last year's return paid ${fmt(before)}.` : ""}`,
      "Shareholder-officers who work in the business must be paid reasonable wages before distributions; otherwise the IRS can recharacterize distributions as wages subject to payroll tax. Document the officers' roles or run payroll.",
      "IRC §§3121, 1366; Rev. Rul. 74-44", "Form 1120-S line 7 and Schedule K line 16d.")];
  }
  if (!before) return [];
  return [finding("MEDIUM", "Shareholder compensation", "Form 1120-S line 7 — officer compensation dropped to zero",
    `Last year the corporation paid ${fmt(before)} of officer compensation; this year line 7 is empty while ordinary income is ${fmt(ordinary)}.`,
    "Confirm whether payroll stopped (and why) or whether the W-2 wages were left off the return. If the shareholders still work in the business, reasonable compensation is expected before any distribution.",
    "IRC §§162, 3121; Rev. Rul. 74-44", "Form 1120-S line 7, this year and last year.")];
}

function checkOfficerCompAgainst1125E(ctx) {
  const { officerComp, officerComp1125E } = ctx.lines;
  if (!has(officerComp1125E) || !differs(officerComp || 0, officerComp1125E)) return [];
  return [finding("MEDIUM", "Officer compensation", "Form 1125-E — total differs from officer compensation on page 1",
    `Form 1125-E totals ${fmt(officerComp1125E)} and page 1 deducts ${fmt(officerComp || 0)} of officer compensation.`,
    "Tie page 1 to Form 1125-E line 4 and to the officers' W-2s.", "Form 1125-E instructions", "Form 1125-E line 4; page 1 officer compensation.")];
}

function checkM2AgainstBalanceSheet(ctx) {
  const { m2Ending, partnersCapital, retainedEarnings } = ctx.lines;
  const l = ctx.type === "1065" ? partnersCapital : ctx.type === "1120" ? retainedEarnings : null;
  if (!l || !has(l.ending) || !has(m2Ending) || !differs(l.ending, m2Ending)) return [];
  const label = ctx.type === "1065" ? "partners' capital (Schedule L line 21)" : "unappropriated retained earnings (Schedule L line 25)";
  return [finding("MEDIUM", "Balance sheet", "Schedule M-2 — ending balance differs from the balance sheet",
    `Schedule M-2 ends the year at ${fmt(m2Ending)} and ${label} ends at ${fmt(l.ending)}.`,
    "Both come from the same books; find the equity movement that reached one and not the other.",
    `Form ${ctx.type} Schedules L and M-2`, "Schedule L and Schedule M-2, end of year.")];
}

function checkM2Continuity(ctx) {
  if (!ctx.priorLines) return [];
  const now = ctx.lines.m2Beginning;
  const before = ctx.type === "1120-S" ? ctx.priorLines.m2EndingFirstColumn : ctx.priorLines.m2Ending;
  if (!differs(now, before)) return [];
  const what = ctx.type === "1120-S" ? "the accumulated adjustments account (column a)" : ctx.type === "1065" ? "partners' capital" : "retained earnings";
  return [finding("MEDIUM", "Prior-year continuity", "Schedule M-2 — does not open where last year closed",
    `Schedule M-2 opens ${what} at ${fmt(now)}; last year's return closed it at ${fmt(before)}.`,
    `The opening balance must equal last year's closing balance${ctx.type === "1120-S" ? "; the AAA drives how future distributions are taxed" : ""}. Document the restatement or correct the opening figure.`,
    `Form ${ctx.type} Schedule M-2 instructions`, "Schedule M-2 line 1 this year; last line of Schedule M-2 last year.")];
}

function checkAaaDistributions(ctx) {
  if (ctx.type !== "1120-S") return [];
  const { m2Combined, m2Distributions, m2EndingFirstColumn } = ctx.lines;
  if (!(m2Distributions > 0) || !has(m2Combined) || m2Combined < 0 || !has(m2EndingFirstColumn) || m2EndingFirstColumn >= 0) return [];
  return [finding("MEDIUM", "Distributions", "Schedule M-2 — distributions drive the accumulated adjustments account below zero",
    `Column (a) shows ${fmt(m2Combined)} before distributions and ${fmt(m2Distributions)} of distributions, closing at ${fmt(m2EndingFirstColumn)}.`,
    "Distributions cannot reduce the AAA below zero. The excess comes out of accumulated earnings and profits (a dividend) if there are any, and otherwise reduces stock basis — gain if it exceeds basis (Form 7203). Limit line 7 of column (a) and report the excess where it belongs.",
    "IRC §1368; Treas. Reg. §1.1368-2(a)(3)(iii)", "Schedule M-2 column (a), lines 6-8; Form 7203.")];
}

function checkM1Closes(ctx) {
  const { m1Closing } = ctx.lines;
  const target = ctx.type === "1065" ? ctx.lines.analysisIncome : ctx.type === "1120-S" ? ctx.lines.incomeReconciliation : ctx.lines.incomeBeforeNol;
  if (!differs(m1Closing, target)) return [];
  const where = ctx.type === "1065" ? "Analysis of Net Income (Loss) line 1" : ctx.type === "1120-S" ? "Schedule K line 18" : "page 1 line 28";
  return [finding("MEDIUM", "Book-tax reconciliation", "Schedule M-1 — does not close to the return",
    `Schedule M-1 reconciles to ${fmt(m1Closing)}, but ${where} is ${fmt(target)}.`,
    "The last line of Schedule M-1 must equal the income per return; an override on either side leaves the reconciliation hanging. Find the item that reached only one of them.",
    `Form ${ctx.type} Schedule M-1 instructions`, `Last line of Schedule M-1; ${where}.`)];
}

function checkReturnBoxes(ctx) {
  const out = [];
  if (ctx.boxes.final && ctx.k1s.length) {
    const open = ctx.k1s.filter((k) => !k.final);
    if (open.length) {
      out.push(finding("HIGH", "Return status", "Final return checked, but not every K-1 is final",
        `The return is marked final, and ${open.length} of ${ctx.k1s.length} K-1s do not have the Final K-1 box checked.`,
        "On a final return every owner's K-1 is final and every capital account closes; check the box on each K-1 (or uncheck Final return if the entity continues).",
        "Schedule K-1 instructions, Final K-1", "Return header; Final K-1 box of each K-1."));
    }
  }
  if (!ctx.boxes.final && ctx.k1s.length >= 1 && ctx.k1s.every((k) => k.final)) {
    out.push(finding("MEDIUM", "Return status", "Every K-1 is final, but the return is not marked final",
      `All ${ctx.k1s.length} K-1s have the Final K-1 box checked and the Final return box is not checked.`,
      "If every owner left, the entity has terminated and this is its final return; otherwise the K-1s of continuing owners are not final.",
      `Form ${ctx.type} instructions, final return`, "Return header; Final K-1 box of each K-1."));
  }
  if (ctx.boxes.initial && ctx.prior && ctx.priorText) {
    const own = ef.entityEin(ctx.text);
    if (own && own === ef.entityEin(ctx.priorText)) {
      out.push(finding("MEDIUM", "Return status", "Initial return checked, but the entity filed last year",
        `The return is marked as the initial return, and the package has last year's return for the same EIN (${tail4(own)}).`,
        "Uncheck Initial return; an initial return tells the IRS there is no filing history to match.",
        `Form ${ctx.type} instructions, initial return`, "Return header; last year's return."));
    }
  }
  return out;
}

function checkInventoryContinuity(ctx) {
  if (!ctx.priorLines) return [];
  const now = ctx.lines.inventoryBegin;
  const before = ctx.priorLines.inventoryEnd;
  if (!differs(now, before)) return [];
  return [finding("HIGH", "Inventory", "Form 1125-A line 1 — opening inventory differs from last year's closing",
    `Form 1125-A opens the year with ${fmt(now)} of inventory; last year's return closed at ${fmt(before)}.`,
    "Opening inventory must equal last year's closing inventory; the difference changes cost of goods sold dollar for dollar. A change of method needs Form 3115.",
    "IRC §471; Form 1125-A instructions", "Form 1125-A line 1 this year; line 7 last year.")];
}

function checkCorporateOverpaymentCredited(ctx) {
  if (ctx.type !== "1120" || !ctx.priorLines) return [];
  const credited = ctx.priorLines.overpaymentCredited;
  if (!(credited > 0)) return [];
  const label = /Preceding year.s overpayment credited to the current year/i;
  if (!ctx.textLines.some((l) => label.test(l))) return [];
  const now = lineAmount(ctx.textLines, label, "13") || 0;
  if (now + 1 >= credited) return [];
  return [finding("HIGH", "Carryover", "Schedule J — last year's overpayment not credited",
    `Last year's Form 1120 credited ${fmt(credited)} of its overpayment to this year's estimated tax (line 36), and this return's Schedule J shows ${now ? fmt(now) : "nothing"} as the preceding year's overpayment.`,
    "Enter the credited overpayment in Schedule J, Part III.", "Form 1120 instructions, Schedule J Part III", "Form 1120 line 36 last year; Schedule J Part III this year.")];
}

function checkCorporateTaxRate(ctx) {
  if (ctx.type !== "1120") return [];
  const taxable = ctx.lines.taxableIncome;
  if (!(taxable > 0)) return [];
  const j = ctx.textLines.findIndex((l) => /Schedule J\s+Tax Computation/i.test(l));
  if (j < 0) return [];
  const row = ctx.textLines.slice(j, j + 30).find((l) => /Income tax\.\s*See instructions/i.test(l));
  const m = row && /(\d{1,3}(?:,\d{3})+|\d+)\.?\s*$/.exec(row);
  if (!m) return [];
  const tax = Number(m[1].replace(/,/g, ""));
  const expected = Math.round(taxable * 0.21);
  if (Math.abs(tax - expected) <= Math.max(1, expected * 0.002)) return [];
  return [finding("MEDIUM", "Tax computation", "Schedule J — income tax is not 21% of taxable income",
    `Taxable income of ${fmt(taxable)} at 21% is ${fmt(expected)}; Schedule J shows ${fmt(tax)}.`,
    "Recompute Schedule J; a difference usually means taxable income was overridden after the tax was calculated.",
    "IRC §11(b)", "Form 1120 line 30; Schedule J income tax.")];
}

/* La perdida operativa disponible (Schedule K pregunta 12) contra la del año anterior mas la perdida del año, menos lo usado. */
function checkCorporateNol(ctx) {
  if (ctx.type !== "1120" || !ctx.priorLines) return [];
  const now = ctx.lines.nolAvailable;
  const p = ctx.priorLines;
  if (!has(now) || !has(p.nolAvailable) || !has(p.incomeBeforeNol)) return [];
  const loss = p.taxableIncome !== null && p.taxableIncome < 0 ? -p.taxableIncome : p.incomeBeforeNol < 0 ? -p.incomeBeforeNol : 0;
  const expected = p.nolAvailable + loss - Math.max(0, p.nolDeduction || 0);
  const gap = now - expected;
  if (Math.abs(gap) <= Math.max(1000, expected * 0.01)) return [];
  return [finding("MEDIUM", "Carryover", "Schedule K question 12 — available NOL does not roll forward from last year",
    `Last year's return showed ${fmt(p.nolAvailable)} available, ${fmt(loss)} of new loss and ${fmt(Math.max(0, p.nolDeduction || 0))} used, which leaves ${fmt(expected)}; this return reports ${fmt(now)} available (${gap > 0 ? "more" : "less"} by ${fmt(Math.abs(gap))}).`,
    "Reconcile the NOL schedule year by year. Losses from before 2018 expire after 20 years and post-2017 losses are limited to 80% of taxable income; anything else is a carryover gained or lost by mistake.",
    "IRC §172; Form 1120 Schedule K, question 12", "Schedule K question 12 and page 1 lines 28-30, this year and last year.")];
}

/* La perdida de capital de la corporacion: no se deduce, pasa (5 años) como corto plazo. */
function corporateCapital(text) {
  const lines = linesOf(text);
  const i = lines.findIndex((l) => /Capital Gains and Losses/i.test(l) && /Form 1120|1120-C|1120-F/i.test(lines.slice(Math.max(0, lines.indexOf(l) - 3), lines.indexOf(l) + 4).join(" ")));
  if (i < 0) return null;
  const range = { from: i, to: Math.min(lines.length, i + 120) };
  return {
    carryover: lineAmount(lines, /Unused capital loss carryover/i, "6", range),
    shortTerm: lineAmount(lines, /Net short-term capital gain or \(loss\)\.\s*Combine lines 1a through 6/i, "7", range),
    longTerm: lineAmount(lines, /Net long-term capital gain or \(loss\)\.\s*Combine lines 8a through 13/i, "14", range),
  };
}

function checkCorporateCapitalLoss(ctx) {
  if (ctx.type !== "1120" || !ctx.priorText) return [];
  const before = corporateCapital(ctx.priorText);
  if (!before || before.shortTerm === null || before.longTerm === null) return [];
  const loss = -(before.shortTerm + before.longTerm);
  if (loss < 1) return [];
  const now = corporateCapital(ctx.text);
  if (now && Math.abs(num(now.carryover)) + 1 >= loss) return [];
  return [finding("MEDIUM", "Carryover", "Schedule D (Form 1120) line 6 — capital loss carryover not brought forward",
    `Last year's Schedule D ended with a net capital loss of ${fmt(loss)} (short-term ${fmt(before.shortTerm)}, long-term ${fmt(before.longTerm)}), which a corporation cannot deduct and carries forward; this return's line 6 shows ${now && now.carryover ? fmt(now.carryover) : "nothing"}.`,
    "Carry the unused loss to line 6 (as short-term, for up to five years) with the computation attached; it offsets this year's capital gains.",
    "IRC §§1211(a), 1212(a); Schedule D (Form 1120) instructions", "Schedule D lines 7 and 14 last year; line 6 this year.")];
}

const num = (v) => (v === null || v === undefined ? 0 : Number(v));

function checkCorporateCarryovers(ctx) {
  if (!ctx.priorText) return [];
  const out = [];
  if (ctx.type === "1120") {
    const before = rf.form4562Carryover(ctx.priorText);
    const now = rf.form4562Carryover(ctx.text);
    if (before.toNext > 0 && !(now.fromPrior !== null && Math.abs(now.fromPrior - before.toNext) <= 1)) {
      out.push(finding("MEDIUM", "Carryover", "Form 4562 line 10 — §179 carryover not brought forward",
        `Last year's Form 4562 carried ${fmt(before.toNext)} of disallowed §179 deduction to this year (line 13); this return's line 10 shows ${now.fromPrior ? fmt(now.fromPrior) : "nothing"}.`,
        "Enter the carryover on Form 4562 line 10; it is deductible this year subject to the taxable income limit.",
        "IRC §179(b)(3)(B); Form 4562 instructions", "Form 4562 line 13 last year; line 10 this year."));
    }
  }
  if (ctx.type === "1120" || ctx.type === "1120-S") {
    const before = rf.form8990(ctx.priorText);
    const now = rf.form8990(ctx.text);
    if (before.toNext > 0 && !(now.fromPrior !== null && Math.abs(now.fromPrior - before.toNext) <= 1)) {
      out.push(finding("MEDIUM", "Carryover", "Form 8990 line 2 — disallowed business interest not brought forward",
        `Last year's Form 8990 disallowed ${fmt(before.toNext)} of business interest (line 31); this return's line 2 shows ${now.fromPrior ? fmt(now.fromPrior) : "nothing"}.`,
        "Carry the disallowed business interest forward on Form 8990 line 2.", "IRC §163(j)(2); Form 8990 instructions", "Form 8990 line 31 last year; line 2 this year."));
    }
  }
  return out;
}

/* Dividendos de la pagina 1 contra el Schedule C del 1120. */
function checkDividendsSchedule(ctx) {
  if (ctx.type !== "1120") return [];
  const page1 = ctx.lines.dividendsPage1;
  if (!(page1 > 0)) return [];
  const total = lineAmount(ctx.textLines, /Total dividends and inclusions\.\s*Add column \(a\)/i, "23");
  if (total === null || !differs(total, page1)) return [];
  return [finding("MEDIUM", "Dividends", "Form 1120 line 4 — dividends differ from Schedule C",
    `Page 1 line 4 reports ${fmt(page1)} of dividends and inclusions; Schedule C line 23 totals ${fmt(total)}.`,
    "Tie line 4 to Schedule C line 23 and recompute the dividends-received deduction (Schedule C line 24 to page 1 line 29b).",
    "IRC §243; Form 1120 Schedule C instructions", "Form 1120 page 1 line 4; Schedule C lines 23-24.")];
}

/* ---------------------------------------------------------------------------
 * El credito de investigacion contra la nomina que lo sostiene.
 *
 * El credito del §41 se calcula sobre sueldos por servicios calificados, y ahi es donde se
 * pierde: una planilla que pone al 100% a toda la nomina —incluida la gente que no investiga—
 * infla el credito y, con el, la deduccion del §174 que lo acompaña. El formulario pide en la
 * Seccion E cuantos componentes de negocio generan esos gastos; dejarlo en blanco es la señal
 * de que no hay estudio detras. Nada de esto se decide con una cuenta, asi que el hallazgo
 * pregunta: nombra la proporcion, la planilla y lo que falta.
 * ------------------------------------------------------------------------- */

const RD_PERCENT_HEADER = /R&D\s*(?:%|percentage)/i;

/** La planilla de nomina de I+D del paquete: cuantas personas y cuantas al 100%. */
function researchPayroll(ctx) {
  for (const doc of currentWorkbooks(ctx)) {
    const rows = doc.text.split(/\r?\n/).map(csvCells);
    const header = rows.findIndex((r) => r.some((c) => RD_PERCENT_HEADER.test(c)));
    if (header < 0) continue;
    const column = rows[header].findIndex((c) => RD_PERCENT_HEADER.test(c));
    let people = 0;
    let full = 0;
    for (const row of rows.slice(header + 1)) {
      if (!/[A-Za-z]{3}/.test(row[0] || "") || /^total/i.test(row[0] || "")) continue;
      const value = cellNumber(row[column]);
      if (value === null) continue;
      people += 1;
      if (value === 1 || value === 100) full += 1;
    }
    if (people) return { doc: doc.name, people, full };
  }
  return null;
}

function checkResearchCreditSupport(ctx) {
  const lines = ctx.textLines;
  const qre = [5, 20].map((no) => lineAmount(lines, /Total qualified research expenses \(QREs\)\.\s*Enter amount from line 48/i, String(no)))
    .filter((v) => v !== null).sort((a, b) => b - a)[0];
  if (!(qre >= 100000)) return [];
  const wages = num(ctx.lines.officerComp) + num(ctx.lines.salaries);
  if (!(wages > 0)) return [];
  const share = qre / wages;
  if (share < 0.5) return [];
  const components = lineAmount(lines, /Enter the number of business components generating the QREs/i, "37");
  const payroll = researchPayroll(ctx);
  const everyone = payroll && payroll.full === payroll.people;
  if (components !== null && !everyone) return [];
  const detail = [
    `Form 6765 claims ${fmt(qre)} of qualified research expenses against ${fmt(wages)} of total wages on the return (${Math.round(share * 100)}%)`,
    payroll ? `the payroll schedule in ${payroll.doc} puts ${payroll.full} of its ${payroll.people} people at 100% research` : null,
    components === null ? "and Section E line 37 (number of business components) is blank" : null,
  ].filter(Boolean).join(", ");
  return [finding("MEDIUM", "Research credit", "Form 6765 — the credit rests on most of the payroll with no study behind it",
    `${detail}.`,
    "Ask for the study: business components, the qualified activities of each person, and the basis for each percentage. Wages count only for direct research, direct supervision or direct support, and a whole department at 100% holds only if substantially all of that time is qualified. The same expenses also drive the section 174 treatment, so an overstated figure is wrong twice.",
    "IRC §41(b)(2)(B) and §41(b)(2)(D)(iii) (the 80% rule); Treas. Reg. §1.41-2(d); Form 6765 Section E",
    `Form 6765 lines 5/20 and Section E line 37; page 1 wages${payroll ? `; ${payroll.doc}` : ""}.`)];
}

function checkScheduleM3Required(ctx) {
  const assets = ctx.lines.totalAssets;
  if (!assets || !(assets.ending >= 10000000) || ef.entityHasForm(ctx.text, "M-3")) return [];
  return [finding("MEDIUM", "Schedule M-3", "Schedule M-3 — required at $10 million of total assets",
    `Total assets end the year at ${fmt(assets.ending)} and the return reconciles income on Schedule M-1 instead of Schedule M-3.`,
    "File Schedule M-3 (entities with $10 million or more of total assets at year end).",
    `Form ${ctx.type} Schedule M-3 instructions`, "Schedule L total assets; schedules in the return.")];
}

function checkBusinessCodeChange(ctx) {
  const now = ctx.lines.businessCode;
  const before = ctx.priorLines && ctx.priorLines.businessCode;
  if (!now || !before || now === before) return [];
  return [finding("LOW", "Entity information", "Business activity code changed from last year",
    `The business activity code is ${now} this year and was ${before} last year.`,
    "Confirm the activity really changed; the code drives IRS comparisons and some state classifications.",
    `Form ${ctx.type} instructions, business activity codes`, "Page 1 business code, this year and last year.")];
}

function checkCaliforniaPte(ctx) {
  if (!/Pass-Through Entity Elective Tax|E-FILE PTE PAYMENT|PTE elective tax/i.test(ctx.text)) return [];
  if (!/California|Form 568|Form 100S|Form 565|FTB/i.test(ctx.text) || ef.entityHasForm(ctx.text, "3804")) return [];
  return [finding("MEDIUM", "State elections", "California PTE — payments with no Form 3804 in the return",
    "The return package shows California pass-through entity elective tax payments, and the California return does not include Form 3804 (the election and computation).",
    "The election is made on a timely filed original return with Form 3804. Without it the payment is refunded or treated as an estimate and the owners lose the federal deduction; confirm the intent and add Form 3804 (and 3804-CR for the owners) if the election is wanted.",
    "Cal. Rev. & Tax. Code §19900 et seq.; FTB Form 3804 instructions", "Client letter / FTB 8453 payment lines; forms in the California return.")];
}

function checkForeignOwner(ctx) {
  if (ctx.type !== "1120") return [];
  const answer = ef.answerAfter(ctx.textLines, /did one foreign person own, directly or indirectly, at least 25%/i);
  if (answer !== "Yes" || ef.entityHasForm(ctx.text, "5472")) return [];
  return [finding("HIGH", "Foreign ownership", "Form 5472 — 25% foreign owner with no Form 5472",
    "Schedule K question 7 answers Yes (a foreign person owns at least 25%) and the return has no Form 5472.",
    "File Form 5472 for each related party with reportable transactions; the penalty for failing to file is $25,000 per form.",
    "IRC §6038A; Form 5472 instructions", "Form 1120 Schedule K question 7; forms in the return.")];
}

function checkSaleOfBusiness(ctx) {
  const has8594 = ef.entityHasForm(ctx.text, "8594");
  const has4797 = ef.entityHasForm(ctx.text, "4797");
  if (has8594 && !has4797) {
    return [finding("HIGH", "Sale of a business", "Form 8594 filed with no Form 4797",
      "The return includes Form 8594 (an asset acquisition or sale of a business) and no Form 4797.",
      "If the entity sold the business, the sale of the business assets (depreciation recapture, section 1231 gain, goodwill) belongs on Form 4797; if it bought, confirm Form 8594 shows it as purchaser.",
      "IRC §1060; Form 8594 and Form 4797 instructions", "Forms in the return.")];
  }
  return [];
}

/* ---------------------------------------------------------------------------
 * Papel de trabajo: hoja resumen (C-200/C-201/C-202) y hoja de K-1 recibidos (C-204)
 * ------------------------------------------------------------------------- */

function csvCells(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (const ch of String(line || "")) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === "," && !quoted) { cells.push(cell.trim()); cell = ""; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function cellNumber(cell) {
  const raw = String(cell || "").replace(/[$\s]/g, "");
  if (!raw || !/\d/.test(raw)) return null;
  const neg = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  const digits = raw.replace(/[(),\-]/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(digits)) return null;
  const n = Number(digits);
  return neg ? -n : n;
}

function sheetOf(text, nameRe) {
  const re = new RegExp(`^--- Sheet:\\s*(${nameRe.source})\\s*---$`, "im");
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const next = text.slice(start).search(/^--- Sheet:/m);
  return { name: m[1], body: text.slice(start, next >= 0 ? start + next : undefined) };
}

function currentWorkbooks(ctx) {
  const exclude = new Set([ctx.current, ctx.prior].filter(Boolean));
  return pd.packageDocuments(ctx.files, { exclude })
    .filter((d) => d.text && d.types.includes("workbook") && !d.zip && /current/.test(String(d.role || "")));
}

const SUMMARY_SHEET = /review summary|resumen(?: review| para review)?|tax summary for review/;
const SUMMARY_ROWS = [
  ["ordinary", /^(?:ordinary business income|resultado ordinario|ordinary income)\b/i, "ordinary business income"],
  ["taxableIncome", /^(?:taxable income|base imponible)\b/i, "taxable income"],
  ["totalAssets", /^(?:total assets|total de activos)\b/i, "total assets"],
];

function summarySheet(ctx) {
  for (const doc of currentWorkbooks(ctx)) {
    const sheet = sheetOf(doc.text, SUMMARY_SHEET);
    if (!sheet) continue;
    const values = {};
    for (const line of sheet.body.split(/\r?\n/)) {
      const cells = csvCells(line);
      const row = SUMMARY_ROWS.find(([, re]) => re.test(cells[0] || ""));
      if (!row) continue;
      const amount = cells.slice(1).map(cellNumber).find((v) => v !== null);
      if (amount !== undefined) values[row[0]] = amount;
    }
    return { name: doc.name, values };
  }
  return null;
}

function checkWorkpaperSummary(ctx) {
  const summary = summarySheet(ctx);
  if (!summary) return [];
  const pairs = [
    ["ordinary", ctx.lines.ordinary],
    ["taxableIncome", ctx.lines.taxableIncome],
    ["totalAssets", ctx.lines.totalAssets ? ctx.lines.totalAssets.ending : null],
  ];
  const bad = pairs.filter(([key, ret]) => has(summary.values[key]) && differs(summary.values[key], ret));
  if (!bad.length) return [];
  const label = Object.fromEntries(SUMMARY_ROWS.map(([k, , l]) => [k, l]));
  return [finding("HIGH", "Workpaper tie-out", "Workpaper summary sheet — totals differ from the return",
    bad.map(([key, ret]) => `${label[key]}: workpaper ${fmt(summary.values[key])}, return ${fmt(ret)}`).join("; ") + ".",
    "The workpaper's summary sheet and the return must agree; update whichever is out of date.",
    "Firm workpaper standard", `Summary sheet in ${summary.name}.`)];
}

const LEAD_SHEET = /K-?1 Lead(?: Sheet)?|K-?1 Summary|Investments? in Partnerships/;
const NOISE_WORDS = new Set(["LLC", "LP", "L.P.", "LTD", "INC", "FUND", "THE", "OF", "AND", "CO", "COMPANY", "PARTNERS", "HOLDINGS"]);

function leadSheetRows(ctx) {
  for (const doc of currentWorkbooks(ctx)) {
    const sheet = sheetOf(doc.text, LEAD_SHEET);
    if (!sheet) continue;
    const rows = sheet.body.split(/\r?\n/).map(csvCells);
    const h = rows.findIndex((r) => r.some((c) => /^(?:Opening|Beginning) Balance$/i.test(c)) && r.some((c) => /^End(?:ing)? Balance$/i.test(c)));
    if (h < 0) continue;
    const open = rows[h].findIndex((c) => /^(?:Opening|Beginning) Balance$/i.test(c));
    const end = rows[h].findIndex((c) => /^End(?:ing)? Balance$/i.test(c));
    if (end <= open + 1) continue;
    const out = [];
    for (const r of rows.slice(h + 1)) {
      const name = r[0] || "";
      if (!/[A-Za-z]{3}/.test(name) || /^(?:total|books|deductions|k-1 income|ms 1099)/i.test(name)) continue;
      const opening = cellNumber(r[open]);
      if (opening === null) continue;
      const activity = r.slice(open + 1, end).map(cellNumber).filter((v) => v !== null && v !== 0);
      out.push({ name, opening, ending: cellNumber(r[end]), activity: activity.length });
    }
    return { doc: doc.name, sheet: sheet.name, rows: out };
  }
  return null;
}

function checkK1LeadSheet(ctx) {
  if (ctx.type !== "1065" && ctx.type !== "1120-S") return [];
  const lead = leadSheetRows(ctx);
  if (!lead) return [];
  const received = ef.receivedK1s(ctx.files, ctx.meta).filter((r) => r.k1 && (!r.year || r.year === ctx.taxYear));
  const out = [];
  for (const row of lead.rows) {
    if (row.activity || (has(row.ending) && differs(row.ending, row.opening))) continue;
    const words = row.name.toUpperCase().replace(/[^A-Z0-9 &'-]/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !NOISE_WORDS.has(w));
    if (words.length < 1) continue;
    const key = words.slice(0, 2).join(" ");
    const match = received.find((r) => r.head.includes(key));
    if (!match) continue;
    const c = match.k1.capital;
    const moved = (has(c.income) && Math.abs(c.income) >= 1) || c.contributed > 0 || (has(c.withdrawals) && c.withdrawals !== 0);
    if (!moved) continue;
    const parts = [];
    if (has(c.income) && c.income !== 0) parts.push(`current-year ${c.income < 0 ? "loss" : "income"} of ${fmt(Math.abs(c.income))}`);
    if (c.contributed > 0) parts.push(`contributions of ${fmt(c.contributed)}`);
    if (has(c.withdrawals) && c.withdrawals !== 0) parts.push(`distributions of ${fmt(Math.abs(c.withdrawals))}`);
    out.push(`${row.name}: the lead sheet carries no ${ctx.taxYear || "current-year"} activity (opening and ending ${fmt(row.opening)}), but the K-1 in the package (${match.name}) reports ${parts.join(", ")}`);
  }
  if (!out.length) return [];
  return [finding("HIGH", "K-1s received", "K-1 lead sheet — a K-1 in the package was not loaded",
    `${out.join("; ")}.`,
    "Post each K-1 to the lead sheet and carry its items to Schedule K; then re-run the allocation to the partners.",
    "Form 1065/1120-S Schedule K instructions", `${lead.sheet} in ${lead.doc}; K-1s received in the package.`)];
}

/* ---------------------------------------------------------------------------
 * Todo junto
 * ------------------------------------------------------------------------- */

const CHECKS = [
  checkOwnerCapitalContinuity, checkOwnersInAndOut, checkOwnerExitNotes, checkDuplicateOwnerTins,
  checkFiftyPercentOwner, checkInvesteeOwnership, checkScheduleG,
  checkGuaranteedPayments, checkReasonableCompensation, checkOfficerCompAgainst1125E,
  checkM2AgainstBalanceSheet, checkM2Continuity, checkAaaDistributions, checkM1Closes, checkReturnBoxes,
  checkInventoryContinuity, checkCorporateOverpaymentCredited, checkCorporateTaxRate, checkCorporateNol,
  checkCorporateCapitalLoss, checkCorporateCarryovers, checkDividendsSchedule,
  checkResearchCreditSupport, checkScheduleM3Required, checkBusinessCodeChange, checkCaliforniaPte, checkForeignOwner, checkSaleOfBusiness,
  checkWorkpaperSummary, checkK1LeadSheet,
];

function runEntityExtraChecks(files, meta = {}) {
  let ctx = null;
  try { ctx = context(files, meta); } catch (error) { console.warn(`[entity-extra] ${error.message}`); }
  if (!ctx) return [];
  const out = [];
  for (const check of CHECKS) {
    try { out.push(...check(ctx)); } catch (error) { console.warn(`[entity-extra] ${check.name}: ${error.message}`); }
  }
  return out;
}

module.exports = {
  runEntityExtraChecks, context, summarySheet, leadSheetRows, surnames, csvCells, cellNumber,
  checkOwnerCapitalContinuity, checkOwnersInAndOut, checkOwnerExitNotes, checkDuplicateOwnerTins,
  checkFiftyPercentOwner, checkInvesteeOwnership, checkScheduleG,
  checkGuaranteedPayments, checkReasonableCompensation, checkOfficerCompAgainst1125E,
  checkM2AgainstBalanceSheet, checkM2Continuity, checkAaaDistributions, checkM1Closes, checkReturnBoxes,
  checkInventoryContinuity, checkCorporateOverpaymentCredited, checkCorporateTaxRate, checkCorporateNol,
  checkResearchCreditSupport, checkScheduleM3Required, checkBusinessCodeChange, checkCaliforniaPte, checkForeignOwner, checkSaleOfBusiness,
  checkWorkpaperSummary, checkK1LeadSheet, checkCorporateCapitalLoss, checkCorporateCarryovers, checkDividendsSchedule,
  checkResearchCreditSupport, researchPayroll,
};
