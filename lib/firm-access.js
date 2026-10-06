"use strict";

/**
 * firm-access.js — which sections of the app a firm may use.
 *
 * The owners of the app decide, per firm, which sections its people get: one firm buys
 * Review and Tax Planning and sees only those. The limit belongs to the firm, not to each
 * user, so a user the firm admin creates later has it from the first login without anyone
 * copying anything. A firm with no entry keeps every section, as before this existed, and the
 * owners' own firm and the global admins are never limited.
 *
 * Hiding a button is not a limit: every route that does a section's work is refused on the
 * server too. Routes several sections share (clients, sessions, library, sign-in, the firm
 * admin's own panels) are not listed here and stay open.
 */

/** The sections, with the ids the page already uses for its workspace modes. */
const SECTIONS = [
  { id: "preparation", label: "Preparation", group: "Return Workflow" },
  { id: "review", label: "Review", group: "Return Workflow" },
  { id: "deliverable", label: "Deliverable", group: "Return Workflow" },
  { id: "estimated", label: "Estimated Taxes", group: "Planning Tools" },
  { id: "planning", label: "Tax Planning", group: "Planning Tools" },
  { id: "tracker", label: "Tracker", group: "Tax Tools" },
  { id: "research", label: "Tax Research", group: "Tax Tools" },
  { id: "notices", label: "Notices", group: "Tax Tools" },
  { id: "diagnostics", label: "Diagnostics", group: "Tax Tools" },
  { id: "organizer", label: "Database", group: "Tax Tools" },
  { id: "presentations", label: "Client Presentations", group: "Tax Tools" },
  { id: "calculations", label: "Misc Calculations", group: "Tax Tools" },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);

/**
 * The routes that do each section's work. First match wins; "exact" is the path itself,
 * "prefix" the path and everything under it. A null section marks a path that looks like a
 * section's but is read by every page at start-up; a list is a route several sections use,
 * open to a firm that has any of them.
 */
const ROUTE_RULES = [
  ["exact", "/api/deliverable/gmail-status", null],
  // Sending through Gmail: the Deliverable, the Estimated Taxes email and Client Requests.
  ["exact", "/api/deliverable/send-gmail", ["deliverable", "estimated", "organizer"]],
  ["prefix", "/api/review", "review"],
  ["exact", "/api/prepare-workpaper", "preparation"],
  ["prefix", "/api/preparation", "preparation"],
  ["prefix", "/api/deliverable", "deliverable"],
  // Client Requests is a tab of the Database section.
  ["prefix", "/api/requests", "organizer"],
  ["prefix", "/api/estimated-taxes", "estimated"],
  ["prefix", "/api/extension", "estimated"],
  ["prefix", "/api/planning", "planning"],
  ["prefix", "/api/tracker", "tracker"],
  ["prefix", "/api/pto", "tracker"],
  ["prefix", "/api/research", "research"],
  ["prefix", "/api/notices", "notices"],
  ["prefix", "/api/diagnostics", "diagnostics"],
  ["prefix", "/api/organizer", "organizer"],
  ["prefix", "/api/presentations", "presentations"],
  ["prefix", "/api/calculations", "calculations"],
];

/** The sections whose work a request is, or null when every firm may call the route. */
function sectionsForRoute(pathname) {
  const path = String(pathname || "").split("?")[0];
  for (const [kind, route, section] of ROUTE_RULES) {
    if (path === route || (kind === "prefix" && path.startsWith(`${route}/`))) return section ? [].concat(section) : null;
  }
  return null;
}

/** The section a request belongs to (the first, when several use the route), or null. */
function sectionForRoute(pathname) {
  const sections = sectionsForRoute(pathname);
  return sections ? sections[0] : null;
}

/** A list of sections as stored: known ids only, once each, in the app's own order. */
function normalizeSections(value) {
  const wanted = new Set((Array.isArray(value) ? value : []).map((v) => String(v || "").trim().toLowerCase()));
  return SECTION_IDS.filter((id) => wanted.has(id));
}

/** How a firm is keyed in the store: its id without regard to case or stray spaces. */
function firmKey(tenantId) {
  return String(tenantId || "").trim().toLowerCase();
}

/**
 * The sections a user may use: null means all of them.
 * store: { firms: { [firmKey]: { sections: [...] } } }
 */
function allowedSections(store, user, defaultTenantId) {
  if (!user || user.role === "admin") return null;
  const tenantId = firmKey(user.tenantId || defaultTenantId);
  if (!tenantId || tenantId === firmKey(defaultTenantId)) return null;
  const entry = store && store.firms && store.firms[tenantId];
  const sections = entry ? normalizeSections(entry.sections) : [];
  return sections.length ? sections : null;
}

/** Whether this user's firm may call this route. */
function routeAllowed(store, user, pathname, defaultTenantId) {
  const sections = sectionsForRoute(pathname);
  if (!sections) return true;
  const allowed = allowedSections(store, user, defaultTenantId);
  return !allowed || sections.some((section) => allowed.includes(section));
}

/** Sets or clears a firm's limit. An empty or missing list clears it: no firm is left with nothing. */
function setFirmSections(store, tenantId, sections, { by = "", at = new Date() } = {}) {
  const out = store && typeof store === "object" ? store : {};
  if (!out.firms || typeof out.firms !== "object") out.firms = {};
  const id = firmKey(tenantId);
  if (!id) return out;
  const list = normalizeSections(sections);
  if (!list.length || list.length === SECTION_IDS.length) delete out.firms[id];
  else out.firms[id] = { sections: list, updatedAt: (at instanceof Date ? at : new Date(at)).toISOString(), updatedBy: String(by || "") };
  return out;
}

module.exports = { SECTIONS, SECTION_IDS, firmKey, sectionForRoute, sectionsForRoute, normalizeSections, allowedSections, routeAllowed, setFirmSections };
