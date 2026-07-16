import { supabase } from '../config/supabase';
import { error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';
export class ActivityService {
    async findMany(params) {
        const offset = buildPagination({ page: params.page, limit: params.limit });
        let query = supabase.from('activities').select('*', { count: 'exact' });
        if (params.classId) {
            query = query.eq('class_id', params.classId);
        }
        if (params.semesterId) {
            query = query.eq('semester_id', params.semesterId);
        }
        const { data, count, error: qError } = await query
            .order('start_datetime', { ascending: false })
            .range(offset.offset, offset.offset + offset.limit - 1);
        if (qError) {
            return error(qError.message, 'DB_ERROR');
        }
        return {
            success: true,
            ...paginate(data || [], count || 0, params.page, params.limit),
        };
    }
}
export const activityService = new ActivityService();
//# sourceMappingURL=activity.service.js.map