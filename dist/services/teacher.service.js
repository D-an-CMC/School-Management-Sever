import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';
export class TeacherService {
    async findMany(params) {
        const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });
        let q = supabase.from('teachers').select('*', { count: 'exact' });
        if (params.search) {
            q = q.or(`full_name.ilike.%${params.search}%,teacher_code.ilike.%${params.search}%`);
        }
        const result = await q.order('full_name').range(offset, offset + limit);
        if (result.error) {
            return error(result.error.message, 'DB_ERROR');
        }
        const teachers = await Promise.all((result.data ?? []).map(async (t) => {
            let email = '';
            let homeroomClassName = '';
            if (t.user_id) {
                const { data: u } = await supabase.from('users').select('email').eq('user_id', t.user_id).maybeSingle();
                if (u)
                    email = u.email || '';
            }
            if (t.teacher_id) {
                const { data: cls } = await supabase.from('classes').select('class_name').eq('homeroom_teacher_id', t.teacher_id).maybeSingle();
                if (cls)
                    homeroomClassName = cls.class_name || '';
            }
            return { ...t, email, status: 'active', date_of_birth: t.date_of_birth || null, homeroom_class_name: homeroomClassName };
        }));
        return {
            success: true,
            ...paginate(teachers, result.count ?? 0, params.page, params.limit),
        };
    }
    async findById(id) {
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
}
export const teacherService = new TeacherService();
//# sourceMappingURL=teacher.service.js.map