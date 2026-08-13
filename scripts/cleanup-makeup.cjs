#!/usr/bin/env node
/**
 * One-off cleanup: removes the "Học bù" (makeup) data that is auto-generated when
 * an exam is created. It deletes:
 *   1. the displaced makeup timetable rows (referenced by makeup_schedule_id), and
 *   2. the exam_makeup records themselves.
 *
 * Usage:  node scripts/cleanup-makeup.cjs
 * (runs in dry-run mode unless --apply is passed)
 */

const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const apply = process.argv.includes('--apply');

  const { data: makeup, error: err } = await supabase
    .from('exam_makeup')
    .select('makeup_id, makeup_schedule_id, class_id, note');

  if (err) throw new Error('Fetch exam_makeup failed: ' + err.message);

  const scheduleIds = [...new Set((makeup || []).map((m) => m.makeup_schedule_id).filter(Boolean))];

  console.log(`[cleanup-makeup] ${makeup ? makeup.length : 0} makeup records, ${scheduleIds.length} displaced timetable rows`);

  if (!apply) {
    console.log('[cleanup-makeup] DRY-RUN — pass --apply to actually delete.');
    return;
  }

  if (scheduleIds.length > 0) {
    const { error: delT } = await supabase
      .from('timetables')
      .delete()
      .in('schedule_id', scheduleIds);
    if (delT) throw new Error('Delete timetable rows failed: ' + delT.message);
    console.log(`[cleanup-makeup] Deleted ${scheduleIds.length} timetable rows`);
  }

  const { error: delM } = await supabase.from('exam_makeup').delete().neq('makeup_id', -1);
  if (delM) throw new Error('Delete exam_makeup failed: ' + delM.message);
  console.log(`[cleanup-makeup] Deleted ${makeup ? makeup.length : 0} exam_makeup records`);
}

main().catch((e) => {
  console.error('[cleanup-makeup] FAILED:', e.message);
  process.exit(1);
});