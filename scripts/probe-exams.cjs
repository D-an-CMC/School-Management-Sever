const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
dotenv.config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data, error } = await sb
    .from('timetables')
    .select('schedule_id, class_id, day_of_week, period_no, week_start, semester_id, timetable_type_id, exam_name, subjects(subject_name), classes(class_name)')
    .eq('timetable_type_id', 2);
  if (error) return console.error('ERR', error.message);
  console.log('count:', data.length);
  data.forEach((r) => console.log(`${r.schedule_id} ${r.classes?.class_name} ${r.subjects?.subject_name} d${r.day_of_week} p${r.period_no} wk${r.week_start} sem${r.semester_id} ${r.exam_name}`));
})();