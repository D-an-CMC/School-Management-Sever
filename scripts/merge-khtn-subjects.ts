import 'dotenv/config'
import { supabase } from '../src/config/supabase'

// Gop 3 mon KHTN (Sinh=5, Ly=6, Hoa=7) -> KHTN (17)
// - timetables: subject_id 5/6/7 -> 17, gan custom_subject_name + custom_teacher_name (giu teacher_id)
// - teachers: subject_id 5/6/7 -> 17
// - subjects: xoa id 5,6,7
const SUBJECT_LABELS: Record<number, string> = {
  5: 'KHTN Sinh',
  6: 'KHTN Lý',
  7: 'KHTN Hóa',
}
const KHTN_ID = 17

async function fetchAll(table: string, select: string) {
  let all: any[] = []
  const PAGE = 1000
  for (let start = 0; start < 100000; start += PAGE) {
    const { data, error } = await supabase.from(table).select(select).range(start, start + PAGE - 1)
    if (error) throw new Error(`${table} fetch: ${error.message}`)
    all = all.concat(data || [])
    if ((data || []).length < PAGE) break
  }
  return all
}

async function main() {
  const affected = [5, 6, 7]

  // --- 1. timetables: doc cac dong KHTN tach ---
  const tts = await fetchAll('timetables', 'schedule_id,subject_id,teacher_id')
  const toFix = tts.filter((r) => affected.includes(Number(r.subject_id)))
  console.log(`timetables KHTN tach: ${toFix.length} rows`)

  // teacher_id -> full_name (de gan custom_teacher_name)
  const teachers = await fetchAll('teachers', 'teacher_id,full_name,subject_id')
  const teacherName = new Map<number, string>()
  teachers.forEach((t) => teacherName.set(Number(t.teacher_id), t.full_name || ''))

  let updated = 0
  for (const row of toFix) {
    const sid = Number(row.subject_id)
    const label = SUBJECT_LABELS[sid]
    const teacher = row.teacher_id ? teacherName.get(Number(row.teacher_id)) : null
    const { error } = await supabase
      .from('timetables')
      .update({
        subject_id: KHTN_ID,
        custom_subject_name: label,
        ...(teacher ? { custom_teacher_name: teacher } : {}),
      })
      .eq('schedule_id', row.schedule_id)
    if (error) {
      console.error(`  loi cap nhat schedule_id=${row.schedule_id}: ${error.message}`)
    } else {
      updated++
    }
  }
  console.log(`timetables updated: ${updated}/${toFix.length}`)

  // --- 2. teachers: gan subject_id 5/6/7 -> 17 ---
  const tToFix = teachers.filter((t) => affected.includes(Number(t.subject_id)))
  for (const t of tToFix) {
    const { error } = await supabase.from('teachers').update({ subject_id: KHTN_ID }).eq('teacher_id', t.teacher_id)
    if (error) console.error(`  loi update teacher ${t.teacher_id}: ${error.message}`)
  }
  console.log(`teachers updated: ${tToFix.length}`)

  // --- 3. subjects: xoa 5,6,7 ---
  for (const sid of affected) {
    const { error } = await supabase.from('subjects').delete().eq('subject_id', sid)
    if (error) console.error(`  loi xoa subject ${sid}: ${error.message}`)
  }
  console.log(`subjects deleted: ${affected.join(', ')}`)

  // --- verify ---
  const remain = await fetchAll('timetables', 'subject_id')
  const still = remain.filter((r) => affected.includes(Number(r.subject_id))).length
  console.log(`verify: timetables con tro 5/6/7 = ${still}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e)
    process.exit(1)
  })
