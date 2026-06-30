"use strict";

const { Pool } = require("pg");

function databaseUrl() {
  return String(process.env.DATABASE_URL || "").trim();
}

function isDatabaseConfigured() {
  return Boolean(databaseUrl());
}

function createPool() {
  const connectionString = databaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });
}

module.exports = {
  createPool,
  databaseUrl,
  isDatabaseConfigured,
};
