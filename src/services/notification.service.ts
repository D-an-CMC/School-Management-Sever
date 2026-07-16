import { supabase } from '../config/supabase';
import { success, error as errResp } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

export class NotificationService {
  async findByUser(userId: number, params: { page: number; limit: number }) {
    const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

    const result = await supabase
      .from('notifications')
      .select('notification_id, title, content, target_type, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit);

    if (result.error) {
      return errResp(result.error.message, 'DB_ERROR');
    }

    return {
      success: true as const,
      ...paginate(result.data ?? [], result.count ?? 0, params.page, params.limit),
    };
  }

  async findAll(params: { page: number; limit: number }) {
    const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

    const result = await supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit);

    if (result.error) {
      return errResp(result.error.message, 'DB_ERROR');
    }

    return {
      success: true as const,
      ...paginate(result.data ?? [], result.count ?? 0, params.page, params.limit),
    };
  }

  async markAsRead(notificationId: number, userId: number) {
    const result = await supabase
      .from('notification_recipients')
      .upsert(
        { notification_id: notificationId, user_id: userId, is_read: true, read_at: new Date().toISOString() },
        { onConflict: 'notification_id,user_id' }
      );

    if (result.error) {
      return errResp(result.error.message, 'DB_ERROR');
    }

    return success({ success: true });
  }

  async create(input: { title: string; content?: string; targetType?: string; senderId?: number }) {
    const result = await supabase
      .from('notifications')
      .insert({
        title: input.title,
        content: input.content,
        target_type: input.targetType,
        sender_id: input.senderId,
      })
      .select()
      .single();

    if (result.error || !result.data) {
      return errResp('Tạo thông báo thất bại', 'CREATE_FAILED');
    }

    return success(result.data);
  }
}

export const notificationService = new NotificationService();
