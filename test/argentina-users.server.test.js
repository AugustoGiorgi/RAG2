"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

test("only global USA admins can access Argentina account management", { timeout: 90000 }, async t => {
  const root = path.join(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rag-country-admin-"));
  const password = "Synthetic-country-admin-123!";
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = `pbkdf2$210000$${salt}$${crypto.pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("base64url")}`;
  fs.writeFileSync(path.join(dir, "users.json"), JSON.stringify({ users: [
    { username: "country_owner", role: "admin", passwordHash: hash, active: true, tenantId: "test-firm" },
    { username: "country_firm", role: "firm_admin", passwordHash: hash, active: true, tenantId: "test-firm" },
    { username: "country_member", role: "user", passwordHash: hash, active: true, tenantId: "test-firm" },
  ], budgetGroups: [] }));
  const portServer = net.createServer();
  await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: {
    ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: dir,
    AUTH_REQUIRED: "true", AUTH_SECRET: "synthetic-country-admin-secret-0123456789", AUTH_USERS_JSON: "[]",
    ADMIN_2FA_ENABLED: "false", COOKIE_SECURE: "false", DATABASE_URL: "", ANTHROPIC_API_KEY: "",
    RAG_AR_LOGIN_BRIDGE_FILE: path.join(dir, "bridge-not-configured.key"),
  }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", chunk => { log = (log + chunk).slice(-1500); });
  child.stderr.on("data", chunk => { log = (log + chunk).slice(-1500); });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill();
      await exited;
    }
    if (path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(dir).startsWith("rag-country-admin-")) fs.rmSync(dir, { recursive: true, force: true });
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { if ((await fetch(base + "/healthz")).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(Date.now() < deadline, log);
  const cookies = {};
  for (const username of ["country_owner", "country_firm", "country_member"]) {
    const response = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200);
    cookies[username] = response.headers.get("set-cookie").split(";")[0];
  }
  const call = (username, method = "GET") => fetch(base + "/api/admin/argentina-users", { method, headers: {
    ...(username && { cookie: cookies[username] }), "content-type": "application/json",
  }, ...(method === "POST" && { body: JSON.stringify({ username: "fede", displayName: "Fede", role: "admin" }) }) });
  assert.equal((await call()).status, 401);
  for (const username of ["country_firm", "country_member"]) {
    assert.equal((await call(username)).status, 403);
    assert.equal((await call(username, "POST")).status, 403);
  }
  assert.equal((await call("country_owner")).status, 503);
  assert.equal((await call("country_owner", "POST")).status, 503);
  assert.equal((await call("country_owner", "DELETE")).status, 405);
  const users = JSON.parse(fs.readFileSync(path.join(dir, "users.json"), "utf8")).users;
  assert.equal(users.length, 3);
  assert.ok(users.every(user => !user.username.startsWith("ar-")));
});
