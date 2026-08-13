import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Optional: pass the migration file name as argv[2], default to 001.
const fileName = process.argv[2] || '001_initial_schema.sql';
const sql = readFileSync(join(__dirname, fileName), 'utf-8');

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  console.log(`Running migration: ${fileName}`);
  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(text.slice(0, 1000));
}

main().catch(console.error);
