import { supabase } from '../src/config/supabase';

async function check() {
  const { count: gCount } = await supabase.from('grade_items').select('*', { count: 'exact', head: true });
  console.log('Grade Items Count:', gCount);
}

check();
