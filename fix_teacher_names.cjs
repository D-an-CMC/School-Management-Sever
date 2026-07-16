const { createClient } = require('@supabase/supabase-js');

const URL = 'https://akurubwwxfgeduyxazyl.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrdXJ1Ynd3eGZnZWR1eXhhenlsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjcyNTc1NSwiZXhwIjoyMDk4MzAxNzU1fQ.N958cFmRxMqEDDHjBh_vvWqPdmDLzN5YBSKsqLr36pI';

const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  // Get all teachers with their names
  const { data: teachers } = await sb.from('teachers').select('teacher_id, full_name, user_id').order('teacher_id');
  console.log('Teachers:', teachers?.length || 0);

  let updated = 0, failed = 0;

  for (const t of teachers) {
    if (!t.user_id || !t.full_name) { console.log('Skip teacher_id', t.teacher_id, 'no user_id or name'); continue; }

    // Update username in users table to real name
    const { error } = await sb.from('users').update({ username: t.full_name }).eq('user_id', t.user_id);
    if (error) {
      console.error('Fail user_id', t.user_id, t.full_name, error.message);
      failed++;
    } else {
      console.log('OK user_id', t.user_id, '->', t.full_name);
      updated++;
    }
    await sleep(200);
  }

  // Also check for teachers with user_ids that don't have a teacher record but have role_id=2
  const { data: roleUsers } = await sb.from('users').select('user_id, email, username').eq('role_id', 2).order('user_id');
  console.log('\nRemaining teachers in users table:');
  roleUsers?.forEach(u => console.log(' ', u.user_id, u.email, u.username));

  console.log('\nDone: updated=' + updated + ' failed=' + failed);
}
main().catch(e => console.error(e));
