"use strict";

/**
 * balance-sheet-equity.js — las ganancias acumuladas del Schedule L cuando el balance separa
 * el resultado del ejercicio.
 *
 * QuickBooks muestra el patrimonio con dos renglones: "Retained Earnings" (lo acumulado hasta
 * el cierre anterior) y "Net Income" (el resultado del ejercicio, todavia sin cerrar). En la
 * declaracion esa separacion no existe: el Schedule L linea 25 lleva la suma en cada fecha, y
 * el Schedule M-2 arranca de la suma al inicio del año.
 *
 * En una corrida real la guia de carga sumo los dos renglones al cierre y en el M-2, pero no en
 * el Schedule L al inicio: puso 58.300 donde iban 102.747,90, y el balance de la declaracion al
 * inicio quedo descuadrado por exactamente el resultado del año anterior. Este modulo lee el
 * balance subido, calcula la suma por codigo, se la da al modelo como un hecho y despues
 * corrige la guia si igual se olvido del renglon de Net Income.
 */

const { sheetsFromExtractedText } = require("./sheet-text");

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** La fecha que nombra una celda de encabezado ("As of Dec 31, 2025", "12/31/2025", "2025-12-31"). */
function cellDate(text) {
  const s = String(text ?? "").toLowerCase();
  let m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m) return { y: Number(m[3]), m: MONTHS[m[1]], d: Number(m[2]) };
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return { y: Number(m[3]), m: Number(m[1]), d: Number(m[2]) };
  m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return null;
}

/** Un importe como lo escribe una exportacion: "58,300.00", "(1,234.56)", "-45,600.00", "$9.00". */
function amount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text.replace(/[$\s]/g, ""));
  const digits = text.replace(/[()$,\s-]/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  return (negative ? -1 : 1) * Number(digits);
}

const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const labelOf = (row) => String((row || []).find((cell) => String(cell ?? "").trim()) ?? "").trim();

/**
 * Lee el patrimonio del balance subido. Devuelve null si no hay un balance con renglones
 * "Retained Earnings" y "Net Income" separados, o si ninguna columna es el cierre del año
 * elegido o del anterior.
 *
 * { file, sheet, boy: { date, retainedEarnings, netIncome, total } | null, eoy: igual | null }
 */
function readBalanceSheetEquity(files, taxYear) {
  const year = Number(taxYear);
  if (!Number.isInteger(year)) return null;
  for (const file of Array.isArray(files) ? files : []) {
    if (!["current_financials", "supporting_document"].includes(file?.preparationRole)) continue;
    for (const sheet of sheetsFromExtractedText(file.text)) {
      const rows = sheet.rows;
      const reRow = rows.findIndex((row) => /^retained earnings$/i.test(labelOf(row)));
      if (reRow < 0) continue;
      const niRow = rows.findIndex((row, i) => i > reRow && /^(net income|current year earnings)$/i.test(labelOf(row)));
      if (niRow < 0) continue;

      // Las columnas con fecha salen del encabezado. Un balance de una sola fecha la trae en el
      // titulo ("As of Dec 31, 2025") y tiene una sola columna de importes.
      const columns = new Map();
      for (const row of rows.slice(0, reRow)) {
        row.forEach((cell, c) => { if (c > 0 && !columns.has(c)) { const date = cellDate(cell); if (date) columns.set(c, date); } });
      }
      if (!columns.size) {
        const titleDate = rows.slice(0, 6).map((row) => cellDate(labelOf(row))).find(Boolean);
        if (titleDate) columns.set(1, titleDate);
      }
      const pick = (y) => [...columns.entries()].find(([, d]) => d.y === y && d.m === 12 && d.d === 31);
      const read = (entry) => {
        if (!entry) return null;
        const [col, d] = entry;
        const retainedEarnings = amount(rows[reRow][col]);
        const netIncome = amount(rows[niRow][col]);
        if (retainedEarnings === null || netIncome === null) return null;
        return { date: `12/31/${d.y}`, retainedEarnings, netIncome, total: round2(retainedEarnings + netIncome) };
      };
      const boy = read(pick(year - 1));
      const eoy = read(pick(year));
      if ((boy && Math.abs(boy.netIncome) >= 0.5) || (eoy && Math.abs(eoy.netIncome) >= 0.5)) {
        return { file: String(file.name || ""), sheet: sheet.name, boy, eoy };
      }
    }
  }
  return null;
}

/** El hecho que recibe el modelo, o "". */
function equityFactsPrompt(facts) {
  if (!facts || (!facts.boy && !facts.eoy)) return "";
  const line = (label, v) => `- ${label} (${v.date}): Retained Earnings ${money(v.retainedEarnings)} + Net Income ${money(v.netIncome)} = ${money(v.total)}, plus any other equity line in that column that belongs in retained earnings (dividends, distributions).`;
  return [
    `BALANCE SHEET EQUITY (read by code from "${facts.file}"): the balance sheet shows Retained Earnings and a separate Net Income line. The return has no separate net income line: Schedule L line 25 (unappropriated retained earnings) at each date is Retained Earnings plus the Net Income of that same column.`,
    ...(facts.boy ? [line("Beginning of year", facts.boy)] : []),
    ...(facts.eoy ? [line("End of year", facts.eoy)] : []),
    ...(facts.boy ? [`The Net Income in the ${facts.boy.date} column is the prior year's result, not the current year's. Schedule M-2 line 1 is the beginning-of-year figure, and Schedule L must balance at the beginning of the year as well as at the end.`] : []),
  ].join("\n");
}

/** Que campo de la guia es: Schedule L linea 25 al inicio o al cierre, o M-2 linea 1. */
function guideFieldKind(screen, field) {
  const text = `${screen?.screenPath || ""} ${field?.fieldName || ""} ${field?.lineReference || ""}`;
  const isM2 = /\bm-?2\b/i.test(text);
  const boy = /\bboy\b|beginning/i.test(text);
  const eoy = /\beoy\b|end of (the )?year|\bending\b/i.test(text);
  if (isM2) return /\bl\s*1\b|line\s*1\b/i.test(text) || (boy && !eoy) ? "m2" : null;
  const retained = /retained earnings/i.test(text) && !/(?<!un)appropriated/i.test(text);
  const scheduleL = /\bsch(?:edule)?\.?\s*l\b|\bl\s*25\b|line\s*25\b|balance sheet/i.test(text);
  if (!retained || !scheduleL || boy === eoy) return null;
  return boy ? "boy" : "eoy";
}

/**
 * Corrige la guia de carga: si el Schedule L linea 25 (o el M-2 linea 1) quedo con el renglon de
 * Retained Earnings solo, le suma el Net Income de esa misma fecha. Cualquier otro valor se deja
 * como esta — puede incluir dividendos o distribuciones — y el control lo muestra.
 *
 * Agrega un control por cada fecha del Schedule L que encontro. Devuelve las correcciones.
 */
function fixRetainedEarningsInGuide(guide, facts) {
  const changes = [];
  if (!guide || !facts) return changes;
  const found = {};
  for (const screen of Array.isArray(guide.screens) ? guide.screens : []) {
    for (const field of Array.isArray(screen.fields) ? screen.fields : []) {
      const kind = guideFieldKind(screen, field);
      const target = kind === "m2" ? facts.boy : kind ? facts[kind] : null;
      if (!target) continue;
      const current = amount(field.value);
      if (current !== null && Math.abs(target.netIncome) >= 0.5 && Math.abs(current - target.retainedEarnings) < 0.5) {
        field.value = target.total;
        field.valueSource = `Retained Earnings ${money(target.retainedEarnings)} + Net Income ${money(target.netIncome)} (balance sheet ${target.date})`;
        field.statusNote = `Corrected by code: the guide had only the Retained Earnings line (${money(current)}); the ${target.date} balance sheet also shows Net Income of ${money(target.netIncome)} as a separate equity line, and on the return both are retained earnings.`;
        changes.push({ kind, date: target.date, from: current, to: target.total });
      }
      if (kind !== "m2") found[kind] = amount(field.value);
    }
  }
  if (!Array.isArray(guide.tieOutChecks)) guide.tieOutChecks = [];
  for (const kind of ["boy", "eoy"]) {
    const target = facts[kind];
    if (!target || found[kind] === undefined || found[kind] === null) continue;
    const difference = round2(found[kind] - target.total);
    guide.tieOutChecks.push({
      check: `Schedule L retained earnings, ${kind === "boy" ? "beginning" : "end"} of year vs balance sheet ${target.date}`,
      guideAmount: found[kind],
      financialAmount: target.total,
      difference,
      status: Math.abs(difference) < 0.5 ? "OK" : "NEEDS_REVIEW",
      note: `Computed by code from ${facts.file}: Retained Earnings ${money(target.retainedEarnings)} + Net Income ${money(target.netIncome)}.${Math.abs(difference) < 0.5 ? "" : " Any difference should be dividends or distributions; otherwise correct the entry."}`,
    });
  }
  return changes;
}

/** La nota para AI Notes cuando hubo correcciones, o "". */
function retainedEarningsNote(changes, facts) {
  if (!changes.length) return "";
  const where = { boy: "Schedule L retained earnings (beginning of year)", eoy: "Schedule L retained earnings (end of year)", m2: "Schedule M-2 line 1" };
  return changes.map((c) => `${where[c.kind]} corrected by code: ${money(c.from)} was the balance sheet's Retained Earnings line alone; the ${c.date} column of ${facts.file} also shows Net Income as a separate equity line, so the entry is ${money(c.to)}.`).join(" ");
}

module.exports = { readBalanceSheetEquity, equityFactsPrompt, fixRetainedEarningsInGuide, retainedEarningsNote, cellDate, amount };
