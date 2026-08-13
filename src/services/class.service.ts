import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

export class ClassService {
 async findMany(params: { teacherId?: number; schoolYearId?: number; page?: number; limit?: number }) {
 const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

 let q = supabase.from('classes').select('*', { count: 'exact' });

 if (params.teacherId) {
 q = q.eq('homeroom_teacher_id', params.teacherId);
 }

 // Default to the current school year unless explicitly requested (all).
 if (params.schoolYearId !== undefined) {
 if (params.schoolYearId === -1) {
   // -1 = no filter (all years). keep as-is.
 } else {
   q = q.eq('school_year_id', params.schoolYearId);
 }
 } else {
 const { data: currentYear } = await supabase
   .from('school_years')
   .select('school_year_id')
   .eq('is_current', true)
   .maybeSingle();
 if (currentYear) {
   q = q.eq('school_year_id', currentYear.school_year_id);
 }
 }

 const result = await q.order('class_name').range(offset, offset + limit);

 if (result.error) {
 return error(result.error.message, 'DB_ERROR');
 }

 const classes = result.data ?? [];
 const enriched = await Promise.all(classes.map(async (c: any) => {
 const { count: studentCount } = await supabase
 .from('students')
 .select('*', { count: 'exact', head: true })
 .eq('class_id', c.class_id);

 let teacherName = '';
 if (c.homeroom_teacher_id) {
 const { data: t } = await supabase
 .from('teachers')
 .select('full_name')
 .eq('teacher_id', c.homeroom_teacher_id)
 .maybeSingle();
 if (t) teacherName = t.full_name;
 }

 const gradeMap: Record<number, string> = { 6: 'Khối 6', 7: 'Khối 7', 8: 'Khối 8', 9: 'Khối 9' };

 return {
 ...c,
 student_count: studentCount ?? 0,
 homeroom_teacher_name: teacherName,
 grade_name: gradeMap[c.grade_level] || `Khối ${c.grade_level}`,
 };
 }));

 return {
 success: true as const,
 ...paginate(enriched, result.count ?? 0, params.page, params.limit),
 };
 }

 async findById(classId: number) {
 const { data, error: dbError } = await supabase
 .from('classes')
 .select('*')
 .eq('class_id', classId)
 .single();

 if (dbError || !data) {
 return error('Không tìm thấy lớp học', 'NOT_FOUND');
 }

 const studentsResult = await supabase
 .from('students')
 .select('student_id, student_code, full_name, gender, date_of_birth')
 .eq('class_id', classId)
 .order('full_name');

 return success({
 ...data,
 students: studentsResult.data ?? [],
 });
 }

 async getStudents(classId: number) {
 const result = await supabase
 .from('students')
 .select('*')
 .eq('class_id', classId)
 .order('full_name');

 if (result.error) {
 return error(result.error.message, 'DB_ERROR');
 }

 return success(result.data ?? []);
 }

 async getGradeStats(schoolYearId?: number) {
 let classQuery = supabase.from('classes').select('class_id, grade_level, school_year_id');
 if (schoolYearId) {
   classQuery = classQuery.eq('school_year_id', schoolYearId);
 }
 const { data: classes, error: classError } = await classQuery;

 if (classError) return error(classError.message, 'DB_ERROR');

 const { data: students, error: studentError } = await supabase
 .from('students')
 .select('student_id, class_id');

 if (studentError) return error(studentError.message, 'DB_ERROR');

 const classGradeMap = new Map<number, number>();
 (classes || []).forEach((c: any) => {
 if (c.class_id != null && c.grade_level != null) classGradeMap.set(c.class_id, c.grade_level);
 });

 const gradeMap = new Map<number, { class_count: number; student_count: number }>();
 (classes || []).forEach((c: any) => {
 const gl = c.grade_level;
 if (gl == null) return;
 if (!gradeMap.has(gl)) gradeMap.set(gl, { class_count: 0, student_count: 0 });
 gradeMap.get(gl)!.class_count++;
 });

 (students || []).forEach((s: any) => {
 const gl = classGradeMap.get(s.class_id);
 if (gl == null) return;
 gradeMap.get(gl)!.student_count++;
 });

 const result = Array.from(gradeMap.entries())
 .map(([grade_level, stats]) => ({ grade_level, ...stats }))
 .sort((a: any, b: any) => a.grade_level - b.grade_level);

 return success(result);
 }

  async update(classId: number, data: { homeroom_teacher_id?: number | null; class_name?: string; grade_level?: number; fixed_room_id?: number | null }) {
    const updateData: any = {};
    if ('homeroom_teacher_id' in data) updateData.homeroom_teacher_id = data.homeroom_teacher_id;
    if ('class_name' in data) updateData.class_name = data.class_name;
    if ('grade_level' in data) updateData.grade_level = data.grade_level;
    if ('fixed_room_id' in data) updateData.fixed_room_id = data.fixed_room_id ?? null;

    const { data: updated, error: dbError } = await supabase
      .from('classes')
      .update(updateData)
      .eq('class_id', classId)
      .select('*')
      .single();

    if (dbError) {
      return error(dbError.message, 'DB_ERROR');
    }

    return success(updated);
  }

  async addStudent(classId: number, studentData: { full_name?: string; student_code?: string; gender?: string; date_of_birth?: string; student_id?: number }) {
    // Lấy lớp để biết school_year_id + grade_level.
    const { data: cls } = await supabase.from('classes').select('school_year_id, grade_level').eq('class_id', classId).maybeSingle();

    if (studentData.student_id) {
      const { data: updated, error: dbError } = await supabase
        .from('students')
        .update({ class_id: classId })
        .eq('student_id', studentData.student_id)
        .select('*')
        .single();
      if (dbError) return error(dbError.message, 'DB_ERROR');

      // Lưu lịch sử phân lớp (upsert theo student + school_year).
      if (cls?.school_year_id) {
        await this.upsertEnrollment(studentData.student_id, classId, cls.school_year_id, cls.grade_level, 'ACTIVE');
      }
      return success(updated);
    }

    const { data: created, error: dbError } = await supabase
      .from('students')
      .insert({
        class_id: classId,
        full_name: studentData.full_name,
        student_code: studentData.student_code,
        gender: studentData.gender,
        date_of_birth: studentData.date_of_birth || null,
      })
      .select('*')
      .single();

    if (dbError) return error(dbError.message, 'DB_ERROR');

    if (cls?.school_year_id && created) {
      await this.upsertEnrollment(created.student_id, classId, cls.school_year_id, cls.grade_level, 'ACTIVE');
    }
    return success(created);
  }

  private async upsertEnrollment(studentId: number, classId: number, schoolYearId: number, gradeLevel: number | null, status: string) {
    const { data: existing } = await supabase
      .from('student_class_enrollments')
      .select('enrollment_id')
      .eq('student_id', studentId)
      .eq('school_year_id', schoolYearId)
      .maybeSingle();

    const payload = { student_id: studentId, class_id: classId, school_year_id: schoolYearId, grade_level: gradeLevel, status };
    if (existing) {
      await supabase.from('student_class_enrollments').update(payload).eq('enrollment_id', existing.enrollment_id);
    } else {
      await supabase.from('student_class_enrollments').insert(payload);
    }
  }

  async removeStudent(classId: number, studentId: number) {
    const { data: updated, error: dbError } = await supabase
      .from('students')
      .update({ class_id: null })
      .eq('student_id', studentId)
      .select('*')
      .single();

    if (dbError) return error(dbError.message, 'DB_ERROR');
    return success(updated);
  }

  async create(data: { class_name: string; grade_level?: number; school_year_id?: number; homeroom_teacher_id?: number | null }) {
    if (!data.class_name || !String(data.class_name).trim()) {
      return error('Tên lớp không được để trống', 'VALIDATION_ERROR');
    }

    // Default to the current school year unless provided.
    let schoolYearId = data.school_year_id;
    if (!schoolYearId) {
      const { data: currentYear } = await supabase
        .from('school_years')
        .select('school_year_id')
        .eq('is_current', true)
        .maybeSingle();
      schoolYearId = currentYear?.school_year_id ?? null;
    }

    const { data: created, error: dbError } = await supabase
      .from('classes')
      .insert({
        class_name: String(data.class_name).trim(),
        grade_level: data.grade_level ?? null,
        school_year_id: schoolYearId ?? null,
        homeroom_teacher_id: data.homeroom_teacher_id ?? null,
      })
      .select('*')
      .single();

    if (dbError) return error(dbError.message, 'DB_ERROR');
    return success(created);
  }

  async remove(classId: number) {
    const { count: studentCount } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', classId);

    if ((studentCount ?? 0) > 0) {
      return error('Không thể xóa lớp vì vẫn còn học sinh', 'CLASS_NOT_EMPTY');
    }

    const { error: dbError } = await supabase.from('classes').delete().eq('class_id', classId);
    if (dbError) return error(dbError.message, 'DB_ERROR');
    return success(true);
  }
}

export const classService = new ClassService();
