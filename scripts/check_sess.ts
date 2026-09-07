import { supabase } from '../src/config/supabase';

async function check() {
  const { data: years } = await supabase.from('school_years').select('school_year_id').eq('is_active', true);
  const activeYearId = years?.[0]?.school_year_id;
  console.log('Active year:', activeYearId);
  const { data: sessions, error } = await supabase.from('attendance_sessions').select('*');
  console.log('All sessions:', sessions);
}

check();
