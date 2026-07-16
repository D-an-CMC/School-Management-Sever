const { createClient } = require('@supabase/supabase-js');
const sb = createClient('https://akurubwwxfgeduyxazyl.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrdXJ1Ynd3eGZnZWR1eXhhenlsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjcyNTc1NSwiZXhwIjoyMDk4MzAxNzU1fQ.N958cFmRxMqEDDHjBh_vvWqPdmDLzN5YBSKsqLr36pI', { auth: { autoRefreshToken: false, persistSession: false } });

async function check() {
  const { data: classes } = await sb.from('classes').select('class_id, class_name, grade_level').order('class_id');
  const { count: total } = await sb.from('students').select('*', { count: 'exact', head: true });
  console.log('Total students:', total);
  let allOk = true;
  const gradeTotals = {};
  for (const cls of classes) {
    const { count } = await sb.from('students').select('*', { count: 'exact', head: true }).eq('class_id', cls.class_id);
    const c = count || 0;
    const ok = c === 5;
    if (!ok) allOk = false;
    gradeTotals[cls.grade_level] = (gradeTotals[cls.grade_level] || 0) + c;
    console.log((ok ? '[OK]' : '[MISS]') + ' ' + cls.class_name + ' grade ' + cls.grade_level + ': ' + c + ' HS');
  }
  console.log('');
  Object.keys(gradeTotals).sort((a,b) => a - b).forEach(function(g) { console.log('Grade ' + g + ': ' + gradeTotals[g] + ' HS'); });
  console.log('\nAll OK:', allOk);
}
check().catch(function(e) { console.error(e); });
