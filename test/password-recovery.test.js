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

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("base64url");
  return `pbkdf2$210000$${salt}$${hash}`;
}

function fakeSmtp() {
  const messages = [];
  const server = net.createServer((socket) => {
    socket.write("220 local test smtp\r\n");
    let buffer = "";
    let data = false;
    let lines = [];
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let end;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            const raw = lines.join("\r\n");
            const body = raw.split("\r\n\r\n")[1] || "";
            messages.push(Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8"));
            lines = [];
            data = false;
            socket.write("250 accepted\r\n");
          } else lines.push(line);
        } else if (line.startsWith("EHLO") || line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) {
          socket.write("250 ok\r\n");
        } else if (line === "DATA") {
          data = true;
          socket.write("354 go ahead\r\n");
        } else if (line === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        }
      }
    });
  });
  return { server, messages };
}

async function availablePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

test("temporary passwords and email recovery protect existing and new accounts", { timeout: 120000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ragtax-password-test-"));
  fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify({ users: [
    { username: "admin_test", passwordHash: passwordHash("AdminPassword12345!"), role: "admin", tenantId: "rag-tax-ai", active: true },
    { username: "legacy_test", passwordHash: passwordHash("LegacyPassword12345!"), role: "user", tenantId: "firm-one", active: true },
  ], budgetGroups: [] }));
  const mail = fakeSmtp();
  await new Promise((resolve) => mail.server.listen(0, "127.0.0.1", resolve));
  const appPort = await availablePort();
  const base = `http://127.0.0.1:${appPort}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1", PORT: String(appPort), DATA_DIR: dataDir,
      AUTH_SECRET: "synthetic-password-test-secret-0123456789",
      AUTH_USERS_JSON: "[]", DATABASE_URL: "", ANTHROPIC_API_KEY: "",
      ADMIN_2FA_ENABLED: "false", COOKIE_SECURE: "false",
      ACCESS_REQUEST_SMTP_HOST: "127.0.0.1", ACCESS_REQUEST_SMTP_PORT: String(mail.server.address().port),
      ACCESS_REQUEST_SMTP_SECURE: "false", ACCESS_REQUEST_SMTP_STARTTLS: "false",
      ACCESS_REQUEST_SMTP_USER: "", ACCESS_REQUEST_SMTP_PASS: "",
      ACCESS_REQUEST_FROM_EMAIL: "no-reply@example.test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log = (log + chunk).slice(-1500); });
  child.stderr.on("data", (chunk) => { log = (log + chunk).slice(-1500); });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    await new Promise((resolve) => mail.server.close(resolve));
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (path.resolve(dataDir).startsWith(tempRoot) && path.basename(dataDir).startsWith("ragtax-password-test-")) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch (_) { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(Date.now() < deadline, `server did not start: ${log}`);

  async function request(method, route, body, cookie = "") {
    const response = await fetch(`${base}${route}`, {
      method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})), cookie: (response.headers.get("set-cookie") || "").split(";")[0], response };
  }
  async function waitForMail(count) {
    const deadline = Date.now() + 10000;
    while (mail.messages.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(mail.messages.length, count);
  }

  const admin = await request("POST", "/api/login", { username: "admin_test", password: "AdminPassword12345!" });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.mustChangePassword, false);
  const legacy = await request("POST", "/api/login", { username: "legacy_test", password: "LegacyPassword12345!" });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.mustChangePassword, false);
  assert.equal((await request("POST", "/api/admin/users", { username: "new_test", password: "TemporaryPassword123!" }, admin.cookie)).status, 400);

  const created = await request("POST", "/api/admin/users", {
    username: "new_test", email: "new@example.test", password: "TemporaryPassword123!", tenantId: "firm-one",
  }, admin.cookie);
  assert.equal(created.status, 200);
  assert.equal(created.body.user.email, "new@example.test");
  assert.equal(created.body.user.mustChangePassword, true);
  assert.equal(created.body.user.passwordHash, undefined);
  const firstLogin = await request("POST", "/api/login", { username: "new_test", password: "TemporaryPassword123!" });
  assert.equal(firstLogin.status, 200);
  assert.equal(firstLogin.body.mustChangePassword, true);
  assert.equal((await request("GET", "/api/auth/status", undefined, firstLogin.cookie)).body.mustChangePassword, true);
  assert.equal((await request("GET", "/api/clients", undefined, firstLogin.cookie)).status, 403);
  const changePage = await fetch(`${base}/change-password`, { headers: { cookie: firstLogin.cookie } });
  assert.equal(changePage.status, 200);
  const changeHtml = await changePage.text();
  assert.match(changeHtml, /temporary password/i);
  assert.match(changeHtml, /<form id="form" novalidate>/);
  assert.equal((changeHtml.match(/class="visibility"/g) || []).length, 3);
  assert.equal((await request("POST", "/api/auth/change-password", { currentPassword: "bad", newPassword: "PrivatePassword123!" }, firstLogin.cookie)).status, 401);
  assert.equal((await request("POST", "/api/auth/change-password", { currentPassword: "TemporaryPassword123!", newPassword: "shortpass123" }, firstLogin.cookie)).status, 400);
  assert.equal((await request("POST", "/api/auth/change-password", { currentPassword: "TemporaryPassword123!", newPassword: "password123456789" }, firstLogin.cookie)).status, 400);
  assert.equal((await request("POST", "/api/auth/change-password", { currentPassword: "TemporaryPassword123!", newPassword: "new_test_private_phrase" }, firstLogin.cookie)).status, 400);
  const changed = await request("POST", "/api/auth/change-password", { currentPassword: "TemporaryPassword123!", newPassword: "PrivatePassword123!" }, firstLogin.cookie);
  assert.equal(changed.status, 200);
  assert.ok(changed.cookie);
  assert.equal((await request("GET", "/api/clients", undefined, changed.cookie)).status, 200);
  assert.equal((await request("GET", "/api/clients", undefined, firstLogin.cookie)).status, 401);
  assert.equal((await request("POST", "/api/login", { username: "new_test", password: "TemporaryPassword123!" })).status, 401);

  const unknown = await request("POST", "/api/auth/forgot-password", { email: "unknown@example.test" });
  const forgotPage = await fetch(`${base}/forgot-password`);
  assert.equal(forgotPage.status, 200);
  assert.match(await forgotPage.text(), /Account email/);
  const known = await request("POST", "/api/auth/forgot-password", { email: "new@example.test" });
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.equal(unknown.body.message, known.body.message);
  await waitForMail(1);
  const link = mail.messages[0].match(/https:\/\/ragtax-ia\.com\/reset-password#[^\s]+/)?.[0];
  assert.ok(link);
  const resetPage = await fetch(`${base}/reset-password`);
  assert.equal(resetPage.status, 200);
  assert.match(await resetPage.text(), /Choose a new password/);
  assert.equal(resetPage.headers.get("referrer-policy"), "no-referrer");
  const params = new URLSearchParams(new URL(link).hash.slice(1));
  const token = params.get("token");
  assert.equal(params.get("username"), "new_test");
  assert.ok(token);
  assert.equal(fs.readFileSync(path.join(dataDir, "users.json"), "utf8").includes(token), false);
  assert.equal((await request("POST", "/api/auth/reset-password", { username: "new_test", token: "X".repeat(43), newPassword: "RecoveredPassword123!" })).status, 400);
  assert.equal((await request("POST", "/api/auth/reset-password", { username: "new_test", token, newPassword: "123456789012345" })).status, 400);
  const reset = await request("POST", "/api/auth/reset-password", { username: "new_test", token, newPassword: "RecoveredPassword123!" });
  assert.equal(reset.status, 200);
  assert.equal((await request("POST", "/api/auth/reset-password", { username: "new_test", token, newPassword: "AnotherPassword123!" })).status, 400);
  assert.equal((await request("GET", "/api/clients", undefined, changed.cookie)).status, 401);
  assert.equal((await request("POST", "/api/login", { username: "new_test", password: "RecoveredPassword123!" })).status, 200);

  assert.equal((await request("POST", "/api/auth/forgot-password", { email: "legacy@example.test" })).status, 200);
  assert.equal(mail.messages.length, 1);
  assert.equal((await request("PUT", "/api/admin/users/legacy_test", { email: "legacy@example.test" }, admin.cookie)).status, 200);
  assert.equal((await request("PUT", "/api/admin/users/legacy_test", { email: "new@example.test" }, admin.cookie)).status, 409);
  assert.equal((await request("POST", "/api/auth/forgot-password", { email: "legacy@example.test" })).status, 200);
  await waitForMail(2);
  const legacyLink = mail.messages[1].match(/https:\/\/ragtax-ia\.com\/reset-password#[^\s]+/)?.[0];
  const legacyToken = new URLSearchParams(new URL(legacyLink).hash.slice(1)).get("token");
  const store = JSON.parse(fs.readFileSync(path.join(dataDir, "users.json"), "utf8"));
  store.users.find((user) => user.username === "legacy_test").passwordReset.expiresAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify(store));
  assert.equal((await request("POST", "/api/auth/reset-password", { username: "legacy_test", token: legacyToken, newPassword: "LegacyNewPassword123!" })).status, 400);
  assert.equal((await request("POST", "/api/login", { username: "legacy_test", password: "LegacyPassword12345!" })).status, 200);
  assert.equal((await request("PUT", "/api/admin/users/new_test", { active: false }, admin.cookie)).status, 200);
  assert.equal((await request("POST", "/api/auth/forgot-password", { email: "new@example.test" })).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(mail.messages.length, 2, "disabled users do not receive recovery mail");
});
