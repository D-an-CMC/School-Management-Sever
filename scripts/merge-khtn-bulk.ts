import 'dotenv/config'
import { supabase } from '../src/config/supabase'

// Hoan tat gop 3 mon KHTN -> 17 bang bulk update (nhanh, tranh timeout khi update tung dong)
const MAP: Record<number, string> = { 5: 'KHTN Sinh', 6: 'KHTN Lý', 7: 'KHTN Hóa' }
const KHTN_ID = 17

async function main() {
  for (const [sid, label] of Object.entries(MAP)) {
    const num = Number(sid)
    // update cac dong con subject_id 5/6/7 (dong nao da gop roi thi khong bi anh huong)
    const { count, error } = await supabase
      .from('timetables')
      .update({ subject_id: KHTN_ID, custom_subject_name: label })
      .eq('subject_id', num)
      .select('schedule_id')
    if (error) {
      console.error(`  loi bulk update subject ${sid}: ${error.message}`)
    } else {
      console.log(`subject ${sid} -> ${KHTN_ID}: updated ${(count ?? 0)} rows`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e)
    process.exit(1)
  })
