import 'dotenv/config'
import { supabase } from '../src/config/supabase'

async function main() {
  const { data: sems } = await supabase.from('semesters').select('semester_id, semester_name, school_year_id').order('semester_id')
  const { data: classes } = await supabase.from('classes').select('class_id, school_year_id')
  const classYear = new Map<number, number>()
  ;(classes || []).forEach((c: any) => classYear.set(Number(c.class_id), Number(c.school_year_id)))

  for (const s of (sems || [])) {
    const { count } = await supabase.from('timetables').select('*', { count: 'exact', head: true }).eq('semester_id', s.semester_id)
    if (!count) { console.log(`sem ${s.semester_id} (year ${s.school_year_id}): 0 rows`); continue }
    const { data: tt } = await supabase.from('timetables').select('class_id').eq('semester_id', s.semester_id)
    const seen = new Set<number>()
    let wrong = 0
    ;(tt || []).forEach((r: any) => {
      const cid = Number(r.class_id)
      if (seen.has(cid)) return
      seen.add(cid)
      if (classYear.get(cid) !== Number(s.school_year_id)) wrong++
    })
    console.log(`sem ${s.semester_id} (year ${s.school_year_id}): ${count} rows, distinct classes=${seen.size}, WRONG-year classes=${wrong}`)
  }
}
main().then(() => process.exit(0))