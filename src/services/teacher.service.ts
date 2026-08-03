import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

export class TeacherService {
  async findMany(params: { search?: string; subjectId?: number; page?: number; limit?: number }) {
    const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

    let q = supabase.from('teachers').select('*', { count: 'exact' });

    if (params.subjectId) {
      q = q.eq('subject_id', params.subjectId);
    }
    if (params.search) {
      q = q.or(`full_name.ilike.%${params.search}%,teacher_code.ilike.%${params.search}%`);
    }

    const result = await q.order('full_name').range(offset, offset + limit);

    if (result.error) {
      return error(result.error.message, 'DB_ERROR');
    }

    const allSubjects = await supabase.from('subjects').select('subject_id, subject_name');
    const subjectMap = new Map((allSubjects.data || []).map((s: any) => [s.subject_id, s.subject_name]));

    const teachers = await Promise.all((result.data ?? []).map(async (t: any) => {
      let email = '';
      let homeroomClassName = '';
      if (t.user_id) {
        const { data: u } = await supabase.from('users').select('email').eq('user_id', t.user_id).maybeSingle();
        if (u) email = u.email || '';
      }
      if (t.teacher_id) {
        const { data: cls } = await supabase.from('classes').select('class_name').eq('homeroom_teacher_id', t.teacher_id).maybeSingle();
        if (cls) homeroomClassName = cls.class_name || '';
      }
      return {
        ...t,
        email,
        status: 'active',
        date_of_birth: t.date_of_birth || null,
        homeroom_class_name: homeroomClassName,
        subject: subjectMap.get(t.subject_id) || null
      };
    }));

    return {
      success: true as const,
      ...paginate(teachers, result.count ?? 0, params.page, params.limit),
    };
  }

  async findById(id: number) {
    const result = await supabase.from('teachers').select('*').eq('teacher_id', id).single();

    if (result.error || !result.data) {
      return error('Không tìm thấy giáo viên', 'NOT_FOUND');
    }

    return success(result.data);
  }

  async getStats() {
    const { count: totalTeachers } = await supabase.from('teachers').select('*', { count: 'exact', head: true });
    return success({
      totalTeachers: totalTeachers ?? 0,
      activeTeachers: totalTeachers ?? 0,
      offDutyTeachers: 0,
    });
  }

  async getSubjects(teacherId: number) {
    const { data, error: dbError } = await supabase
      .from('teaching_assignments')
      .select('subject_id, subjects!inner(subject_id, subject_name, subject_code)')
      .eq('teacher_id', teacherId);

    const seen = new Set<number>();
    const subjects: any[] = [];
    (data ?? []).forEach((row: any) => {
      const s = row.subjects;
      if (!s?.subject_id || seen.has(s.subject_id)) return;
      seen.add(s.subject_id);
      subjects.push({
        subject_id: s.subject_id,
        subject_code: s.subject_code,
        subject_name: s.subject_name,
      });
    });

    const { data: tRecord } = await supabase
      .from('teachers')
      .select('subject_id, subjects(subject_id, subject_name, subject_code)')
      .eq('teacher_id', teacherId)
      .maybeSingle();

    if (tRecord?.subject_id && !seen.has(tRecord.subject_id)) {
      const s = (tRecord as any).subjects;
      if (s) {
        subjects.push({
          subject_id: s.subject_id,
          subject_code: s.subject_code,
          subject_name: s.subject_name,
        });
      }
    }

    return success(subjects);
  }
}

export const teacherService = new TeacherService();
