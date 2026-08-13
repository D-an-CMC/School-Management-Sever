import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'fs'
import { supabase } from '../src/config/supabase'

async function main() {
  const { data: sems } = await supabase.from('semesters').select('semester_id, school_year_id').order('semester_id')
  const { data: classes } = await supabase.from('classes').select('class_id, school_year_id')
  const classYear = new Map<number, number>()
  ;(classes || []).forEach((c: any) => classYear.set(Number(c.class_id), Number(c.school_year_id)))

  // First pass: collect ALL wrong class_ids per semester (without deleting)
  const perSemester: Record<number, number[]> = {}
  for (const s of (sems || [])) {
    const { data: tt } = await supabase.from('timetables').select('class_id').eq('semester_id', s.semester_id)
    const wrong = new Set<number>()
    ;(tt || []).forEach((r: any) => {
      const cid = Number(r.class_id)
      if (classYear.get(cid) !== Number(s.school_year_id)) wrong.add(cid)
    })
    if (wrong.size > 0) perSemester[Number(s.semester_id)] = [...wrong]
  }
  console.log('Planned deletes per semester:', JSON.stringify(perSemester))

  // Save plan for dry-run record
  mkdirSync('C:/Users/phucn/Desktop/School-Management-Sever/scripts/backup', { recursive: true })
  writeFileSync(
    'C:/Users/phucn/Desktop/School-Management-Sever/scripts/backup/delete_plan.json',
    JSON.stringify(perSemester, null, 2)
  )

  const dryRun = process.argv[2] === '--apply' ? false : true
  let total = 0
  for (const [semId, wrongClasses] of Object.entries(perSemester)) {
    if (wrongClasses.length === 0) continue
    const q = supabase.from('timetables').delete().eq('semester_id', Number(semId)).in('class_id', wrongClasses)
    const { data, error } = await q.select('schedule_id') as any
    if (error) { console.error(`sem ${semId} error:`, error.message); continue }
    const deleted = Array.isArray(data) ? data.length : 0
    total += deleted
    console.log(`${dryRun ? '[DRY-RUN]' : '[APPLY ]'} sem ${semId}: delete ${wrongClasses.length} classes -> ${deleted} rows`)
  }
  console.log(`TOTAL ${dryRun ? 'would delete (dry run)' : 'deleted'}: ${total}`)
}
main().then(() => process.exit(0))