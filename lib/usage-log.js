"use strict";

/**
 * usage-log.js — cuantas veces se uso cada tab, por usuario y por mes. Sin costos.
 *
 * Por que existe: el administrador de una firma (firm_admin) quiere saber cuantas revisiones
 * llevan hechas sus usuarios y cuanto se usa cada tab. El registro de costos no sirve para eso:
 * una revision deja varias filas (dos pasadas, la estructuracion), una planificacion otras, y
 * ademas tiene la plata, que solo ven los dueños de la app.
 *
 * Aca se cuenta UNA vez cada accion principal — el boton que la dispara — en contadores
 * mensuales por firma, usuario, tab y accion. Contadores y no eventos: el archivo queda chico
 * aunque pasen años, y alcanza para "este mes", "el mes pasado", "este año" y "todo".
 */

/** La accion principal de cada tab: un POST a esta ruta es un uso. */
const USAGE_ACTIONS = {
  "/api/prepare-workpaper": ["Preparation", "Generate workpaper"],
  "/api/preparation/data-entry-guide": ["Preparation", "Data entry guide"],
  "/api/review": ["Review", "Run review"],
  "/api/review/respond": ["Review", "Reply to review"],
  "/api/deliverable/generate-draft": ["Deliverable", "Generate draft"],
  "/api/deliverable/email-draft": ["Deliverable", "Email draft"],
  "/api/requests/generate-email": ["Deliverable", "Request email"],
  "/api/estimated-taxes/calculate": ["Estimated Taxes", "Calculate estimate"],
  "/api/extension/calculate": ["Estimated Taxes", "Calculate extension"],
  "/api/planning/analyze": ["Tax Planning", "Analyze documents"],
  "/api/planning/scenario": ["Tax Planning", "Custom scenario"],
  "/api/research/chat": ["Tax Research", "Question"],
  "/api/notices": ["Notices", "Analyze notice"],
  "/api/diagnostics": ["Diagnostics", "Run diagnostics"],
  "/api/organizer": ["Database", "Build organizer"],
  "/api/presentations/generate": ["Client Presentations", "Generate presentation"],
  "/api/calculations/run": ["Misc Calculations", "Run calculation"],
};

/** El orden de las tabs en la barra de la app. */
const TAB_ORDER = [
  "Preparation", "Review", "Deliverable", "Estimated Taxes", "Tax Planning", "Tax Research",
  "Notices", "Diagnostics", "Database", "Client Presentations", "Misc Calculations",
];

const PERIODS = { month: "This month", last_month: "Last month", year: "This year", all: "All time" };

function usageActionFor(method, pathname) {
  if (String(method || "").toUpperCase() !== "POST") return null;
  const hit = USAGE_ACTIONS[String(pathname || "")];
  return hit ? { tab: hit[0], action: hit[1] } : null;
}

function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Suma un uso. Modifica y devuelve el almacen: { months: { "2026-10": { firma: { usuario: { "Tab|Accion": n } } } } }. */
function addUsage(store, { at = new Date(), tenantId, username, tab, action }) {
  const out = store && typeof store === "object" ? store : {};
  if (!out.months || typeof out.months !== "object") out.months = {};
  const month = monthKey(at);
  const firm = String(tenantId || "default");
  const user = String(username || "unknown");
  const key = `${tab}|${action}`;
  out.months[month] = out.months[month] || {};
  out.months[month][firm] = out.months[month][firm] || {};
  out.months[month][firm][user] = out.months[month][firm][user] || {};
  out.months[month][firm][user][key] = (Number(out.months[month][firm][user][key]) || 0) + 1;
  return out;
}

/** Los meses que entran en el periodo pedido. */
function monthsFor(period, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  if (period === "last_month") return (key) => key === monthKey(new Date(Date.UTC(year, month - 1, 1)));
  if (period === "year") return (key) => key.startsWith(`${year}-`);
  if (period === "all") return () => true;
  return (key) => key === monthKey(now);
}

/**
 * El resumen que ve el administrador de la firma: total, por tab (con sus acciones) y por
 * usuario. `tenantId` null es todas las firmas (lo usa solo un administrador global). Los
 * usuarios de la firma que no usaron nada igual aparecen, con cero: tambien eso es un dato.
 */
function summarizeUsage(store, { tenantId = null, period = "month", now = new Date(), users = [] } = {}) {
  const key = PERIODS[period] ? period : "month";
  const inPeriod = monthsFor(key, now);
  const byUser = new Map();
  const byTab = new Map();
  const people = (Array.isArray(users) ? users : []).filter((u) => u && u.username && (!tenantId || String(u.tenantId || "") === String(tenantId)));
  for (const u of people) byUser.set(u.username, { username: u.username, displayName: u.displayName || u.username, total: 0, byTab: {} });

  for (const [month, firms] of Object.entries((store && store.months) || {})) {
    if (!inPeriod(month)) continue;
    for (const [firm, usersInFirm] of Object.entries(firms || {})) {
      if (tenantId && firm !== String(tenantId)) continue;
      for (const [username, counts] of Object.entries(usersInFirm || {})) {
        if (!byUser.has(username)) byUser.set(username, { username, displayName: username, total: 0, byTab: {} });
        const row = byUser.get(username);
        for (const [tabAction, value] of Object.entries(counts || {})) {
          const n = Number(value) || 0;
          if (!n) continue;
          const [tab, action] = tabAction.split("|");
          row.total += n;
          row.byTab[tab] = (row.byTab[tab] || 0) + n;
          if (!byTab.has(tab)) byTab.set(tab, { tab, count: 0, actions: new Map() });
          const t = byTab.get(tab);
          t.count += n;
          t.actions.set(action, (t.actions.get(action) || 0) + n);
        }
      }
    }
  }

  const rank = (tab) => { const i = TAB_ORDER.indexOf(tab); return i === -1 ? TAB_ORDER.length : i; };
  const tabs = [...byTab.values()]
    .sort((a, b) => rank(a.tab) - rank(b.tab) || a.tab.localeCompare(b.tab))
    .map((t) => ({ tab: t.tab, count: t.count, actions: [...t.actions.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count) }));
  const usersOut = [...byUser.values()].sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName));
  return {
    period: { key, label: PERIODS[key] },
    total: tabs.reduce((sum, t) => sum + t.count, 0),
    tabs,
    users: usersOut,
  };
}

module.exports = { USAGE_ACTIONS, TAB_ORDER, PERIODS, usageActionFor, addUsage, summarizeUsage, monthKey };
