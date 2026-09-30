"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const USER_COUNT = 20;
const PASSWORD = "SyntheticTestPassword123!";
const OFFICE_IP = "203.0.113.20";

function percentile(samples, percent) {
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * percent / 100) - 1] || 0;
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("20 users share within firms, remain isolated across firms, and keep personal tokens", { timeout: 120000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ragtax-20-users-"));
  const salt = crypto.randomBytes(12).toString("base64url");
  const hash = crypto.pbkdf2Sync(PASSWORD, salt, 210000, 32, "sha256").toString("base64url");
  const users = Array.from({ length: USER_COUNT }, (_, i) => ({
    username: `load_${String(i).padStart(2, "0")}`,
    passwordHash: `pbkdf2$210000$${salt}$${hash}`,
    role: "user",
    displayName: `Synthetic user ${i}`,
    tenantId: i < USER_COUNT / 2 ? "rag-tax-ai" : "firm-b",
    active: true,
  }));
  fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify({ users, budgetGroups: [] }));
  fs.writeFileSync(path.join(dataDir, "google_tokens.json"), JSON.stringify({
    users: { load_00: { access_token: "test-only-token", scope: "https://www.googleapis.com/auth/drive.file" } },
  }));
  fs.writeFileSync(path.join(dataDir, "qbo_tokens.json"), JSON.stringify({
    users: { load_00: { companies: { synthetic: { realmId: "synthetic", companyName: "Test-only company" } } } },
  }));

  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: String(port),
      AUTH_SECRET: "synthetic-test-secret-0123456789-0123456789",
      AUTH_USERS_JSON: "[]",
      DATABASE_URL: "",
      ANTHROPIC_API_KEY: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      QBO_CLIENT_ID: "",
      QBO_CLIENT_SECRET: "",
      TOKEN_ENCRYPTION_KEY: "",
      ENABLE_CLIENT_FILE_PERSISTENCE: "false",
      API_RATE_LIMIT_MAX: "16",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bootLog = "";
  child.stdout.on("data", (chunk) => { bootLog = (bootLog + chunk).slice(-2000); });
  child.stderr.on("data", (chunk) => { bootLog = (bootLog + chunk).slice(-2000); });
  t.after(async () => {
    if (child.exitCode === null) {
      const exit = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (path.resolve(dataDir).startsWith(tempRoot) && path.basename(dataDir).startsWith("ragtax-20-users-")) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/healthz`)).status === 200) break;
    } catch (_) { /* waiting for boot */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(Date.now() < deadline, `test server did not start: ${bootLog}`);

  const jars = new Map();
  const samples = [];
  async function request(username, method, route, body, extraHeaders = {}) {
    const started = performance.now();
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-real-ip": OFFICE_IP,
        ...(jars.has(username) ? { cookie: jars.get(username) } : {}),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    samples.push(performance.now() - started);
    return { status: response.status, json: await response.json().catch(() => ({})), headers: response.headers };
  }

  const logins = await Promise.all(users.map((user) => request(user.username, "POST", "/api/login", { username: user.username, password: PASSWORD })));
  logins.forEach((response, i) => {
    assert.equal(response.status, 200, `login ${users[i].username}`);
    jars.set(users[i].username, (response.headers.get("set-cookie") || "").split(";")[0]);
  });

  const clients = await Promise.all(users.map((user, i) => request(user.username, "POST", "/api/clients", {
    name: `Synthetic ${i < 10 ? "A" : "B"} client ${i}`,
  })));
  clients.forEach((response, i) => assert.equal(response.status, 200, `client create ${i}`));
  const clientIds = clients.map((response) => response.json.client?.id || response.json.id);
  assert.ok(clientIds.every(Boolean));

  const tasks = await Promise.all(users.map((user, i) => request(user.username, "POST", "/api/tracker/tasks", {
    title: `Synthetic ${i < 10 ? "A" : "B"} task ${i}`,
  })));
  tasks.forEach((response, i) => assert.equal(response.status, 200, `task create ${i}`));

  const sessions = await Promise.all(users.map((user, i) => request(user.username, "POST", "/api/sessions", {
    clientId: clientIds[i], client: { name: `Synthetic ${i < 10 ? "A" : "B"} client ${i}` }, taxYear: "2025",
  })));
  sessions.forEach((response, i) => assert.equal(response.status, 200, `session create ${i}`));
  const sessionIds = sessions.map((response) => response.json.session?.id);
  assert.ok(sessionIds.every(Boolean));

  const views = await Promise.all(users.map(async (user, i) => ({
    i,
    clients: await request(user.username, "GET", "/api/clients"),
    tasks: await request(user.username, "GET", "/api/tracker"),
    sessions: await request(user.username, "GET", "/api/sessions"),
  })));
  for (const view of views) {
    const firm = view.i < 10 ? "A" : "B";
    assert.equal(view.clients.status, 200);
    assert.equal(view.tasks.status, 200);
    assert.equal(view.sessions.status, 200);
    assert.equal(view.clients.json.clients.length, 10, `clients for ${view.i}`);
    assert.equal(view.tasks.json.tasks.length, 10, `tasks for ${view.i}`);
    assert.equal(view.sessions.json.sessions.length, 10, `sessions for ${view.i}`);
    assert.ok(view.clients.json.clients.every((client) => client.name.startsWith(`Synthetic ${firm} client `)));
    assert.ok(view.tasks.json.tasks.every((task) => task.title.startsWith(`Synthetic ${firm} task `)));
  }

  assert.equal((await request(users[0].username, "GET", `/api/clients/${clientIds[10]}`)).status, 403);
  assert.equal((await request(users[10].username, "GET", `/api/clients/${clientIds[0]}`)).status, 403);
  assert.equal((await request(users[1].username, "GET", `/api/clients/${clientIds[0]}`)).status, 200);
  assert.equal((await request(users[0].username, "GET", `/api/sessions/${sessionIds[10]}`)).status, 403);
  assert.equal((await request(users[1].username, "GET", `/api/sessions/${sessionIds[0]}`)).status, 200);
  assert.equal((await request(users[0].username, "GET", `/api/clients/${clientIds[10]}/documents/missing/download`)).status, 403);
  assert.equal((await request(users[0].username, "POST", `/api/clients/${clientIds[10]}/documents`, { name: "denied.pdf" })).status, 403);
  assert.equal((await request(users[0].username, "POST", "/api/requests/read-files", { clientId: clientIds[10], files: [] })).status, 403);

  const ownDrive = await request(users[0].username, "GET", "/api/drive/status");
  const teammateDrive = await request(users[1].username, "GET", "/api/drive/status");
  assert.equal(ownDrive.json.connected, true);
  assert.equal(teammateDrive.json.connected, false);
  const ownQbo = await request(users[0].username, "GET", "/api/qbo/status");
  const teammateQbo = await request(users[1].username, "GET", "/api/qbo/status");
  assert.equal(ownQbo.json.connected, true);
  assert.equal(teammateQbo.json.connected, false);

  for (let i = 0; i < 17; i += 1) {
    const response = await request("anonymous", "GET", "/api/auth/status", undefined, {
      "x-real-ip": "198.51.100.44",
      "x-forwarded-for": `192.0.2.${i + 1}`,
    });
    assert.equal(response.status, i === 16 ? 429 : 200, `anonymous request ${i + 1}`);
  }

  console.log(`20 synthetic users: ${samples.length} requests, p95=${Math.round(percentile(samples, 95))}ms, max=${Math.round(Math.max(...samples))}ms`);
});
