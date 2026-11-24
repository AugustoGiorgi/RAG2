"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createMicrosoftAuth, hasPermission } = require("../lib/microsoft-auth");

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rag-ms-auth-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const requests = [];
  let now = Date.now();
  let next = { username: "first@outlook.com", homeAccountId: "first", name: "First" };
  let granted = ["Files.Read"];
  let silentError;
  const config = {
    directory, clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: "https://example.com/auth/microsoft/callback", encryptionReady: true,
    clock: () => now,
    encrypt(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return { encrypted: true, iv: iv.toString("base64"), data: data.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
    },
    decrypt(value) {
      const cipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
      cipher.setAuthTag(Buffer.from(value.tag, "base64"));
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data, "base64")), cipher.final()]).toString());
    },
    createClient() {
      let accounts = [], secret = "PRIVATE_REFRESH_TOKEN";
      const cache = {
        serialize: () => JSON.stringify({ accounts, secret }),
        deserialize: raw => { ({ accounts, secret } = JSON.parse(raw)); },
        getAllAccounts: async () => accounts,
        removeAccount: async account => { accounts = accounts.filter(a => a.homeAccountId !== account.homeAccountId); },
        getAccountByHomeId: async id => accounts.find(a => a.homeAccountId === id),
      };
      return {
        getTokenCache: () => cache,
        getAuthCodeUrl: async request => { requests.push(request); return "https://login.microsoftonline.com/authorize?state=" + request.state; },
        acquireTokenByCode: async request => { requests.push(request); accounts.push(next); return { accessToken: "PRIVATE_ACCESS_TOKEN", account: next, scopes: granted }; },
        acquireTokenSilent: async request => { requests.push(request); if (silentError) throw silentError; return { accessToken: "PRIVATE_ACCESS_TOKEN", account: request.account }; },
      };
    },
    ...overrides,
  };
  const auth = createMicrosoftAuth(config);
  async function connect(username = "alice", binding = "session-a", purpose = "drive") {
    const url = await auth.start(username, binding, purpose);
    return auth.finish(username, binding, { state: new URL(url).searchParams.get("state"), code: "synthetic-code" });
  }
  return { auth, requests, directory, connect, advance: ms => { now += ms; }, account: (account, scopes) => { next = account; granted = scopes; }, silentError: error => { silentError = error; } };
}

test("Microsoft fails closed without credentials, encryption or a valid redirect", async t => {
  for (const options of [{ clientSecret: "" }, { encryptionReady: false }, { redirectUri: "http://evil.example/callback" }, { tenant: "../evil" }]) {
    const f = fixture(t, options); assert.equal(f.auth.enabled, false);
    await assert.rejects(f.auth.start("alice", "session-a"), /not configured/);
  }
});
test("OAuth uses unique random state, PKCE and nonce and binds the exchange to the session", async t => {
  const f = fixture(t); const url = await f.auth.start("alice", "session-a");
  const request = f.requests[0]; assert.equal(request.codeChallengeMethod, "S256");
  assert.ok(request.nonce.length >= 32); assert.ok(request.state.length >= 32);
  assert.deepEqual(request.scopes, ["email", "Files.Read"]);
  await f.auth.finish("alice", "session-a", { state: new URL(url).searchParams.get("state"), code: "code" });
  const exchange = f.requests[1];
  assert.equal(crypto.createHash("sha256").update(exchange.codeVerifier).digest("base64url"), request.codeChallenge);
  assert.equal(exchange.nonce, request.nonce);
});
test("OAuth rejects session substitution, replay, timeout, cancellation and invalid purpose", async t => {
  const f = fixture(t);
  for (const attack of ["session", "replay", "timeout", "cancel"]) {
    const url = await f.auth.start("alice", "session-a"); const state = new URL(url).searchParams.get("state");
    if (attack === "timeout") f.advance(600001);
    if (attack === "replay") await f.auth.finish("alice", "session-a", { state, code: "code" });
    await assert.rejects(f.auth.finish("alice", attack === "session" ? "session-b" : "session-a", { state, code: "code", error: attack === "cancel" ? "access_denied" : undefined }));
  }
  await assert.rejects(f.auth.start("alice", "session-a", "admin"), /Invalid/);
});
test("tokens are encrypted, isolated by user, silently refreshed and absent from status", async t => {
  const f = fixture(t); await f.connect();
  assert.equal(f.auth.status("alice").driveAuthorized, true);
  assert.equal(f.auth.status("bob").connected, false);
  const disk = fs.readdirSync(f.directory).map(name => fs.readFileSync(path.join(f.directory, name), "utf8")).join("");
  assert.ok(!disk.includes("PRIVATE_")); assert.ok(!disk.includes("outlook.com"));
  assert.ok(!JSON.stringify(f.auth.status("alice")).includes("PRIVATE_"));
  assert.equal(await f.auth.token("alice", "drive"), "PRIVATE_ACCESS_TOKEN");
  await assert.rejects(f.auth.token("bob", "drive"), /Connect Microsoft/);
  await assert.rejects(f.auth.token("alice", "mail"), /Connect Microsoft/);
});
test("switching Microsoft accounts never carries over the old account's permissions", async t => {
  const f = fixture(t); await f.connect();
  f.account({ username: "second@outlook.com", homeAccountId: "second" }, ["Mail.Send"]);
  await f.connect("alice", "session-a", "mail");
  assert.equal(f.auth.status("alice").email, "second@outlook.com");
  assert.equal(f.auth.status("alice").driveAuthorized, false); assert.equal(f.auth.status("alice").mailAuthorized, true);
});
test("incremental permissions stay on the same account only", async t => {
  const f = fixture(t); await f.connect();
  f.account({ username: "first@outlook.com", homeAccountId: "first" }, ["Mail.Send"]);
  await f.connect("alice", "session-a", "mail");
  assert.equal(f.auth.status("alice").mailAuthorized, true); assert.equal(f.auth.status("alice").driveAuthorized, true);
  assert.equal(hasPermission({ scopes: ["https://graph.microsoft.com/Files.ReadWrite"] }, "drive"), true);
});
test("corrupting or disconnecting one account cannot remove another account", async t => {
  const f = fixture(t); await f.connect(); await f.connect("bob", "session-b");
  const aliceFile = path.join(f.directory, crypto.createHash("sha256").update("alice").digest("hex") + ".json");
  fs.writeFileSync(aliceFile, "broken");
  assert.equal(f.auth.status("alice").reconnectRequired, true); assert.equal(f.auth.status("bob").connected, true);
  await f.auth.disconnect("alice"); assert.equal(f.auth.status("bob").connected, true);
});
test("revoked refresh tokens mark the account for manual reconnection without retry loops", async t => {
  const f = fixture(t); await f.connect(); f.silentError({ errorCode: "invalid_grant" });
  await assert.rejects(f.auth.token("alice", "drive"), /Connect Microsoft/);
  assert.equal(f.auth.status("alice").reconnectRequired, true);
});
