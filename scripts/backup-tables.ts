import 'dotenv/config'
import { writeFileSync, mkdirSync, appendFileSync } from 'fs'
import { supabase } from '../src/config/supabase'

async function main() {
  const dir = 'C:/Users/phucn/Desktop/School-Management-Sever/scripts/backup'
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  let all: any[] = []
  const PAGE = 1000
  for (let start = 0; start < 100000; start += PAGE) {
    const { data, error } = await supabase.from('timetables').select('*').range(start, start + PAGE - 1)
    if (error) { console.error('err', error.message); break }
    all = all.concat(data || [])
    if ((data || []).length < PAGE) break
    if (all.length % 10000 === 0) console.log('  fetched', all.length)
  }
  const f = `${dir}/timetables_FULL_${stamp}.json`
  writeFileSync(f, JSON.stringify(all, null, 2))
  console.log(`backup FULL timetables: ${all.length} rows -> ${f}`)
}
main().then(() => process.exit(0))