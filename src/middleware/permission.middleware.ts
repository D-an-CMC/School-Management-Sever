import { AuthRequest } from './auth.middleware';
import { supabase } from '../config/supabase';

// Memory cache for role permissions with 60s TTL to prevent spamming DB on every request
const cache = new Map<number, { permissions: Set<string>; expireAt: number }>();

export function clearPermissionCache(roleId?: number) {
  if (roleId) cache.delete(roleId);
  else cache.clear();
}

/**
 * Middleware kiểm tra quyền động từ bảng `role_permissions`.
 * - Role 'admin' luôn được bypass (full quyền).
 * - Các role khác: truy vấn DB xem role_permissions có chứa ít nhất 1 trong các requiredPermissions không.
 */
export function requirePermission(requiredPermissions: string | string[]) {
  const perms = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

  return async (req: AuthRequest, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const userRole = String((req.user as any).role ?? '').toLowerCase();
    // Admin luôn có full quyền
    if (userRole === 'admin') {
      return next();
    }

    const userId = req.user.userId;
    try {
      // 1. Lấy role_id của user
      const { data: userData } = await supabase
        .from('users')
        .select('role_id')
        .eq('user_id', userId)
        .single();

      if (!userData?.role_id) {
        return res.status(403).json({
          success: false,
          error: 'Tài khoản chưa được gán vai trò',
          code: 'FORBIDDEN',
        });
      }

      const roleId = userData.role_id;
      const now = Date.now();
      let rolePerms = cache.get(roleId);

      if (!rolePerms || rolePerms.expireAt < now) {
        // Query permissions from database
        const { data: rpData } = await supabase
          .from('role_permissions')
          .select('permissions(permission_name)')
          .eq('role_id', roleId);

        const set = new Set<string>();
        for (const item of rpData ?? []) {
          const name = (item as any).permissions?.permission_name;
          if (name) set.add(name);
        }

        rolePerms = { permissions: set, expireAt: now + 60000 };
        cache.set(roleId, rolePerms);
      }

      // 2. Kiểm tra xem role có ít nhất 1 quyền trong danh sách yêu cầu không
      const hasPerm = perms.some((p) => rolePerms!.permissions.has(p));
      if (!hasPerm) {
        return res.status(403).json({
          success: false,
          error: `Bạn không có quyền thực hiện thao tác này (yêu cầu quyền: ${perms.join(', ')})`,
          code: 'PERMISSION_DENIED',
        });
      }

      next();
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message, code: 'INTERNAL_ERROR' });
    }
  };
}
