import { supabase } from '../src/config/supabase';

async function check() {
  const { data: sessions } = await supabase.from('attendance_sessions').select('*').order('attendance_date', { ascending: false }).limit(5);
  console.log('Sessions:', sessions);
}

check();
