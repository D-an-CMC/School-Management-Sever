const { createClient } = require('@supabase/supabase-js');

const URL = 'https://akurubwwxfgeduyxazyl.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrdXJ1Ynd3eGZnZWR1eXhhenlsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjcyNTc1NSwiZXhwIjoyMDk4MzAxNzU1fQ.N958cFmRxMqEDDHjBh_vvWqPdmDLzN5YBSKsqLr36pI';

const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  // Get students with id 1-9
  const { data: students } = await sb.from('students').select('student_id, student_code, full_name, user_id').in('student_id', [1,2,3,4,5,6,7,8,9]);
  console.log('Found students:', students?.length || 0);
  students?.forEach(s => console.log(' ', s.student_id, s.student_code, s.full_name, 'user_id:', s.user_id));

  if (!students?.length) { console.log('Nothing to delete'); return; }

  // Delete students (cascade will handle if set up, otherwise we need to delete users too)
  const { error: delErr } = await sb.from('students').delete().in('student_id', [1,2,3,4,5,6,7,8,9]);
  if (delErr) {
    console.error('Delete students error:', delErr.message);
    return;
  }
  console.log('Deleted', students.length, 'students');

  // Also delete linked user records to keep DB clean
  const userIds = students.filter(s => s.user_id).map(s => s.user_id);
  if (userIds.length > 0) {
    await sleep(500);
    const { error: userErr } = await sb.from('users').delete().in('user_id', userIds);
    if (userErr) console.error('Delete users error:', userErr.message);
    else console.log('Deleted', userIds.length, 'linked users');
  }

  console.log('Done');
}
main().catch(e => console.error(e));
