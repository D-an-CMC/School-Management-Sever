import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

export class TimetableService {
  async findMany(params: { teacherId?: number; classId?: number; page?: number; limit?: number }) {
    const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

    let q = supabase.from('timetables').select('*', { count: 'exact' });

    if (params.teacherId) {
      q = q.eq('teacher_id', params.teacherId);
    }
    if (params.classId) {
      q = q.eq('class_id', params.classId);
    }

    const result = await q.order('day_of_week').range(offset, offset + limit);

    if (result.error) {
      return error(result.error.message, 'DB_ERROR');
    }

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
