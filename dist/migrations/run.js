import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, '001_initial_schema.sql'), 'utf-8');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function main() {
    // Split by statement and execute
    const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));
    console.log(`Found ${statements.length} SQL statements to run...`);
    // Use Supabase SQL API
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
    console.log(text.slice(0, 500));
}
main().catch(console.error);
//# sourceMappingURL=run.js.map