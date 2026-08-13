import { supabase } from '../config/supabase';
import { success, error as errResp } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

const ROLE_MAP: Record<string, string> = {
  Admin: 'admin',
  admin: 'admin',
  GiaoVien: 'teacher',
  teacher: 'teacher',
  'HocSinh-PhuHuynh': 'student',
  'HocSinh_PhuHuynh': 'student',
  'HocSinhPhuHuynh': 'student',
  student: 'student',
  parent: 'parent',
  'PhuHuynh': 'parent',
  medical: 'medical',
  accountant: 'accountant',
};

export class NotificationService {
  // Chi nhung thong bao nham den vai tro cua user (hoac 'all') moi hien ra tren chuong.
  private isRelevant(targetType: string | null | undefined, userRole: string): boolean {
    if (!targetType || targetType === 'all') return true;
    return targetType === ROLE_MAP[userRole] || targetType === userRole;
  }

  async findByUser(
    userId: number,
    userRole: string,
    params: { page?: number; limit?: number }
  ) {
    const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

    // Lay toan bo thong bao, loc sau (so luong khong lon).
    const { data, error } = await supabase
      .from('notifications')
      .select('notification_id, title, content, target_type, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return errResp(error.message, 'DB_ERROR');
    }

    const rows = (data ?? []).filter((n: any) => this.isRelevant(n.target_type, userRole));

    // Lay trang thai da doc cua user cho cac thong bao nay.
    const ids = rows.map((r: any) => r.notification_id);
    const readMap = new Map<number, boolean>();
    if (ids.length > 0) {
      const { data: reads } = await supabase
        .from('notification_recipients')
        .select('notification_id, is_read')
        .eq('user_id', userId)
        .in('notification_id', ids);
      (reads ?? []).forEach((r: any) => readMap.set(r.notification_id, !!r.is_read));
    }

    const items = rows.map((r: any) => ({
      notification_id: r.notification_id,
      title: r.title,
      content: r.content,
      target_type: r.target_type,
      created_at: r.created_at,
      is_read: readMap.get(r.notification_id) ?? false,
    }));

    const unreadCount = items.filter((r: any) => !r.is_read).length;

    return {
      success: true as const,
      ...paginate(items, items.length, params.page, params.limit),
      unreadCount,
    };
  }

  async unreadCount(userId: number, userRole: string) {
    const result = await this.findByUser(userId, userRole, { page: 1, limit: 100 });
    if (!result.success) return result;
    return success({ unreadCount: (result as any).unreadCount ?? 0 });
  }

  async findAll(params: { page?: number; limit?: number }) {
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
        target_type: input.targetType || 'all',
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
