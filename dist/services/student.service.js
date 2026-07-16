import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';
export class StudentService {
    async findMany(params) {
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
        const enriched = await Promise.all(rows.map(async (s) => {
            let email = '', phone = '', className = '';
            if (s.user_id) {
                const { data: u } = await supabase.from('users').select('email, phone').eq('user_id', s.user_id).maybeSingle();
                if (u) {
                    email = u.email || '';
                    phone = u.phone || '';
                }
            }
            if (s.class_id) {
                const { data: c } = await supabase.from('classes').select('class_name').eq('class_id', s.class_id).maybeSingle();
                if (c)
                    className = c.class_name || '';
            }
            return { ...s, email, phone, class_name: className, status: 'active' };
        }));
        return {
            success: true,
            ...paginate(enriched, result.count ?? 0, params.page, params.limit),
        };
    }
    async findById(id) {
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
}
export const studentService = new StudentService();
//# sourceMappingURL=student.service.js.map