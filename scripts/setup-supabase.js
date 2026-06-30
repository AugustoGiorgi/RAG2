"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createPool } = require("../lib/postgres");

async function main() {
  const schemaPath = path.join(__dirname, "supabase-schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  const pool = createPool();
  try {
    await pool.query(sql);
    const result = await pool.query("select current_database() as database_name, current_schema() as schema_name");
    console.log(`Supabase schema is ready on database ${result.rows[0].database_name}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
