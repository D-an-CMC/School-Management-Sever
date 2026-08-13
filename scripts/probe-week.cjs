const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
dotenv.config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0 Sun ... 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

(async () => {
  const gradeLevel = 6;
  const semesterId = undefined;
  const weekStart = '2025-09-13';
  // semester query (no week)
  let q = sb.from('timetables').select('*, subjects(*), classes(class_id, class_name, grade_level)').eq('timetable_type_id', 2);
  const { data: cls } = await sb.from('classes').select('class_id').eq('grade_level', 6);
  if (cls && cls.length) q = q.in('class_id', cls.map((c) => c.class_id));
  if (weekStart) q = q.eq('week_start', mondayOf(weekStart));
  const { data, error } = await q.order('day_of_week').order('period_no');
  console.log('WEEK monday=', mondayOf(weekStart), 'error=', error && error.message, 'rows=', (data || []).length);
  (data || []).forEach((r) => console.log(`  ${r.schedule_id} ${r.classes?.class_name} d${r.day_of_week} p${r.period_no} wk${r.week_start} exam="${r.exam_name}"`));
})();