"use strict";
// La sesion sin terminar se ofrecia con un window.confirm en cada carga. "Cancelar" solo salteaba
// la recuperacion y dejaba la sesion como actual, asi que la pregunta volvia en cada recarga y
// tapaba la pantalla. Ahora es una barra que no bloquea: "Resume" la reabre y "Start over" la
// olvida en este navegador (la sesion sigue guardada), y no vuelve. Codigo real de app.js.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");
const grab = (name) => {
  const start = app.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no encontre ${name}`);
  return app.slice(start, app.indexOf("\n}\n", start) + 2);
};

// Un DOM minimo: lo justo para crear la barra y apretar sus botones.
function fakeDom() {
  const byId = new Map();
  const make = (tag) => {
    const el = { tag, children: [], listeners: {}, attrs: {}, textContent: "", className: "", type: "", id: "",
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      append(...kids) { this.children.push(...kids); },
      remove() { byId.delete(this.id); document.body.children = document.body.children.filter((child) => child !== this); } };
    return el;
  };
  const document = {
    body: { children: [], append(el) { this.children.push(el); if (el.id) byId.set(el.id, el); } },
    createElement: make,
    getElementById: (id) => byId.get(id) || null,
  };
  return document;
}

function setup() {
  const document = fakeDom();
  const storage = new Map([["taxapp_current_session_id", "session-1"]]);
  const localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
  const calls = { opened: [], toasts: [], confirms: 0 };
  const state = { currentSessionId: "session-1" };
  // eslint-disable-next-line no-new-func
  const api = new Function("document", "localStorage", "state", "calls", "window", `
    let dashboardSessions = [{ id: "session-1", client: { name: "Sample Client LLC" }, returnType: "1120-S", taxYear: "2025", status: "in_progress" }];
    const openSavedSession = async (id) => { calls.opened.push(id); };
    const showToast = (message) => { calls.toasts.push(message); };
    let currentSessionId = state.currentSessionId;
    ${grab("checkRestoreSession")}
    ${grab("showSessionRestoreBar")}
    return { checkRestoreSession, current: () => currentSessionId };
  `)(document, localStorage, state, calls, { confirm: () => { calls.confirms += 1; return false; } });
  return { document, storage, calls, api };
}

test("ya no usa window.confirm: es una barra con Resume y Start over", async () => {
  assert.doesNotMatch(grab("checkRestoreSession"), /confirm\(/);
  const { document, calls, api } = setup();
  await api.checkRestoreSession();
  const bar = document.getElementById("sessionRestoreBar");
  assert.ok(bar, "aparece la barra");
  assert.strictEqual(calls.confirms, 0);
  assert.strictEqual(bar.children[0].textContent, "Unfinished session: Sample Client LLC - 1120-S 2025");
  assert.deepStrictEqual(bar.children.slice(1).map((button) => button.textContent), ["Resume", "Start over"]);
});

test("Start over olvida la sesion en este navegador y la barra no vuelve", async () => {
  const { document, storage, calls, api } = setup();
  await api.checkRestoreSession();
  document.getElementById("sessionRestoreBar").children[2].listeners.click();
  assert.strictEqual(document.getElementById("sessionRestoreBar"), null);
  assert.strictEqual(storage.has("taxapp_current_session_id"), false);
  assert.strictEqual(api.current(), "");
  assert.match(calls.toasts[0], /saved session stays in the dashboard/);
  await api.checkRestoreSession();
  assert.strictEqual(document.getElementById("sessionRestoreBar"), null, "sin sesion actual no hay nada que ofrecer");
});

test("Resume reabre la sesion", async () => {
  const { document, calls, api } = setup();
  await api.checkRestoreSession();
  await document.getElementById("sessionRestoreBar").children[1].listeners.click();
  assert.deepStrictEqual(calls.opened, ["session-1"]);
  assert.strictEqual(document.getElementById("sessionRestoreBar"), null);
});
