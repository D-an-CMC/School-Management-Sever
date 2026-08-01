import { supabase } from '../config/supabase';
import { signToken, JwtPayload } from '../utils/jwt';

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthUser {
  id: number;
  email: string;
  role: string;
  name: string;
  teacherId?: number;
  studentId?: number;
  avatar?: string;
  department?: string;
  classCode?: string;
}

import { securityLogService } from './security-log.service';

export class AuthService {
  async login(input: LoginInput, reqInfo?: { ip?: string; userAgent?: string }): Promise<{ token: string; user: AuthUser }> {
    const ip = reqInfo?.ip || '127.0.0.1';
    const userAgent = reqInfo?.userAgent || 'Browser';

    const { data, error } = await supabase
      .from('users')
      .select('user_id, email, role_id, is_active, auth_id, username, password')
      .eq('email', input.email)
      .single();

    if (error || !data) {
      await securityLogService.addLog({
        user_email: input.email,
        user_name: 'Khách',
        role_name: 'N/A',
        action: 'Đăng nhập',
        status: 'Thất bại',
        ip_address: ip,
        user_agent: userAgent,
        details: 'Tài khoản không tồn tại hoặc sai email',
      });
      throw new Error('Email hoặc mật khẩu không đúng');
    }
    if (!data.is_active) {
      await securityLogService.addLog({
        user_id: data.user_id,
        user_email: data.email,
        user_name: data.username || data.email,
        role_name: 'N/A',
        action: 'Đăng nhập',
        status: 'Thất bại',
        ip_address: ip,
        user_agent: userAgent,
        details: 'Tài khoản đã bị khóa',
      });
      throw new Error('Tài khoản đã bị khóa');
    }
    if (data.password !== input.password) {
      const roleName = await this.getRoleName(data.role_id);
      await securityLogService.addLog({
        user_id: data.user_id,
        user_email: data.email,
        user_name: data.username || data.email,
        role_name: roleName,
        action: 'Đăng nhập',
        status: 'Thất bại',
        ip_address: ip,
        user_agent: userAgent,
        details: 'Sai mật khẩu đăng nhập',
      });
      throw new Error('Email hoặc mật khẩu không đúng');
    }

    const roleName = await this.getRoleName(data.role_id);

    const payload: JwtPayload = {
      userId: data.user_id,
      email: data.email,
      role: roleName,
    };

    const token = signToken(payload);

    let teacherId: number | undefined;
    let studentId: number | undefined;

    if (roleName === 'GiaoVien') {
      const { data: t } = await supabase.from('teachers').select('teacher_id').eq('user_id', data.user_id).maybeSingle();
      teacherId = t?.teacher_id;
    } else if (roleName === 'HocSinh-PhuHuynh') {
      const { data: s } = await supabase.from('students').select('student_id').eq('user_id', data.user_id).maybeSingle();
      studentId = s?.student_id;
    }

    const user: AuthUser = {
      id: data.user_id,
      email: data.email,
      role: roleName,
      name: data.username || data.email,
      teacherId,
      studentId,
    };

    await securityLogService.addLog({
      user_id: user.id,
      user_email: user.email,
      user_name: user.name,
      role_name: user.role,
      action: 'Đăng nhập',
      status: 'Thành công',
      ip_address: ip,
      user_agent: userAgent,
      details: `Đăng nhập thành công với vai trò ${user.role}`,
    });

    return { token, user };
  }

  async logout(user: { id: number; email: string; name?: string; role?: string }, reqInfo?: { ip?: string; userAgent?: string }) {
    await securityLogService.addLog({
      user_id: user.id,
      user_email: user.email,
      user_name: user.name || user.email,
      role_name: user.role || 'User',
      action: 'Đăng xuất',
      status: 'Thành công',
      ip_address: reqInfo?.ip || '127.0.0.1',
      user_agent: reqInfo?.userAgent || 'Browser',
      details: 'Đăng xuất khỏi hệ thống',
    });
    return { success: true };
  }

  async me(userId: number): Promise<AuthUser> {
    const { data, error } = await supabase
      .from('users')
      .select('user_id, email, role_id, is_active, username')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new Error('Không tìm thấy người dùng');
    }

    const roleName = await this.getRoleName(data.role_id);

    let teacherId: number | undefined;
    let studentId: number | undefined;

    if (roleName === 'GiaoVien') {
      const { data: t } = await supabase.from('teachers').select('teacher_id').eq('user_id', userId).maybeSingle();
      teacherId = t?.teacher_id;
    } else if (roleName === 'HocSinh-PhuHuynh') {
      const { data: s } = await supabase.from('students').select('student_id').eq('user_id', userId).maybeSingle();
      studentId = s?.student_id;
    }

    return {
      id: data.user_id,
      email: data.email,
      role: roleName,
      name: data.username || data.email,
      teacherId,
      studentId,
    };
  }

  private async getRoleName(roleId?: number): Promise<string> {
    if (!roleId) return 'student';
    const { data } = await supabase
      .from('roles')
      .select('role_name')
      .eq('role_id', roleId)
      .single();
    return data?.role_name || 'student';
  }
}

export const authService = new AuthService();
