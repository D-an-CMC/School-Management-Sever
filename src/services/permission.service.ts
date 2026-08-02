import { supabase } from '../config/supabase';
import { success, error as errResp } from '../utils/response';

const MODULE_DEFS = [
  {
    id: 'grading',
    title: 'Quản lý điểm số',
    icon: 'grade',
    permissionIds: [2, 6, 7, 8, 9],
    items: [
      { id: 'g1', label: 'Nhập điểm thành phần', permissionId: 6 },
      { id: 'g2', label: 'Chỉnh sửa điểm đã khóa', permissionId: 7 },
      { id: 'g3', label: 'Phê duyệt bảng điểm tổng kết', permissionId: 8 },
      { id: 'g4', label: 'Xuất báo cáo học thuật', permissionId: 9 },
    ],
  },
  {
    id: 'attendance',
    title: 'Điểm danh & Chuyên cần',
    icon: 'fact_check',
    permissionIds: [3, 10, 11, 12, 13],
    items: [
      { id: 'a1', label: 'Chốt sổ điểm danh ngày', permissionId: 10 },
      { id: 'a2', label: 'Xác nhận đơn xin nghỉ phép', permissionId: 11 },
      { id: 'a3', label: 'Gửi thông báo vắng mặt tự động', permissionId: 12 },
      { id: 'a4', label: 'Truy xuất lịch sử quét thẻ', permissionId: 13 },
    ],
  },
  {
    id: 'finance',
    title: 'Báo cáo tài chính & Học phí',
    icon: 'analytics',
    permissionIds: [14, 15, 16, 17],
    items: [
      { id: 'f1', label: 'Xem dòng tiền tổng thể', permissionId: 14 },
      { id: 'f2', label: 'Miễn giảm học phí đặc biệt', permissionId: 15 },
      { id: 'f3', label: 'Đối soát thanh toán ngân hàng', permissionId: 16 },
      { id: 'f4', label: 'Xóa hóa đơn đã phát hành', permissionId: 17 },
    ],
  },
  {
    id: 'iot',
    title: 'Cấu hình thiết bị IoT',
    icon: 'settings_input_component',
    permissionIds: [18, 19, 20, 21],
    items: [
      { id: 'i1', label: 'Đăng ký thiết bị mới', permissionId: 18 },
      { id: 'i2', label: 'Cập nhật Firmware từ xa', permissionId: 19 },
      { id: 'i3', label: 'Thiết lập ngưỡng cảnh báo', permissionId: 20 },
      { id: 'i4', label: 'Reset cấu hình mạng', permissionId: 21 },
    ],
  },
];

export class PermissionService {
  async findAllRoles() {
    const { data: roles, error } = await supabase.from('roles').select('*').order('role_id');
    if (error) return errResp(error.message, 'DB_ERROR');

    const { data: mappings } = await supabase.from('role_permissions').select('role_id, permission_id');
    const rolePerms = new Map<number, number[]>();
    (mappings ?? []).forEach((m: any) => {
      const arr = rolePerms.get(m.role_id) ?? [];
      arr.push(m.permission_id);
      rolePerms.set(m.role_id, arr);
    });

    const result = (roles ?? []).map((role: any) => {
      const allowed = rolePerms.get(role.role_id) ?? [];
      const last = (role.updated_at ?? role.created_at) as string | undefined;
      return {
        role_id: role.role_id,
        role_name: role.role_name,
        description: role.description,
        note: role.description ?? '',
        lastUpdated: last ? new Date(last).toLocaleString('vi-VN') : '',
        modules: MODULE_DEFS.map((mod) => {
          const enabled = mod.permissionIds.some((pid) => allowed.includes(pid));
          const enabledCount = mod.items.filter((it) => allowed.includes(it.permissionId)).length;
          return {
            id: mod.id,
            title: mod.title,
            icon: mod.icon,
            enabled,
            enabledCount,
            totalCount: mod.items.length,
            items: mod.items.map((it) => ({
              id: it.id,
              label: it.label,
              permissionId: it.permissionId,
              enabled: allowed.includes(it.permissionId),
            })),
          };
        }),
      };
    });

    return success(result);
  }

  async findPermissionsByRole(roleId: number) {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', roleId);
    if (error) return errResp(error.message, 'DB_ERROR');

    const ids = (data ?? []).map((r: any) => r.permission_id);
    return success(ids);
  }

  async findAllPermissions() {
    const { data, error } = await supabase
      .from('permissions')
      .select('permission_id, permission_name, description')
      .order('permission_id');
    if (error) return errResp(error.message, 'DB_ERROR');

    const result = (data ?? []).map((p: any) => ({
      id: p.permission_id,
      name: p.permission_name,
      description: p.description,
    }));
    return success(result);
  }

  async updatePermissions(roleId: number, permissionIds: number[]) {
    const { error: delErr } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId);
    if (delErr) return errResp(delErr.message, 'DB_ERROR');

    if (permissionIds.length === 0) return success({ updated: 0 });

    const rows = permissionIds.map((pid) => ({ role_id: roleId, permission_id: pid }));
    const { error: insErr } = await supabase.from('role_permissions').insert(rows);
    if (insErr) return errResp(insErr.message, 'DB_ERROR');

    return success({ updated: permissionIds.length });
  }
}

export const permissionService = new PermissionService();
