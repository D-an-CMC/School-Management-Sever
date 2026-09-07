import { supabase } from '../src/config/supabase';

async function check() {
  const { data: currentYear } = await supabase.from('school_years').select('*').eq('is_current', true).maybeSingle();
  console.log('Current Year:', currentYear);

  const { data: years } = await supabase.from('school_years').select('*');
  console.log('All Years:', years);

  const { count: yrCount, error: yrErr } = await supabase.from('year_results').select('*', { count: 'exact', head: true });
  console.log('Year Results Count:', yrCount, yrErr || 'No error');
  
  if (yrCount && yrCount > 0) {
     const { data: sample } = await supabase.from('year_results').select('*').limit(5);
     console.log('Sample year_results:', sample);
  }

  const { count: stCount } = await supabase.from('students').select('*', { count: 'exact', head: true });
  console.log('Students Count:', stCount);
}

check();
