import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';
export class ClassService {
    async findMany(params) {
        const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });
        let q = supabase.from('classes').select('*', { count: 'exact' });
        if (params.teacherId) {
            q = q.eq('homeroom_teacher_id', params.teacherId);
        }
        const result = await q.order('class_name').range(offset, offset + limit);
        if (result.error) {
            return error(result.error.message, 'DB_ERROR');
        }
        const classes = result.data ?? [];
        const enriched = await Promise.all(classes.map(async (c) => {
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
                if (t)
                    teacherName = t.full_name;
            }
            const gradeMap = { 6: 'Khối 6', 7: 'Khối 7', 8: 'Khối 8', 9: 'Khối 9' };
            return {
                ...c,
                student_count: studentCount ?? 0,
                homeroom_teacher_name: teacherName,
                grade_name: gradeMap[c.grade_level] || `Khối ${c.grade_level}`,
            };
        }));
        return {
            success: true,
            ...paginate(enriched, result.count ?? 0, params.page, params.limit),
        };
    }
    async findById(classId) {
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
    async getStudents(classId) {
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
    async getGradeStats() {
        const { data: classes, error: classError } = await supabase
            .from('classes')
            .select('class_id, grade_level');
        if (classError)
            return error(classError.message, 'DB_ERROR');
        const { data: students, error: studentError } = await supabase
            .from('students')
            .select('student_id, class_id');
        if (studentError)
            return error(studentError.message, 'DB_ERROR');
        const classGradeMap = new Map();
        (classes || []).forEach((c) => {
            if (c.class_id != null && c.grade_level != null)
                classGradeMap.set(c.class_id, c.grade_level);
        });
        const gradeMap = new Map();
        (classes || []).forEach((c) => {
            const gl = c.grade_level;
            if (gl == null)
                return;
            if (!gradeMap.has(gl))
                gradeMap.set(gl, { class_count: 0, student_count: 0 });
            gradeMap.get(gl).class_count++;
        });
        (students || []).forEach((s) => {
            const gl = classGradeMap.get(s.class_id);
            if (gl == null)
                return;
            gradeMap.get(gl).student_count++;
        });
        const result = Array.from(gradeMap.entries())
            .map(([grade_level, stats]) => ({ grade_level, ...stats }))
            .sort((a, b) => a.grade_level - b.grade_level);
        return success(result);
    }
}
export const classService = new ClassService();
//# sourceMappingURL=class.service.js.map