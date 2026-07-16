const { createClient } = require('@supabase/supabase-js');

const URL = 'https://akurubwwxfgeduyxazyl.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrdXJ1Ynd3eGZnZWR1eXhhenlsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjcyNTc1NSwiZXhwIjoyMDk4MzAxNzU1fQ.N958cFmRxMqEDDHjBh_vvWqPdmDLzN5YBSKsqLr36pI';

const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  // Find teacher users without a linked teacher record
  const { data: teacherUsers } = await sb.from('users').select('user_id, email, username').eq('role_id', 2).order('user_id');
  console.log('All teacher users:', teacherUsers?.length || 0);

  // Get all user_ids that have teacher records
  const { data: linkedTeachers } = await sb.from('teachers').select('user_id');
  const linkedIds = new Set((linkedTeachers || []).map(t => t.user_id));
  console.log('Linked teacher user_ids:', [...linkedIds].sort((a,b) => a-b).join(', '));

  // Find orphaned (no teacher record)
  const orphans = (teacherUsers || []).filter(u => !linkedIds.has(u.user_id));
  console.log('\nOrphan teachers (no teacher record):');
  orphans.forEach(u => console.log(' ', u.user_id, u.email, u.username));

  if (orphans.length === 0) { console.log('Nothing to delete'); return; }

  const ids = orphans.map(u => u.user_id);
  const { error } = await sb.from('users').delete().in('user_id', ids);
  if (error) console.error('Delete error:', error.message);
  else console.log('\nDeleted', ids.length, 'orphan teacher users');
}
main().catch(e => console.error(e));
