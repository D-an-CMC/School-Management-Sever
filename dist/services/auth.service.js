import { supabase } from '../config/supabase';
import { signToken } from '../utils/jwt';
export class AuthService {
    async login(input) {
        const { data, error } = await supabase
            .from('users')
            .select('user_id, email, role_id, is_active, auth_id, username, password')
            .eq('email', input.email)
            .single();
        if (error || !data) {
            throw new Error('Email hoặc mật khẩu không đúng');
        }
        if (!data.is_active) {
            throw new Error('Tài khoản đã bị khóa');
        }
        if (data.password !== input.password) {
            throw new Error('Email hoặc mật khẩu không đúng');
        }
        const roleName = await this.getRoleName(data.role_id);
        const payload = {
            userId: data.user_id,
            email: data.email,
            role: roleName,
        };
        const token = signToken(payload);
        const user = {
            id: data.user_id,
            email: data.email,
            role: roleName,
            name: data.username || data.email,
        };
        return { token, user };
    }
    async me(userId) {
        const { data, error } = await supabase
            .from('users')
            .select('user_id, email, role_id, is_active, username')
            .eq('user_id', userId)
            .single();
        if (error || !data) {
            throw new Error('Không tìm thấy người dùng');
        }
        const roleName = await this.getRoleName(data.role_id);
        return {
            id: data.user_id,
            email: data.email,
            role: roleName,
            name: data.username || data.email,
        };
    }
    async getRoleName(roleId) {
        if (!roleId)
            return 'student';
        const { data } = await supabase
            .from('roles')
            .select('role_name')
            .eq('role_id', roleId)
            .single();
        return data?.role_name || 'student';
    }
}
export const authService = new AuthService();
//# sourceMappingURL=auth.service.js.map