import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

export class ActivityService {
  async findMany(params: { classId?: number; semesterId?: number; page?: number; limit?: number }) {
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
      success: true as const,
      ...paginate(data || [], count || 0, params.page, params.limit),
    };
  }

  async create(input: { activity_name: string; activity_type?: string; start_datetime: string; location?: string; description?: string }) {
    const result = await supabase
      .from('activities')
      .insert({
        activity_name: input.activity_name,
        activity_type: input.activity_type || 'Thông báo',
        start_datetime: input.start_datetime,
        location: input.location,
        description: input.description,
      })
      .select()
      .single();

    if (result.error || !result.data) {
      return error('Tạo hoạt động thất bại', 'CREATE_FAILED');
    }

    return success(result.data);
  }
}

export const activityService = new ActivityService();
