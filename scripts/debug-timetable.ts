import 'dotenv/config'
import { supabase } from '../src/config/supabase'

async function main() {
  // semester 11 -> school_year_id 6 -> classes year 6 = 40..51
  const { data: sem } = await supabase.from('semesters').select('semester_id, semester_name, school_year_id').eq('semester_id', 11).maybeSingle()
  console.log('semester 11 -> school_year_id =', sem?.school_year_id)

  // classes of year 6
  const { data: y6 } = await supabase.from('classes').select('class_id').eq('school_year_id', 6)
  const y6ids = new Set((y6 || []).map((c: any) => c.class_id))
  console.log('classes of year 6:', [...y6ids].sort((a,b)=>a-b).join(','))

  // distinct classes in timetables sem 11
  const { data: tt } = await supabase.from('timetables').select('class_id').eq('semester_id', 11)
  const ttCls = new Set((tt || []).map((r: any) => r.class_id))
  const inYear6 = [...ttCls].filter((c) => y6ids.has(c))
  const notYear6 = [...ttCls].filter((c) => !y6ids.has(c))
  console.log('timetables sem11 distinct classes:', ttCls.size)
  console.log('  -> classes thuộc year 6:', inYear6.length, JSON.stringify(inYear6.sort((a,b)=>a-b)))
  console.log('  -> classes KHÔNG thuộc year 6:', notYear6.length, JSON.stringify(notYear6.sort((a,b)=>a-b)))
}
main().then(() => process.exit(0))