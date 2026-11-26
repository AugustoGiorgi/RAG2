"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function fixture(initial = {}) {
  const remote = { enabled: true, connected: false, connectionId: "", ...initial };
  const intervals = new Map(), listeners = new Map(), opened = [], toasts = [];
  let now = 0, timerId = 0, nextResponse = null;
  const window = {
    open(url, name, features) {
      const popup = { url, name, features, closed: false, focus() {}, close() { this.closed = true; } };
      opened.push(popup);
      return popup;
    },
    addEventListener(name, handler) { listeners.set(name, handler); },
  };
  const context = vm.createContext({
    window, crypto: { randomUUID: () => crypto.randomUUID() },
    document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
    location: { origin: "https://rag.example" }, API_BASE_URL: "",
    renderGmailStatus() {}, showToast: (message, kind) => toasts.push({ message, kind }),
    Date: { now: () => now },
    setInterval(handler) { const id = ++timerId; intervals.set(id, handler); return id; },
    clearInterval(id) { intervals.delete(id); },
    fetch: async () => {
      const once = nextResponse; nextResponse = null;
      const data = once ? await once() : { ...remote };
      return { ok: true, json: async () => data };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../microsoft.js"), "utf8"), context);
  return {
    client: window.MicrosoftConnection, remote, opened, toasts,
    get popup() { return opened.at(-1); },
    get attempt() { return new URL(opened.at(-1).url, "https://rag.example").searchParams.get("attempt"); },
    tick: async () => { for (const handler of [...intervals.values()]) await handler(); },
    advance: ms => { now += ms; }, once: response => { nextResponse = response; },
    message: event => listeners.get("message")(event),
  };
}

test("a severed opener or apparently closed popup does not lose a successful connection", async () => {
  const f = fixture(); await f.client.refresh();
  let completed = 0;
  f.client.connect("drive", () => { completed++; });
  assert.match(f.attempt, /^[a-f0-9-]{36}$/);
  f.popup.closed = true;
  await f.tick();
  assert.equal(completed, 0);
  Object.assign(f.remote, { connected: true, connectionId: f.attempt, driveAuthorized: true, email: "test@outlook.com" });
  await f.tick(); await f.tick();
  assert.equal(completed, 1);
  assert.match(f.toasts.at(-1).message, /Microsoft connected/);
});

test("existing grants or another attempt cannot complete the pending authorization", async () => {
  const f = fixture({ connected: true, driveAuthorized: true, connectionId: crypto.randomUUID() });
  await f.client.refresh(); let completed = 0;
  f.client.connect("drive", () => { completed++; });
  await f.tick(); assert.equal(completed, 0);
  Object.assign(f.remote, { connectionId: f.attempt, driveAuthorized: false });
  await f.tick(); assert.equal(completed, 0);
  f.remote.driveAuthorized = true;
  await f.tick(); assert.equal(completed, 1);
});

test("a late result from a replaced connection cannot finish the newer connection", async () => {
  const f = fixture(); await f.client.refresh();
  let oldCompleted = 0, newCompleted = 0, resolve;
  f.client.connect("drive", () => { oldCompleted++; });
  const oldAttempt = f.attempt;
  f.popup.closed = true;
  f.once(() => new Promise(done => { resolve = done; }));
  const oldTick = f.tick();
  f.client.connect("drive", () => { newCompleted++; });
  const newAttempt = f.attempt;
  assert.notEqual(newAttempt, oldAttempt);
  resolve({ connected: true, driveAuthorized: true, connectionId: oldAttempt });
  await oldTick;
  assert.equal(oldCompleted, 0); assert.equal(newCompleted, 0);
  Object.assign(f.remote, { connected: true, driveAuthorized: true, connectionId: newAttempt });
  await f.tick();
  assert.equal(oldCompleted, 0); assert.equal(newCompleted, 1);
});

test("postMessage still checks origin, source and the authenticated attempt", async () => {
  const f = fixture(); await f.client.refresh(); let completed = 0;
  f.client.connect("mail", () => { completed++; });
  const data = { type: "microsoft_connected" };
  f.message({ origin: "https://evil.example", source: f.popup, data });
  f.message({ origin: "https://rag.example", source: {}, data });
  await f.tick(); assert.equal(completed, 0);
  Object.assign(f.remote, { connected: true, mailAuthorized: true, connectionId: f.attempt });
  f.message({ origin: "https://rag.example", source: f.popup, data });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, 1);
});

test("missing authorization times out without sending or resuming the action", async () => {
  const f = fixture(); await f.client.refresh(); let completed = 0;
  f.client.connect("mail", () => { completed++; });
  f.advance(600001); await f.tick(); await f.tick();
  assert.equal(completed, 0);
  assert.match(f.toasts.at(-1).message, /timed out/);
});
