import 'dotenv/config'
import { supabase } from '../src/config/supabase'

async function main() {
  // what weeks exist for teacher 14 in semester 11
  const { data: rows } = await supabase
    .from('timetables')
    .select('week_start, class_id, classes(class_name)')
    .eq('semester_id', 11)
    .eq('teacher_id', 14)

  const byWeek = new Map<string, number>()
  ;(rows || []).forEach((r: any) => {
    const w = r.week_start || 'NULL'
    byWeek.set(w, (byWeek.get(w) || 0) + 1)
  })
  console.log('Teacher 14 (sem 11) rows:', (rows || []).length)
  console.log('by week_start:')
  ;[...byWeek.entries()].sort().forEach(([w, n]) => console.log(`  ${w}: ${n}`))

  const { data: t14 } = await supabase.from('teachers').select('teacher_id, full_name, user_id').eq('teacher_id', 14).maybeSingle()
  console.log('teacher 14 user_id:', t14?.user_id)
}
main().then(() => process.exit(0))