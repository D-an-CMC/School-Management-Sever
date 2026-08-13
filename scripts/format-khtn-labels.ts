import 'dotenv/config'
import { supabase } from '../src/config/supabase'

// Doi custom_subject_name cua cac dong KHTN thanh dinh dang 'KHTN - Sinh/Ly/Hoa'
const MAP: Record<string, string> = {
  'KHTN Sinh': 'KHTN - Sinh',
  'KHTN Lý': 'KHTN - Lý',
  'KHTN Hóa': 'KHTN - Hóa',
  'KHTN Sinh ': 'KHTN - Sinh',
  'KHTN Lý ': 'KHTN - Lý',
  'KHTN Hóa ': 'KHTN - Hóa',
}

async function main() {
  for (const [from, to] of Object.entries(MAP)) {
    const { error, count } = await supabase
      .from('timetables')
      .update({ custom_subject_name: to })
      .eq('custom_subject_name', from)
      .select('schedule_id')
    if (error) {
      console.error(`loi doi '${from}': ${error.message}`)
    } else {
      console.log(`'${from}' -> '${to}': ${count ?? 0} rows`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e)
    process.exit(1)
  })
