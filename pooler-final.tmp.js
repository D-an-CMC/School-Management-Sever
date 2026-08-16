const { Client } = require('pg');
const ref = 'akurubwwxfgeduyxazyl';
const password = 'AqiV2OSsQ9OAA1ct';
const host = 'aws-1-ap-northeast-2.pooler.supabase.com';

async function testPort(port, label) {
  const url = `postgresql://postgres.${ref}:${password}@${host}:${port}/postgres`;
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    await c.connect();
    const r1 = await c.query('SELECT 1 AS ok, current_database() AS db');
    const r2 = await c.query('SELECT COUNT(*)::int AS n FROM public.users WHERE user_id = $1', [1]);
    await c.query('BEGIN');
    const r3 = await c.query('SELECT COUNT(*)::int AS n FROM public.students');
    await c.query('COMMIT');
    console.log(`OK   ${label} (${port}) -> ${r1.rows[0].db} users_id1=${r2.rows[0].n} students=${r3.rows[0].n} (params+txn OK)`);
    await c.end();
    return true;
  } catch (e) {
    console.log(`FAIL ${label} (${port}) -> ${e.code} ${e.message.slice(0, 140)}`);
    try { await c.end(); } catch {}
    return false;
  }
}

(async () => {
  const t = await testPort(6543, 'transaction');
  if (!t) await testPort(5432, 'session');
})().catch(console.error);