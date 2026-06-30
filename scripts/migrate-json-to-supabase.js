"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createPool } = require("../lib/postgres");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, "data");
const DEFAULT_TENANT_ID = String(process.env.DEFAULT_TENANT_ID || "rag-tax-ai").trim() || "rag-tax-ai";
const DEFAULT_TENANT_NAME = String(process.env.DEFAULT_TENANT_NAME || "RAG Tax AI").trim() || "RAG Tax AI";

function readJson(fileName, fallback) {
  const filePath = path.join(DATA_DIR, fileName);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function jsonb(value) {
  return JSON.stringify(value ?? {});
}

function userTenantMap() {
  const store = readJson("users.json", { users: [] });
  const map = new Map();
  (Array.isArray(store.users) ? store.users : []).forEach((user) => {
    if (user?.username) map.set(String(user.username), String(user.tenantId || user.tenant_id || DEFAULT_TENANT_ID));
  });
  return map;
}

async function migrateUsers(client) {
  await client.query(
    `insert into rag_private.firms (tenant_id, name)
     values ($1, $2)
     on conflict (tenant_id) do update set name = excluded.name`,
    [DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME],
  );
  const store = readJson("users.json", { users: [] });
  const users = Array.isArray(store.users) ? store.users : [];
  for (const user of users) {
    if (!user?.username || !user?.passwordHash) continue;
    const tenantId = String(user.tenantId || user.tenant_id || DEFAULT_TENANT_ID);
    await client.query(
      `insert into rag_private.firms (tenant_id, name)
       values ($1, $2)
       on conflict (tenant_id) do nothing`,
      [tenantId, tenantId === DEFAULT_TENANT_ID ? DEFAULT_TENANT_NAME : tenantId],
    );
    await client.query(
      `insert into rag_private.app_users
        (username, password_hash, tenant_id, role, display_name, active, spend_limit_usd, created_at, updated_at, last_password_change_at)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), coalesce($9::timestamptz, now()), $10::timestamptz)
       on conflict (username) do update set
        password_hash = excluded.password_hash,
        tenant_id = excluded.tenant_id,
        role = excluded.role,
        display_name = excluded.display_name,
        active = excluded.active,
        spend_limit_usd = excluded.spend_limit_usd,
        updated_at = now(),
        last_password_change_at = excluded.last_password_change_at`,
      [
        String(user.username),
        String(user.passwordHash),
        tenantId,
        user.role === "admin" ? "admin" : "user",
        String(user.displayName || user.username),
        user.active !== false,
        user.spendLimitUsd === undefined ? null : normalizeNumber(user.spendLimitUsd),
        isoOrNull(user.createdAt),
        isoOrNull(user.updatedAt),
        isoOrNull(user.lastPasswordChangeAt),
      ],
    );
    await client.query(
      `insert into rag_private.user_firms (username, tenant_id, firm_role)
       values ($1, $2, $3)
       on conflict (username, tenant_id) do update set firm_role = excluded.firm_role`,
      [String(user.username), tenantId, user.role === "admin" ? "admin" : "member"],
    );
  }
  return users.length;
}

async function migrateClients(client) {
  const db = readJson("db.json", { clients: {} });
  const clients = db.clients && typeof db.clients === "object" ? db.clients : {};
  let count = 0;
  for (const [clientId, record] of Object.entries(clients)) {
    const tenantId = record?.tenantId || record?.tenant_id || DEFAULT_TENANT_ID;
    await client.query(
      `insert into rag_private.firms (tenant_id, name)
       values ($1, $2)
       on conflict (tenant_id) do nothing`,
      [tenantId, tenantId === DEFAULT_TENANT_ID ? DEFAULT_TENANT_NAME : tenantId],
    );
    await client.query(
      `insert into rag_private.clients (client_id, tenant_id, owner_username, display_name, payload)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (client_id) do update set
        tenant_id = excluded.tenant_id,
        owner_username = excluded.owner_username,
        display_name = excluded.display_name,
        payload = excluded.payload,
        updated_at = now()`,
      [
        clientId,
        tenantId,
        record?.ownerUsername || record?.createdBy || null,
        record?.name || record?.clientName || clientId,
        jsonb(record),
      ],
    );
    count += 1;
  }
  return count;
}

async function migrateCostLog(client) {
  const store = readJson("cost_log.json", { entries: [] });
  const entries = Array.isArray(store.entries) ? store.entries : [];
  const tenantsByUsername = userTenantMap();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] || {};
    const username = entry.username || entry.user || null;
    await client.query(
      `insert into rag_private.cost_log_entries
        (source_index, username, tenant_id, action, model, input_tokens, output_tokens, total_cost_usd, occurred_at, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::jsonb)
       on conflict (source_index) do update set
        username = excluded.username,
        tenant_id = excluded.tenant_id,
        action = excluded.action,
        model = excluded.model,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        total_cost_usd = excluded.total_cost_usd,
        occurred_at = excluded.occurred_at,
        payload = excluded.payload`,
      [
        index,
        username,
        username ? tenantsByUsername.get(String(username)) || DEFAULT_TENANT_ID : DEFAULT_TENANT_ID,
        entry.action || null,
        entry.model || null,
        normalizeNumber(entry.inputTokens ?? entry.input_tokens),
        normalizeNumber(entry.outputTokens ?? entry.output_tokens),
        normalizeNumber(entry.totalCostUsd ?? entry.total_cost_usd ?? entry.costUsd),
        isoOrNull(entry.createdAt || entry.timestamp || entry.occurredAt),
        jsonb(entry),
      ],
    );
  }
  return entries.length;
}

async function migrateAuditLog(client) {
  const store = readJson("audit_log.json", { entries: [] });
  const entries = Array.isArray(store.entries) ? store.entries : [];
  const tenantsByUsername = userTenantMap();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] || {};
    const username = entry.username || entry.user?.username || null;
    await client.query(
      `insert into rag_private.audit_log_entries
        (source_index, username, tenant_id, action, occurred_at, payload)
       values ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
       on conflict (source_index) do update set
        username = excluded.username,
        tenant_id = excluded.tenant_id,
        action = excluded.action,
        occurred_at = excluded.occurred_at,
        payload = excluded.payload`,
      [
        index,
        username,
        username ? tenantsByUsername.get(String(username)) || DEFAULT_TENANT_ID : DEFAULT_TENANT_ID,
        entry.action || null,
        isoOrNull(entry.createdAt || entry.timestamp || entry.occurredAt),
        jsonb(entry),
      ],
    );
  }
  return entries.length;
}

async function migrateAccessRequests(client) {
  const store = readJson("access_requests.json", { entries: [] });
  const entries = Array.isArray(store.entries) ? store.entries : [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] || {};
    await client.query(
      `insert into rag_private.access_requests
        (source_index, email, name, estimated_returns, created_at, payload)
       values ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
       on conflict (source_index) do update set
        email = excluded.email,
        name = excluded.name,
        estimated_returns = excluded.estimated_returns,
        created_at = excluded.created_at,
        payload = excluded.payload`,
      [
        index,
        entry.email || entry.contactEmail || null,
        entry.name || entry.contactName || entry.company || entry.firm || null,
        entry.estimatedReturns || entry.estimated_returns || entry.returns || null,
        isoOrNull(entry.createdAt || entry.timestamp),
        jsonb(entry),
      ],
    );
  }
  return entries.length;
}

async function storeSnapshots(client) {
  const snapshotFiles = [
    "db.json",
    "clients.json",
    "firm_library.json",
    "deadlines.json",
    "ai_learning.json",
    "feedback.json",
    "tracker.json",
    "google_tokens.json",
    "qbo_tokens.json",
    "accounting_tokens.json",
    "access_requests.json",
  ];
  let count = 0;
  for (const fileName of snapshotFiles) {
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) continue;
    const payload = readJson(fileName, null);
    if (payload === null) continue;
    await client.query(
      `insert into rag_private.app_json_snapshots (snapshot_key, payload, imported_at)
       values ($1, $2::jsonb, now())
       on conflict (snapshot_key) do update set payload = excluded.payload, imported_at = now()`,
      [fileName, jsonb(payload)],
    );
    count += 1;
  }
  return count;
}

async function main() {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const counts = {
      users: await migrateUsers(client),
      clients: await migrateClients(client),
      costLogEntries: await migrateCostLog(client),
      auditLogEntries: await migrateAuditLog(client),
      accessRequests: await migrateAccessRequests(client),
      snapshots: await storeSnapshots(client),
    };
    await client.query("commit");
    console.log(`Migration complete: ${JSON.stringify(counts)}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
