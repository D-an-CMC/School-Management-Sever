import 'dotenv/config'
import { supabase } from '../src/config/supabase'

// Hoan tat: teachers subject_id 5/6/7 -> 17, xoa subjects 5/6/7
const affected = [5, 6, 7]
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
  const teachers = await fetchAll('teachers', 'teacher_id,subject_id')
  const tToFix = teachers.filter((t) => affected.includes(Number(t.subject_id)))
  for (const t of tToFix) {
    const { error } = await supabase.from('teachers').update({ subject_id: KHTN_ID }).eq('teacher_id', t.teacher_id)
    if (error) console.error(`  loi update teacher ${t.teacher_id}: ${error.message}`)
  }
  console.log(`teachers updated (5/6/7 -> 17): ${tToFix.length}`)

  for (const sid of affected) {
    const { error } = await supabase.from('subjects').delete().eq('subject_id', sid)
    if (error) console.error(`  loi xoa subject ${sid}: ${error.message}`)
  }
  console.log(`subjects deleted: ${affected.join(', ')}`)

  const remain = await fetchAll('subjects', 'subject_id')
  console.log(`subjects con lai: ${remain.length}`)
  remain.forEach((s) => console.log(`  ${s.subject_id}`))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e)
    process.exit(1)
  })
