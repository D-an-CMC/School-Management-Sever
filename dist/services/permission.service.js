import { supabase } from '../config/supabase';
import { success, error as errResp } from '../utils/response';
export class PermissionService {
    async findAllRoles() {
        const result = await supabase.from('roles').select('*').order('role_id');
        if (result.error) {
            return errResp(result.error.message, 'DB_ERROR');
        }
        return success(result.data ?? []);
    }
    async findRoleById(roleId) {
        const result = await supabase.from('roles').select('*').eq('role_id', roleId).single();
        if (result.error || !result.data) {
            return errResp('Không tìm thấy vai trò', 'NOT_FOUND');
        }
        return success(result.data);
    }
    async findPermissionsByRole(roleId) {
        const result = await supabase
            .from('role_permissions')
            .select('*, permission:permissions!inner(*)')
            .eq('role_id', roleId);
        if (result.error) {
            return errResp(result.error.message, 'DB_ERROR');
        }
        const permissions = (result.data ?? []).map((rp) => ({
            permission_id: rp.permission_id,
            permission_name: rp.permission?.permission_name,
            description: rp.permission?.description,
            enabled: true,
        }));
        return success(permissions);
    }
    async updatePermissions(roleId, permissionIds) {
        const delResult = await supabase.from('role_permissions').delete().eq('role_id', roleId);
        if (delResult.error) {
            return errResp(delResult.error.message, 'DB_ERROR');
        }
        if (permissionIds.length > 0) {
            const rows = permissionIds.map((pid) => ({ role_id: roleId, permission_id: pid }));
            const insertResult = await supabase.from('role_permissions').insert(rows);
            if (insertResult.error) {
                return errResp(insertResult.error.message, 'DB_ERROR');
            }
        }
        return success({ success: true });
    }
    async findAllPermissions() {
        const result = await supabase.from('permissions').select('*').order('permission_id');
        if (result.error) {
            return errResp(result.error.message, 'DB_ERROR');
        }
        return success(result.data ?? []);
    }
}
export const permissionService = new PermissionService();
//# sourceMappingURL=permission.service.js.map