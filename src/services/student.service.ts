import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

export class StudentService {
  async findMany(params: { search?: string; classId?: number; page?: number; limit?: number }) {
    const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

    let q = supabase.from('students').select('*', { count: 'exact' });

    if (params.search) {
      q = q.or(`full_name.ilike.%${params.search}%,student_code.ilike.%${params.search}%`);
    }
    if (params.classId) {
      q = q.eq('class_id', params.classId);
    }

    const result = await q.order('full_name').range(offset, offset + limit);

    if (result.error || !result.data) {
      return error(result.error?.message || 'DB error', 'DB_ERROR');
    }

    const rows = result.data ?? [];
    const enriched = await Promise.all(rows.map(async (s: any) => {
      let email = '', phone = '', className = '';
      if (s.user_id) {
        const { data: u } = await supabase.from('users').select('email, phone').eq('user_id', s.user_id).maybeSingle();
        if (u) { email = u.email || ''; phone = u.phone || ''; }
      }
      if (s.class_id) {
        const { data: c } = await supabase.from('classes').select('class_name, grade_level').eq('class_id', s.class_id).maybeSingle();
        if (c) { className = c.class_name || ''; if (c.grade_level) s.grade_level = c.grade_level; }
      }
      return { ...s, email, phone, class_name: className, grade_level: s.grade_level, status: 'active' };
    }));

    return {
      success: true as const,
      ...paginate(enriched, result.count ?? 0, params.page, params.limit),
    };
  }

  async findById(id: number) {
    const result = await supabase.from('students').select('*').eq('student_id', id).single();

    if (result.error || !result.data) {
      return error('Không tìm thấy học sinh', 'NOT_FOUND');
    }

    return success(result.data);
  }

  async getStats() {
    const { count: totalStudents } = await supabase.from('students').select('*', { count: 'exact', head: true });
    return success({ totalStudents: totalStudents ?? 0, activeStudents: totalStudents ?? 0 });
  }

  async getStatsByGrade() {
    const { data, error: dbError } = await supabase
      .from('students')
      .select('student_id, class_id, classes(grade_level, class_name)');

    if (dbError) return error(dbError.message, 'DB_ERROR');

    const gradeStats: Record<number, { total: number; active: number }> = {};

    for (const s of (data ?? [])) {
      const gl = (s as any).classes?.grade_level;
      if (!gl) continue;
      if (!gradeStats[gl]) gradeStats[gl] = { total: 0, active: 0 };
      gradeStats[gl].total += 1;
      gradeStats[gl].active += 1;
    }

    const grades = Object.entries(gradeStats)
      .map(([grade_level, counts]) => ({
        grade_level: Number(grade_level),
        total: counts.total,
        active: counts.active,
      }))
      .sort((a, b) => a.grade_level - b.grade_level);

    const { count: totalAll } = await supabase.from('students').select('*', { count: 'exact', head: true });

    return success({
      total: totalAll ?? 0,
      grades,
    });
  }

  async getAttendanceStats() {
    const { data } = await supabase
      .from('students')
      .select('student_id, class_id, classes(grade_level)');

    const gradeStats: Record<number, { total: number; present: number }> = {};

    for (const s of (data ?? [])) {
      const gl = (s as any).classes?.grade_level;
      if (!gl) continue;
      if (!gradeStats[gl]) gradeStats[gl] = { total: 0, present: 0 };
      gradeStats[gl].total += 1;
      gradeStats[gl].present += 1;
    }

    const grades = Object.entries(gradeStats)
      .map(([grade_level, counts]) => ({
        grade_level: Number(grade_level),
        total: counts.total,
        present: counts.present,
        percent: counts.total > 0 ? `${((counts.present / counts.total) * 100).toFixed(1)}%` : '0%',
      }))
      .sort((a, b) => a.grade_level - b.grade_level);

    const totalAll = grades.reduce((sum: number, g: any) => sum + g.total, 0);
    const presentAll = grades.reduce((sum: number, g: any) => sum + g.present, 0);

    return success({
      total: totalAll,
      present: presentAll,
      grades,
    });
  }
}

export const studentService = new StudentService();
