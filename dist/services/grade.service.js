import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
export class GradeService {
    async findByClass(classId) {
        const { data: students } = await supabase
            .from('students')
            .select('student_id, student_code, full_name')
            .eq('class_id', classId)
            .order('full_name');
        const { data: gradeItems } = await supabase
            .from('grade_items')
            .select('student_id, score, grade_type_id, grade_types(type_id, type_name)')
            .eq('class_id', classId);
        const gradesByStudent = new Map();
        (gradeItems || []).forEach((g) => {
            const sid = g.student_id;
            if (!gradesByStudent.has(sid))
                gradesByStudent.set(sid, []);
            gradesByStudent.get(sid).push({
                grade_type_name: g.grade_types?.type_name || '',
                score: g.score,
            });
        });
        const rows = (students || []).map((s) => ({
            student_id: s.student_id,
            student_code: s.student_code,
            full_name: s.full_name,
            grades: gradesByStudent.get(s.student_id) || [],
        }));
        return success(rows);
    }
    async gradeTypes() {
        const result = await supabase.from('grade_types').select('*').order('grade_type_id');
        if (result.error) {
            return error(result.error.message, 'DB_ERROR');
        }
        return success(result.data ?? []);
    }
    async updateGrade(gradeItemId, score) {
        const result = await supabase.from('grade_items').update({ score }).eq('grade_item_id', gradeItemId).select().single();
        if (result.error || !result.data) {
            return error('Cập nhật điểm thất bại', 'UPDATE_FAILED');
        }
        return success(result.data);
    }
    async batchUpdate(updates) {
        const results = [];
        for (const u of updates) {
            const r = await this.updateGrade(u.gradeItemId, u.score);
            results.push(r);
        }
        const failed = results.filter((r) => !r.success);
        if (failed.length > 0) {
            return error(`${failed.length} cập nhật thất bại`, 'BATCH_PARTIAL_FAILURE');
        }
        return success(results);
    }
}
export const gradeService = new GradeService();
//# sourceMappingURL=grade.service.js.map