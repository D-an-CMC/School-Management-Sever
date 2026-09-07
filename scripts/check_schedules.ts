import { supabase } from '../src/config/supabase';

async function check() {
  const { data, error } = await supabase.from('schedules').select('*').limit(5);
  console.log('Schedules:', data);
  console.log('Error:', error);
}

check();
