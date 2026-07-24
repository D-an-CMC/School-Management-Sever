import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

export class TimetableService {
async findMany(params: { teacherId?: number; classId?: number; semesterId?: number; page?: number; limit?: number }) {
const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

let q = supabase.from('timetables').select('*, subjects(*), classes(*)', { count: 'exact' });

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
const result = await supabase
.from('subjects')
.select('*')
.order('subject_name');

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}

return success(result.data ?? []);
}

async semesters() {
const result = await supabase
.from('semesters')
.select('*, school_year:school_years(*)')
.order('semester_id');

if (result.error) {
return error(result.error.message, 'DB_ERROR');
}

return success(result.data ?? []);
}
}

export const timetableService = new TimetableService();
