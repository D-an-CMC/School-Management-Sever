import { supabase } from '../src/config/supabase';

async function check() {
  const { data, error } = await supabase.from('timetables').select('day_of_week').limit(10);
  console.log('Timetables day_of_week:', data?.map(d => d.day_of_week));
  console.log('Error:', error);
}

check();
