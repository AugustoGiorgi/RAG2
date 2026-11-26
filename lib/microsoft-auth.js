"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ConfidentialClientApplication } = require("@azure/msal-node");

const PURPOSE_SCOPES = {
  drive: ["Files.Read"],
  write: ["Files.ReadWrite"],
  mail: ["Mail.Send"],
  mail_large: ["Mail.Send", "Mail.ReadWrite"],
};
const normalizeScope = scope => String(scope).replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase();
const permissionError = purpose => Object.assign(new Error("Connect Microsoft and allow the requested permission."), {
  statusCode: 401, code: "MICROSOFT_PERMISSION_REQUIRED", purpose,
});

function hasPermission(record, purpose) {
  if (!record || record.reconnectRequired) return false;
  const scopes = new Set((record.scopes || []).map(normalizeScope));
  if (purpose === "drive") return scopes.has("files.read") || scopes.has("files.readwrite");
  return Boolean(PURPOSE_SCOPES[purpose]?.every(scope => scopes.has(normalizeScope(scope))));
}

function createMicrosoftAuth(config) {
  const clock = config.clock || Date.now;
  const pending = new Map();
  const locks = new Map();
  const tenant = config.tenant || "common";
  let validRedirect = false;
  try {
    const url = new URL(config.redirectUri);
    validRedirect = !url.username && !url.password && !url.hash && !url.search &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
  } catch {}
  const enabled = Boolean(config.clientId && config.clientSecret && config.encryptionReady && validRedirect &&
    /^(common|organizations|consumers|[a-f0-9-]{36})$/i.test(tenant));
  const ready = () => {
    if (!enabled) throw Object.assign(new Error("Microsoft is not configured. An administrator must register the app and configure its credentials and token encryption."), { statusCode: 503, code: "MICROSOFT_NOT_CONFIGURED" });
  };
  const filename = username => path.join(config.directory, crypto.createHash("sha256").update(username).digest("hex") + ".json");
  function read(username) {
    try {
      const envelope = JSON.parse(fs.readFileSync(filename(username), "utf8"));
      if (envelope?.encrypted !== true) throw new Error("Unencrypted Microsoft cache.");
      const value = config.decrypt(envelope);
      if (!value || typeof value.cache !== "string" || typeof value.homeAccountId !== "string") throw new Error("Invalid Microsoft cache.");
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw permissionError("drive");
    }
  }
  function write(username, value) {
    ready();
    const encrypted = config.encrypt(value);
    if (encrypted?.encrypted !== true) throw new Error("Microsoft token storage requires encryption.");
    fs.mkdirSync(config.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(config.directory, 0o700);
    const file = filename(username);
    const temporary = file + "." + crypto.randomBytes(12).toString("hex") + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(encrypted), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
      fs.chmodSync(file, 0o600);
    } finally {
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  async function locked(username, action) {
    if (typeof username !== "string" || !username || username.length > 128) throw permissionError("drive");
    const entry = locks.get(username) || { tail: Promise.resolve(), count: 0 };
    if (entry.count >= 20) throw Object.assign(new Error("Too many Microsoft operations. Please wait."), { statusCode: 429 });
    const previous = entry.tail;
    let release;
    entry.tail = new Promise(resolve => { release = resolve; });
    entry.count++;
    locks.set(username, entry);
    await previous;
    try { return await action(); }
    finally {
      entry.count--;
      release();
      if (!entry.count) locks.delete(username);
    }
  }
  function client(record) {
    const options = { auth: { clientId: config.clientId, clientSecret: config.clientSecret, authority: "https://login.microsoftonline.com/" + tenant },
      system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } } };
    const app = config.createClient ? config.createClient(options) : new ConfidentialClientApplication(options);
    if (record?.cache) app.getTokenCache().deserialize(record.cache);
    return app;
  }
  function purge() {
    for (const [state, value] of pending) if (value.expires <= clock()) pending.delete(state);
  }
  function status(username) {
    let record;
    let unreadable = false;
    try { record = read(username); } catch { unreadable = true; }
    return {
      enabled, connected: Boolean(enabled && record && !record.reconnectRequired),
      connectionId: record?.connectionId || "",
      email: record?.email || "", displayName: record?.displayName || "",
      driveAuthorized: enabled && hasPermission(record, "drive"),
      writeAuthorized: enabled && hasPermission(record, "write"),
      mailAuthorized: enabled && hasPermission(record, "mail"),
      largeMailAuthorized: enabled && hasPermission(record, "mail_large"),
      reconnectRequired: unreadable || Boolean(record?.reconnectRequired),
    };
  }
  async function start(username, binding, purpose = "drive", attempt = "") {
    ready();
    if (!Object.hasOwn(PURPOSE_SCOPES, purpose) || !binding || !username) throw Object.assign(new Error("Invalid Microsoft connection request."), { statusCode: 400 });
    if (typeof attempt !== "string" || (attempt && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(attempt))) throw Object.assign(new Error("Invalid Microsoft connection attempt."), { statusCode: 400 });
    purge();
    if (pending.size >= 1000) throw Object.assign(new Error("Too many pending Microsoft connections."), { statusCode: 429 });
    for (const [key, value] of pending) if (value.username === username) pending.delete(key);
    const state = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const nonce = crypto.randomBytes(32).toString("base64url");
    const scopes = ["email", ...PURPOSE_SCOPES[purpose]];
    const url = await client().getAuthCodeUrl({ scopes, redirectUri: config.redirectUri, responseMode: "query", prompt: "select_account",
      state, nonce, codeChallenge: crypto.createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256" });
    pending.set(state, { username, binding, verifier, nonce, purpose, scopes, attempt, expires: clock() + 10 * 60 * 1000 });
    return url;
  }
  async function finish(username, binding, { state, code, error }) {
    ready();
    purge();
    const flow = pending.get(state);
    pending.delete(state);
    if (!flow || flow.username !== username || flow.binding !== binding) throw Object.assign(new Error("The Microsoft connection expired or belongs to another session. Start it again from the app."), { statusCode: 400 });
    if (error || !code || typeof code !== "string" || code.length > 8192) throw Object.assign(new Error("Microsoft access was cancelled or could not be completed."), { statusCode: 400 });
    return locked(username, async () => {
      let existing;
      try { existing = read(username); } catch {}
      const app = client(existing);
      const result = await app.acquireTokenByCode({ code, scopes: flow.scopes, redirectUri: config.redirectUri, codeVerifier: flow.verifier, nonce: flow.nonce });
      if (!result?.account?.homeAccountId || !result.accessToken) throw permissionError(flow.purpose);
      const cache = app.getTokenCache();
      for (const account of await cache.getAllAccounts()) if (account.homeAccountId !== result.account.homeAccountId) await cache.removeAccount(account);
      const sameAccount = existing?.homeAccountId === result.account.homeAccountId;
      write(username, {
        homeAccountId: result.account.homeAccountId, cache: cache.serialize(),
        scopes: [...new Set([...(sameAccount ? existing.scopes || [] : []), ...(result.scopes || [])])],
        email: String(result.account.username || "").slice(0, 254), displayName: String(result.account.name || "").slice(0, 200),
        connectionId: flow.attempt || crypto.randomUUID(),
        connectedAt: new Date(clock()).toISOString(), reconnectRequired: false,
      });
      return status(username);
    });
  }
  async function token(username, purpose = "drive", forceRefresh = false) {
    ready();
    return locked(username, async () => {
      const record = read(username);
      if (!hasPermission(record, purpose)) throw permissionError(purpose);
      const app = client(record);
      const account = await app.getTokenCache().getAccountByHomeId(record.homeAccountId);
      if (!account) throw permissionError(purpose);
      try {
        const result = await app.acquireTokenSilent({ account, scopes: PURPOSE_SCOPES[purpose], forceRefresh });
        if (!result?.accessToken || result.account?.homeAccountId !== record.homeAccountId) throw permissionError(purpose);
        write(username, { ...record, cache: app.getTokenCache().serialize() });
        return result.accessToken;
      } catch (error) {
        if (error.code === "MICROSOFT_PERMISSION_REQUIRED" || /interaction_required|consent_required|invalid_grant|login_required|no_tokens_found/i.test(String(error.errorCode || ""))) {
          write(username, { ...record, reconnectRequired: true });
          throw permissionError(purpose);
        }
        throw Object.assign(new Error("Microsoft authentication is temporarily unavailable. Please try again."), { statusCode: 503 });
      }
    });
  }
  async function disconnect(username) {
    return locked(username, () => {
      try { fs.unlinkSync(filename(username)); } catch (error) { if (error.code !== "ENOENT") throw error; }
      for (const [state, value] of pending) if (value.username === username) pending.delete(state);
    });
  }
  return { enabled, status, start, finish, token, disconnect, hasPermission: (username, purpose) => hasPermission(read(username), purpose) };
}

module.exports = { createMicrosoftAuth, hasPermission, PURPOSE_SCOPES, permissionError };
