"use strict";
// Que secciones de la app puede usar cada firma (lib/firm-access.js). El limite es de la firma:
// lo fijan los dueños de la app y vale para todos sus usuarios, tambien los que el firm_admin
// cree despues. Firmas y usuarios ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { SECTIONS, SECTION_IDS, sectionForRoute, sectionsForRoute, normalizeSections, allowedSections, routeAllowed, setFirmSections } = require("../lib/firm-access");

const OWNERS = "owners";
const store = () => setFirmSections({}, "firm-a", ["planning", "review"], { by: "owner", at: new Date(0) });
const boss = { username: "boss", role: "firm_admin", tenantId: "firm-a" };
const ana = { username: "ana", role: "user", tenantId: "firm-a" };

test("las doce secciones, con los ids que ya usa la pagina", () => {
  assert.strictEqual(SECTIONS.length, 12);
  assert.deepStrictEqual(SECTION_IDS.slice(0, 5), ["preparation", "review", "deliverable", "estimated", "planning"]);
});

test("cada ruta de trabajo pertenece a su seccion; las compartidas a ninguna", () => {
  assert.strictEqual(sectionForRoute("/api/review"), "review");
  assert.strictEqual(sectionForRoute("/api/review/respond"), "review");
  assert.strictEqual(sectionForRoute("/api/prepare-workpaper"), "preparation");
  assert.strictEqual(sectionForRoute("/api/preparation/data-entry-guide"), "preparation");
  assert.strictEqual(sectionForRoute("/api/planning/saved/abc?x=1"), "planning");
  assert.strictEqual(sectionForRoute("/api/extension/calculate"), "estimated");
  assert.strictEqual(sectionForRoute("/api/pto"), "tracker");
  assert.strictEqual(sectionForRoute("/api/requests/generate-email"), "organizer", "Client Requests es una pestaña de Database");
  for (const shared of ["/api/clients", "/api/sessions/1", "/api/config", "/api/library", "/api/auth/status", "/api/admin/users", "/api/firm-drive", "/api/usage/summary", "/api/deliverable/gmail-status", "/api/reviews-other"]) {
    assert.strictEqual(sectionForRoute(shared), null, shared);
  }
});

test("una ruta que usan varias secciones se abre con cualquiera de ellas", () => {
  // El envio por Gmail lo usan Deliverable, el mail de Estimated Taxes y Client Requests.
  assert.deepStrictEqual(sectionsForRoute("/api/deliverable/send-gmail"), ["deliverable", "estimated", "organizer"]);
  const only = (section) => setFirmSections({}, "firm-a", [section]);
  for (const section of ["deliverable", "estimated", "organizer"]) {
    assert.strictEqual(routeAllowed(only(section), ana, "/api/deliverable/send-gmail", OWNERS), true, section);
  }
  assert.strictEqual(routeAllowed(only("review"), ana, "/api/deliverable/send-gmail", OWNERS), false);
  assert.strictEqual(routeAllowed(only("estimated"), ana, "/api/deliverable/generate-draft", OWNERS), false, "el resto de Deliverable sigue cerrado");
  assert.strictEqual(routeAllowed(only("organizer"), ana, "/api/requests/generate-email", OWNERS), true);
  assert.strictEqual(routeAllowed(only("deliverable"), ana, "/api/requests/generate-email", OWNERS), false);
  assert.strictEqual(sectionsForRoute("/api/clients"), null);
});

test("toda ruta que gasta IA pertenece a alguna seccion", () => {
  // Si alguien agrega una accion con IA y no la asigna, una firma limitada podria usarla igual.
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const body = server.slice(server.indexOf("function isTokenConsumingRoute("));
  const routes = body.slice(0, body.indexOf("].includes(pathName)")).match(/"\/api\/[^"]+"/g).map((r) => r.slice(1, -1));
  assert.ok(routes.length >= 20, `${routes.length} rutas leidas`);
  for (const route of routes) assert.ok(sectionsForRoute(route), `${route} no tiene seccion`);
});

test("la firma limitada usa solo sus secciones, el firm_admin y sus usuarios por igual", () => {
  for (const user of [boss, ana, { username: "nuevo", role: "user", tenantId: "firm-a" }]) {
    assert.deepStrictEqual(allowedSections(store(), user, OWNERS), ["review", "planning"], "en el orden de la app");
    assert.strictEqual(routeAllowed(store(), user, "/api/review", OWNERS), true);
    assert.strictEqual(routeAllowed(store(), user, "/api/planning/analyze", OWNERS), true);
    assert.strictEqual(routeAllowed(store(), user, "/api/prepare-workpaper", OWNERS), false);
    assert.strictEqual(routeAllowed(store(), user, "/api/research/chat", OWNERS), false);
    assert.strictEqual(routeAllowed(store(), user, "/api/clients", OWNERS), true, "lo compartido sigue abierto");
  }
});

test("el limite alcanza a la firma aunque su id este escrito con otras mayusculas", () => {
  for (const tenantId of ["Firm-A", "FIRM-A", " firm-a "]) {
    assert.deepStrictEqual(allowedSections(store(), { role: "user", tenantId }, OWNERS), ["review", "planning"], tenantId);
    assert.strictEqual(routeAllowed(store(), { role: "user", tenantId }, "/api/prepare-workpaper", OWNERS), false, tenantId);
  }
  assert.strictEqual(allowedSections(setFirmSections(store(), "Owners", ["review"]), { role: "user", tenantId: "OWNERS" }, "owners"), null, "la de los dueños tampoco asi");
});

test("sin limite cargado, la firma de los dueños y los admin globales ven todo", () => {
  assert.strictEqual(allowedSections(store(), { role: "user", tenantId: "firm-b" }, OWNERS), null);
  assert.strictEqual(allowedSections(store(), { role: "user", tenantId: OWNERS }, OWNERS), null);
  assert.strictEqual(allowedSections(setFirmSections(store(), OWNERS, ["review"]), { role: "user", tenantId: OWNERS }, OWNERS), null, "aunque alguien le cargue uno");
  assert.strictEqual(allowedSections(store(), { role: "admin", tenantId: "firm-a" }, OWNERS), null);
  assert.strictEqual(routeAllowed(store(), { role: "user", tenantId: "firm-b" }, "/api/prepare-workpaper", OWNERS), true);
});

test("guardar: solo ids conocidos; vacio o todas las secciones quita el limite", () => {
  assert.deepStrictEqual(normalizeSections(["Review", "review", "nada", "planning"]), ["review", "planning"]);
  const s = store();
  assert.deepStrictEqual(s.firms["firm-a"], { sections: ["review", "planning"], updatedAt: "1970-01-01T00:00:00.000Z", updatedBy: "owner" });
  assert.strictEqual(setFirmSections(store(), "firm-a", []).firms["firm-a"], undefined, "ninguna firma queda sin nada");
  assert.strictEqual(setFirmSections(store(), "firm-a", SECTION_IDS).firms["firm-a"], undefined);
  assert.strictEqual(setFirmSections(store(), "Firm-A ", ["tracker"]).firms["firm-a"].sections[0], "tracker", "el id de firma se normaliza");
});
