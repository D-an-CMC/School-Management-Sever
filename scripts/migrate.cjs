#!/usr/bin/env node
/**
 * Applies all SQL migration files in src/migrations to Supabase via a direct
 * Postgres connection. DDL (ALTER TABLE) cannot be executed through the
 * PostgREST API, so we use the `pg` driver with a DATABASE_URL connection string.
 *
 * Usage:
 *   1. Copy the Postgres connection string from your Supabase Dashboard:
 *        Project Settings -> Database -> Connection string -> URI
 *      (use the `postgres` user + password, mode: Transaction pooler or direct).
 *   2. Add it to School-Management-Sever/.env as DATABASE_URL, e.g.:
 *        DATABASE_URL=postgresql://postgres.<ref>:PASSWORD@aws-0-<region>.pooler.supabase.com:6543/postgres
 *   3. Run:  npm i -D pg && node scripts/migrate.cjs
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[migrate] Missing DATABASE_URL. Add it to .env (see header of this script).');
    process.exit(1);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.error('[migrate] No .sql files found in', MIGRATIONS_DIR);
    process.exit(1);
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('[migrate] Connected to database.');

  // Track applied migrations to be idempotent across runs.
  await client.query(`
    CREATE TABLE IF NOT EXISTS public._migrations (
      file_name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  for (const file of files) {
    const { rows } = await client.query(
      'SELECT 1 FROM public._migrations WHERE file_name = $1',
      [file]
    );
    if (rows.length > 0) {
      console.log(`[migrate] SKIP  ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[migrate] RUN   ${file}`);
    await client.query(sql);
    await client.query('INSERT INTO public._migrations (file_name) VALUES ($1)', [file]);
    console.log(`[migrate] DONE  ${file}`);
  }

  await client.end();
  console.log('[migrate] All migrations finished successfully.');
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err.message);
  process.exit(1);
});
