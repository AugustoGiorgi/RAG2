"use strict";

/**
 * k1-builder.js — deterministic Schedule K-1 allocation sheet for 1065 / 1120-S.
 *
 * One tab, one column per owner. Built entirely in code from the already-built M-1 sheet:
 *   • The "Total" column is LIVE — each line references the M-1 cell it comes from
 *     ('Book to Tax (M-1)'!B{n}), so editing the reconciliation reflows every K-1.
 *   • Each owner column is Total × that owner's percentage, where the percentage itself
 *     is an editable cell — change 60/40 to 50/50 and the whole allocation recomputes.
 *   • A live check row confirms the owner columns re-add to the total.
 *
 * Owner list comes from the model (extracted from prior K-1s / returns). When there is no
 * reliable evidence the sheet falls back to a single 100% owner, clearly flagged — the
 * preparer edits the percentages, never the math.
 */

const { round2, num } = (() => {
  const num = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const neg = /^\(.*\)$/.test(String(v || "").trim());
    const x = Number(String(v == null ? "" : v).replace(/[(),$%\s]/g, ""));
    if (!Number.isFinite(x)) return 0;
    return neg ? -Math.abs(x) : x;
  };
  const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
  return { round2, num };
})();

// K-1 box references differ by entity; labels of the (pinned) canonical separately
// stated list are matched by domain regex.
const BOX_MAP = [
  { re: /interest income/i,               box1065: "Line 5",  box1120s: "Line 4" },
  { re: /dividend/i,                      box1065: "Line 6a", box1120s: "Line 5a" },
  { re: /1231/i,                          box1065: "Line 10", box1120s: "Line 9" },
  { re: /charit/i,                        box1065: "Line 13A", box1120s: "Line 12A" },
  { re: /nondeductible/i,                 box1065: "Line 18C", box1120s: "Line 16C" },
  { re: /distribut/i,                     box1065: "Line 19A", box1120s: "Line 16D" },
  { re: /health|sehi/i,                   box1065: "Line 13M", box1120s: "W-2 / Line 17AD" },
  { re: /foreign tax/i,                   box1065: "Sch K-3", box1120s: "Sch K-3" },
  { re: /credit card|nontaxable income/i, box1065: "Line 18B", box1120s: "Line 16B" },
];
function boxFor(label, entityType) {
  const is1065 = /1065/.test(String(entityType));
  const hit = BOX_MAP.find((m) => m.re.test(String(label || "")));
  if (!hit) return "";
  return is1065 ? hit.box1065 : hit.box1120s;
}

function colLetter(n) {
  let name = "", x = n;
  while (x > 0) { name = String.fromCharCode(65 + (x - 1) % 26) + name; x = Math.floor((x - 1) / 26); }
  return name;
}

function normalizeOwners(owners) {
  const list = (Array.isArray(owners) ? owners : [])
    .map((o) => ({ name: String(o?.name || "").trim(), pct: round2(num(o?.ownershipPct ?? o?.pct)) }))
    .filter((o) => o.name && o.pct > 0 && o.pct <= 100);
  const total = round2(list.reduce((s, o) => s + o.pct, 0));
  if (list.length && Math.abs(total - 100) <= 0.5) return { owners: list, assumed: false };
  // No usable evidence → single-owner fallback, loudly flagged for the preparer.
  return { owners: [{ name: "Owner 1 (VERIFY ownership %)", pct: 100 }], assumed: true };
}

/**
 * buildK1Sheet(m1Sheet, ownersInput, entityType) -> { name, rows } | null
 * m1Sheet must be the sheet produced by buildM1Sheet (fixed shape). Returns null for
 * entities without K-1s or when the M-1 shape can't be located (never guesses).
 */
function buildK1Sheet(m1Sheet, ownersInput, entityType) {
  const is1065 = /1065/.test(String(entityType));
  const is1120s = /1120[\s-]?s/i.test(String(entityType));
  if (!is1065 && !is1120s) return null;
  if (!m1Sheet || !Array.isArray(m1Sheet.rows)) return null;

  const m1Rows = m1Sheet.rows;
  const ordIdx = m1Rows.findIndex((r) => /^ordinary business income/i.test(String((r || [])[0] || "")));
  if (ordIdx < 0) return null;
  const sepHeaderIdx = m1Rows.findIndex((r) => /^separately stated items/i.test(String((r || [])[0] || "")));
  const sepItems = [];
  if (sepHeaderIdx >= 0) {
    for (let r = sepHeaderIdx + 1; r < m1Rows.length; r++) {
      const label = String((m1Rows[r] || [])[0] || "").trim();
      if (!label) break;
      sepItems.push({ label, m1Row: r + 1 });
    }
  }

  const { owners, assumed } = normalizeOwners(ownersInput);
  const m1Ref = `'${String(m1Sheet.name).replace(/'/g, "''")}'`;
  const cellVal = (row) => { const v = (m1Rows[row - 1] || [])[1]; return round2(v && typeof v === "object" ? num(v.value) : num(v)); };

  const rows = [];
  rows.push([`SCHEDULE K-1 ALLOCATION — ${is1065 ? "Form 1065 (partners)" : "Form 1120-S (shareholders)"}`]);
  rows.push([assumed
    ? "⚠ NEEDS REVIEW: ownership was NOT documented in the uploads — a single 100% owner is assumed. Edit the % row below and every K-1 recomputes."
    : "Percentages come from the uploaded documents — edit the % row below and every K-1 recomputes."]);

  // Header: K-1 Box | Item | Total | one column per owner. Total is column C (index 2).
  rows.push(["K-1 Box", "Item", "Total", ...owners.map((o) => o.name)]);
  const headerRowNumber = rows.length; // 1-based row of the header

  // Ownership % row — editable driver cells for every owner column.
  const pctRowNumber = headerRowNumber + 1;
  rows.push(["", "Ownership %", { formula: `SUM(D${pctRowNumber}:${colLetter(3 + owners.length)}${pctRowNumber})`, value: 100 },
    ...owners.map((o) => o.pct)]);

  const lineRows = [];
  let totalsSum = 0;
  const pushLine = (box, label, m1Row) => {
    const rowNumber = rows.length + 1;
    const lineValue = cellVal(m1Row);
    totalsSum = round2(totalsSum + lineValue);
    const total = { formula: `${m1Ref}!B${m1Row}`, value: lineValue };
    const ownerCells = owners.map((o, i) => {
      const ownerCol = colLetter(4 + i);
      return { formula: `$C${rowNumber}*${ownerCol}$${pctRowNumber}/100`, value: round2(lineValue * o.pct / 100) };
    });
    rows.push([box, label, total, ...ownerCells]);
    lineRows.push(rowNumber);
  };

  pushLine("Line 1", "Ordinary business income (loss)", ordIdx + 1);
  for (const item of sepItems) pushLine(boxFor(item.label, entityType), item.label, item.m1Row);

  // Live re-add check: sum of every owner column must equal the Total column.
  const first = lineRows[0];
  const last = lineRows[lineRows.length - 1];
  rows.push(["", "Check: owners re-add to totals", { formula: `SUM(C${first}:C${last})`, value: totalsSum },
    ...owners.map((o, i) => {
      const col = colLetter(4 + i);
      return { formula: `SUM(${col}${first}:${col}${last})`, value: round2(totalsSum * o.pct / 100) };
    })]);

  rows.push([""]);
  rows.push(["", is1065
    ? "Each column feeds that partner's Schedule K-1; the partner reports it on their Form 1040 (Schedule E Part II)."
    : "Each column feeds that shareholder's Schedule K-1; the shareholder reports it on their Form 1040 (Schedule E Part II)."]);

  return { name: "Schedule K-1 Allocation", rows };
}

module.exports = { buildK1Sheet, normalizeOwners, boxFor };
