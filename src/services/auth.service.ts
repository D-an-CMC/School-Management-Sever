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

export class AuthService {
  async login(input: LoginInput): Promise<{ token: string; user: AuthUser }> {
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

    return { token, user };
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
