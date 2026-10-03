"use strict";
// El uso por tab que ve el administrador de una firma (lib/usage-log.js): una cuenta por cada
// accion principal, por mes, firma, usuario y tab. Nunca costos. Usuarios y firmas ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const { usageActionFor, addUsage, summarizeUsage, TAB_ORDER } = require("../lib/usage-log");

const OCT = new Date(Date.UTC(2026, 9, 15));
const SEP = new Date(Date.UTC(2026, 8, 10));
const JAN = new Date(Date.UTC(2026, 0, 5));
const LAST_YEAR = new Date(Date.UTC(2025, 11, 20));

function sample() {
  const store = { months: {} };
  const add = (at, tenantId, username, path) => addUsage(store, { at, tenantId, username, ...usageActionFor("POST", path) });
  add(OCT, "firm-a", "ana", "/api/review");
  add(OCT, "firm-a", "ana", "/api/review");
  add(OCT, "firm-a", "ben", "/api/prepare-workpaper");
  add(OCT, "firm-a", "ben", "/api/review");
  add(SEP, "firm-a", "ana", "/api/planning/analyze");
  add(JAN, "firm-a", "ben", "/api/review");
  add(LAST_YEAR, "firm-a", "ana", "/api/review");
  add(OCT, "firm-b", "zoe", "/api/review");
  return store;
}
const users = [
  { username: "ana", displayName: "Ana A", tenantId: "firm-a" },
  { username: "ben", displayName: "Ben B", tenantId: "firm-a" },
  { username: "cam", displayName: "Cam C", tenantId: "firm-a" },
  { username: "zoe", displayName: "Zoe Z", tenantId: "firm-b" },
];

test("solo las acciones principales cuentan, y solo por POST", () => {
  assert.deepStrictEqual(usageActionFor("POST", "/api/review"), { tab: "Review", action: "Run review" });
  assert.deepStrictEqual(usageActionFor("POST", "/api/prepare-workpaper"), { tab: "Preparation", action: "Generate workpaper" });
  assert.strictEqual(usageActionFor("GET", "/api/review"), null);
  assert.strictEqual(usageActionFor("POST", "/api/planning/opportunities"), null, "un paso interno no es otro uso");
  assert.strictEqual(usageActionFor("POST", "/api/cost/log"), null);
});

test("el mes de la firma: por tab, por accion y por persona, incluidos los que no usaron nada", () => {
  const s = summarizeUsage(sample(), { tenantId: "firm-a", period: "month", now: OCT, users });
  assert.strictEqual(s.total, 4);
  assert.deepStrictEqual(s.tabs.map((t) => [t.tab, t.count]), [["Preparation", 1], ["Review", 3]], "en el orden de la barra de tabs");
  assert.deepStrictEqual(s.tabs[1].actions, [{ action: "Run review", count: 3 }]);
  assert.deepStrictEqual(s.users.map((u) => [u.username, u.total]), [["ana", 2], ["ben", 2], ["cam", 0]]);
  assert.deepStrictEqual(s.users[1].byTab, { Preparation: 1, Review: 1 });
});

test("una firma nunca ve el uso de otra", () => {
  const s = summarizeUsage(sample(), { tenantId: "firm-a", period: "all", now: OCT, users });
  assert.ok(!s.users.some((u) => u.username === "zoe"));
  const b = summarizeUsage(sample(), { tenantId: "firm-b", period: "month", now: OCT, users });
  assert.strictEqual(b.total, 1);
  assert.deepStrictEqual(b.users.map((u) => u.username), ["zoe"]);
});

test("los periodos: mes pasado, este año y todo", () => {
  const store = sample();
  assert.strictEqual(summarizeUsage(store, { tenantId: "firm-a", period: "last_month", now: OCT, users }).total, 1);
  assert.strictEqual(summarizeUsage(store, { tenantId: "firm-a", period: "year", now: OCT, users }).total, 6);
  assert.strictEqual(summarizeUsage(store, { tenantId: "firm-a", period: "all", now: OCT, users }).total, 7);
  assert.strictEqual(summarizeUsage(store, { tenantId: "firm-a", period: "cualquiera", now: OCT, users }).period.key, "month");
});

test("el resumen no tiene ningun dato de costo", () => {
  const text = JSON.stringify(summarizeUsage(sample(), { tenantId: null, period: "all", now: OCT, users }));
  assert.doesNotMatch(text, /cost|spend|usd|\$/i);
});

test("las tabs conocidas van en el orden de la app", () => {
  assert.strictEqual(TAB_ORDER[0], "Preparation");
  assert.strictEqual(TAB_ORDER[1], "Review");
});
