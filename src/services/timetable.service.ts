import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

export class TimetableService {
async findMany(params: { teacherId?: number; classId?: number; semesterId?: number; page?: number; limit?: number }) {
const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

let q = supabase.from('timetables').select('*, subjects(*), classes(*), teachers(*)', { count: 'exact' });

if (params.teacherId) {
q = q.eq('teacher_id', params.teacherId);
}
if (params.classId) {
q = q.eq('class_id', params.classId);
}
if (params.semesterId) {
q = q.eq('semester_id', params.semesterId);
}

const result = await q.order('day_of_week').range(offset, offset + limit);

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}

// Keep raw data - day_of_week stored as text numbers in DB
// Frontend handles conversion via serverDayToFront()
return {
success: true as const,
...paginate(result.data ?? [], result.count ?? 0, params.page, params.limit),
};
}

async examSchedules(params: { classId?: number; semesterId?: number }) {
let q = supabase.from('exam_schedules').select('*');

if (params.classId) q = q.eq('class_id', params.classId);
if (params.semesterId) q = q.eq('semester_id', params.semesterId);

const result = await q.order('exam_date');

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}

return success(result.data ?? []);
}

async create(data: { classId: number; subjectId: number; teacherId?: number; semesterId: number; dayOfWeek: string; periodNo?: number; startTime?: string; endTime?: string; room?: string }) {
const periodNo = data.periodNo
const insert: Record<string, any> = {
class_id: data.classId,
subject_id: data.subjectId,
semester_id: data.semesterId,
day_of_week: data.dayOfWeek,
};
if (periodNo) insert.period_no = periodNo;
if (data.teacherId) insert.teacher_id = data.teacherId;
if (data.startTime) insert.start_time = data.startTime;
if (data.endTime) insert.end_time = data.endTime;
if (data.room) insert.room = data.room;

// Remove any duplicate entries for this slot first, then insert
if (periodNo) {
await supabase
.from('timetables')
.delete()
.eq('class_id', data.classId)
.eq('day_of_week', data.dayOfWeek)
.eq('period_no', periodNo);
}

const result = await supabase
.from('timetables')
.insert(insert)
.select('*, subjects(*), classes(*)');

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}
return success(result.data ?? null);
}

async remove(id: number) {
const lookup = await supabase
.from('timetables')
.select('class_id, day_of_week, period_no')
.eq('schedule_id', id)
.maybeSingle();

if (lookup.error) {
return error(lookup.error.message, 'DB_ERROR');
}

const entry = lookup.data;
if (!entry) {
return error('Entry not found', 'DB_ERROR');
}

// Delete ALL entries for this slot — handles duplicate seed data
const result = await supabase
.from('timetables')
.delete()
.eq('class_id', entry.class_id)
.eq('day_of_week', entry.day_of_week)
.eq('period_no', entry.period_no);

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}
return success(result.data ?? null);
}

async subjects() {
let result = await supabase
.from('subjects')
.select('*')
.order('subject_name');

if (result.error || !result.data || result.data.length === 0) {
  const defaultSubs = [
    { subject_code: 'TOAN', subject_name: 'Toán học' },
    { subject_code: 'VAN', subject_name: 'Ngữ văn' },
    { subject_code: 'ENG', subject_name: 'Tiếng Anh' },
    { subject_code: 'LY', subject_name: 'Vật lý' },
    { subject_code: 'HOA', subject_name: 'Hóa học' },
    { subject_code: 'SINH', subject_name: 'Sinh học' },
    { subject_code: 'SU', subject_name: 'Lịch sử' },
    { subject_code: 'DIA', subject_name: 'Địa lý' },
    { subject_code: 'TIN', subject_name: 'Tin học' },
    { subject_code: 'TD', subject_name: 'Thể dục' },
    { subject_code: 'GDCD', subject_name: 'GDCD' },
    { subject_code: 'MT', subject_name: 'Mỹ thuật' },
    { subject_code: 'AN', subject_name: 'Âm nhạc' },
    { subject_code: 'CC', subject_name: 'Chào cờ' },
    { subject_code: 'SH', subject_name: 'Sinh hoạt lớp' },
  ];
  await supabase.from('subjects').insert(defaultSubs);
  result = await supabase.from('subjects').select('*').order('subject_name');
}

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}

return success(result.data ?? []);
}

async semesters() {
let result = await supabase
.from('semesters')
.select('*, school_year:school_years(*)')
.order('semester_id');

if (result.error || !result.data || result.data.length === 0) {
  let { data: sy } = await supabase.from('school_years').select('school_year_id').limit(1);
  let syId = sy && sy.length > 0 ? sy[0].school_year_id : null;

  if (!syId) {
    const { data: newSy } = await supabase.from('school_years').insert({
      year_name: '2023-2024',
      start_date: '2023-09-05',
      end_date: '2024-05-31',
    }).select('school_year_id').maybeSingle();
    syId = newSy?.school_year_id || 1;
  }

  await supabase.from('semesters').insert([
    { semester_name: 'Học kỳ I - 2023-2024', school_year_id: syId, is_active: true },
    { semester_name: 'Học kỳ II - 2023-2024', school_year_id: syId, is_active: false },
  ]);

  result = await supabase
    .from('semesters')
    .select('*, school_year:school_years(*)')
    .order('semester_id');
}

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}

return success(result.data ?? []);
}

async bulkCreate(entries: Array<{ classId: number; subjectId: number; teacherId?: number; semesterId?: number; dayOfWeek: string; periodNo?: number; room?: string }>) {
  if (!entries || entries.length === 0) {
    return success(true);
  }

  // Ensure subjects exist in DB
  const subResult = await this.subjects();
  const dbSubjects = subResult.success ? subResult.data : [];
  const validSubjectIds = new Set(dbSubjects.map((s: any) => s.subject_id));
  const fallbackSubjectId = dbSubjects.length > 0 ? dbSubjects[0].subject_id : 1;

  // Fetch valid teacher_ids from DB
  const { data: teachers } = await supabase.from('teachers').select('teacher_id');
  const validTeacherIds = new Set((teachers || []).map((t: any) => t.teacher_id));

  // Ensure semesters exist in DB and fetch a valid semester_id
  const semResult = await this.semesters();
  const dbSemesters = semResult.success ? semResult.data : [];
  const defaultSemesterId = dbSemesters.length > 0 ? dbSemesters[0].semester_id : 1;

  const classIds = Array.from(new Set(entries.map(e => e.classId).filter(Boolean)));
  if (classIds.length > 0) {
    const { error: delErr } = await supabase.from('timetables').delete().in('class_id', classIds);
    if (delErr) {
      console.error('Bulk timetable delete error:', delErr);
    }
  }

  const rows = entries.map(e => {
    const sId = validSubjectIds.has(e.subjectId) ? e.subjectId : fallbackSubjectId;
    const tId = e.teacherId && validTeacherIds.has(e.teacherId) ? e.teacherId : null;

    const row: Record<string, any> = {
      class_id: e.classId,
      subject_id: sId,
      semester_id: defaultSemesterId,
      day_of_week: String(e.dayOfWeek),
      period_no: e.periodNo || 1,
      room: e.room || 'P.101',
    };
    if (tId) row.teacher_id = tId;
    return row;
  });

  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error: err } = await supabase.from('timetables').insert(batch);
    if (err) {
      console.error('Bulk timetable insert error:', err);
      return error(err.message, 'DB_ERROR');
    }
  }

  return success(true);
}
}

export const timetableService = new TimetableService();

