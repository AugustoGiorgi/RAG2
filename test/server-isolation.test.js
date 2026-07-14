"use strict";
// Boot REAL del server (DATA_DIR temporal) + aislamiento por firma end-to-end.
// Sin llamadas a Anthropic: solo auth, clients, sessions, tracker y deadlines.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PORT = 8231;
const BASE = `http://127.0.0.1:${PORT}`;

function hashPassword(pw) {
  const salt = crypto.randomBytes(12).toString("base64url");
  const hash = crypto.pbkdf2Sync(pw, salt, 210000, 32, "sha256").toString("base64url");
  return `pbkdf2$210000$${salt}$${hash}`;
}

let child = null;
let dataDir = null;
const jars = {}; // usuario -> cookie

async function login(username, password) {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.strictEqual(res.status, 200, `login ${username}`);
  jars[username] = (res.headers.get("set-cookie") || "").split(";")[0];
}

async function api(user, method, pathName, body) {
  const res = await fetch(`${BASE}${pathName}`, {
    method,
    headers: { "content-type": "application/json", cookie: jars[user] },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ragtax-test-"));
  fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify({
    users: [
      { username: "admin_t", passwordHash: hashPassword("AdminTest12345!"), role: "admin", displayName: "Admin", tenantId: "rag-tax-ai", active: true },
      { username: "ana_t", passwordHash: hashPassword("AnaTest12345678"), role: "user", displayName: "Ana", tenantId: "rag-tax-ai", active: true },
      { username: "pilot_t", passwordHash: hashPassword("PilotTest123456"), role: "user", displayName: "Pilot", tenantId: "otrafirma", active: true },
      { username: "boss_t", passwordHash: hashPassword("BossTest1234567"), role: "firm_admin", displayName: "Boss", tenantId: "otrafirma", active: true },
    ],
    budgetGroups: [],
  }));

  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), AUTH_SECRET: "test-secret-0123456789-0123456789-xx", DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bootLog = "";
  child.stdout.on("data", (d) => { bootLog += d; });
  child.stderr.on("data", (d) => { bootLog += d; });

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.status === 200) return;
    } catch (_) { /* aún no arrancó */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not boot in 20s. Log:\n${bootLog.slice(-2000)}`);
}, { timeout: 30000 });

after(() => {
  if (child) child.kill();
  try { if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
});

test("logins de las dos firmas", async () => {
  await login("admin_t", "AdminTest12345!");
  await login("ana_t", "AnaTest12345678");
  await login("pilot_t", "PilotTest123456");
});

test("sin sesión: la raíz sirve la landing pública y la API exige auth", async () => {
  const landing = await fetch(`${BASE}/`);
  assert.strictEqual(landing.status, 200);
  assert.match(await landing.text(), /RAG Tax AI/);
  const apiRes = await fetch(`${BASE}/api/clients`);
  assert.strictEqual(apiRes.status, 401);
});

test("admin crea cliente + sesión + tarea de tracker", async () => {
  const created = await api("admin_t", "POST", "/api/clients", { name: "Cliente Confidencial SRL", returnType: "1120-S" });
  const clientId = created.json.client?.id || created.json.id;
  assert.ok(clientId, JSON.stringify(created.json).slice(0, 200));
  await api("admin_t", "POST", "/api/sessions", { client: { name: "Cliente Confidencial SRL" }, clientId, returnType: "1120-S", taxYear: "2025", reviewStage: "Initial review" });
  await api("admin_t", "POST", "/api/tracker/tasks", { title: "Preparar 1120-S", clientName: "Cliente Confidencial SRL" });
});

test("FIRMA EXTERNA: ve absolutamente todo vacío", async () => {
  assert.strictEqual((await api("pilot_t", "GET", "/api/clients")).json.clients.length, 0);
  assert.strictEqual((await api("pilot_t", "GET", "/api/sessions")).json.sessions.length, 0);
  assert.strictEqual((await api("pilot_t", "GET", "/api/tracker")).json.tasks.length, 0);
  assert.strictEqual(((await api("pilot_t", "GET", "/api/deadlines")).json.upcoming || []).length, 0);
});

test("MISMA FIRMA: comparte los datos del equipo", async () => {
  assert.strictEqual((await api("ana_t", "GET", "/api/clients")).json.clients.length, 1);
  assert.ok((await api("ana_t", "GET", "/api/sessions")).json.sessions.length >= 1);
  assert.strictEqual((await api("ana_t", "GET", "/api/tracker")).json.tasks.length, 1);
});

test("salud: /api/admin/health responde a admin y rechaza a usuarios", async () => {
  const ok = await api("admin_t", "GET", "/api/admin/health");
  assert.strictEqual(ok.status, 200);
  assert.ok(ok.json.uptimeSeconds >= 0);
  assert.ok(Array.isArray(ok.json.incidents));
  assert.ok(ok.json.incidents.some((e) => e.type === "boot"), "el boot debe quedar registrado");
  const denied = await api("pilot_t", "GET", "/api/admin/health");
  assert.strictEqual(denied.status, 403);
});

test("firm_admin: gestiona SOLO su firma, sin poderes globales", async () => {
  await login("boss_t", "BossTest1234567");
  // Lista: solo usuarios de su firma (pilot_t y él mismo — nunca los de la firma default).
  const list = await api("boss_t", "GET", "/api/admin/users");
  assert.strictEqual(list.status, 200);
  const names = list.json.users.map((u) => u.username).sort();
  assert.deepStrictEqual(names, ["boss_t", "pilot_t"]);
  // Crea un usuario: cae en SU firma aunque intente otra, y nunca como admin.
  const created = await api("boss_t", "POST", "/api/admin/users", {
    username: "nuevo_t", password: "NuevoTest123456", role: "admin", tenantId: "rag-tax-ai",
  });
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.json.user.tenantId, "otrafirma");
  assert.strictEqual(created.json.user.role, "user");
  // No puede tocar usuarios de otra firma ni superficies globales.
  assert.strictEqual((await api("boss_t", "PUT", "/api/admin/users/ana_t", { active: false })).status, 403);
  assert.strictEqual((await api("boss_t", "GET", "/api/admin/health")).status, 403);
  assert.strictEqual((await api("boss_t", "GET", "/api/admin/budget-groups")).status, 403);
});

test("sin contaminación cruzada al crear en la otra firma", async () => {
  await api("pilot_t", "POST", "/api/clients", { name: "Cliente Del Piloto Inc", returnType: "1040" });
  assert.strictEqual((await api("pilot_t", "GET", "/api/clients")).json.clients.length, 1);
  assert.strictEqual((await api("ana_t", "GET", "/api/clients")).json.clients.length, 1);
  assert.strictEqual((await api("admin_t", "GET", "/api/clients")).json.clients.length, 2); // admin ve todo
});

test("firm_admin ve los DATOS como usuario común de su firma", async () => {
  const clients = await api("boss_t", "GET", "/api/clients");
  assert.deepStrictEqual(clients.json.clients.map((c) => c.name), ["Cliente Del Piloto Inc"]);
});
