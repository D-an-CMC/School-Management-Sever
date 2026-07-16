import { supabase } from '../config/supabase';
import { success, error as errResp } from '../utils/response';

export interface CreateUserInput {
  email: string;
  password: string;
  username?: string;
  phone?: string;
  role: string;
  is_active?: boolean;
  full_name?: string;
  gender?: string;
  date_of_birth?: string;
  class_id?: number;
  student_code?: string;
  teacher_code?: string;
  department?: string;
  school_year_id?: number;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

async function generateStudentCode(schoolYearId: number): Promise<string> {
  const { data: sy } = await supabase
    .from('school_years')
    .select('year_name')
    .eq('school_year_id', schoolYearId)
    .single();

  const yearName = (sy?.year_name as string) || String(new Date().getFullYear());
  const baseYear = Number(yearName.split('-')[0]);
  const yearSuffix = String(baseYear).slice(-2);
  const prefix = `HS${yearSuffix}_`;

  const { data } = await supabase
    .from('students')
    .select('student_code')
    .like('student_code', `${prefix}%`)
    .order('student_code', { ascending: false })
    .limit(1);

  const raw = (data?.[0]?.student_code as string | undefined) || '';
  const m = raw.match(/^HS\d{2}_(\d{4})$/);
  const next = m ? Number(m[1]) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

async function generateTeacherCode(): Promise<string> {
  const { data } = await supabase
    .from('teachers')
    .select('teacher_code')
    .order('teacher_code', { ascending: false })
    .limit(1);

  const raw = (data?.[0]?.teacher_code as string | undefined) || 'GV0';
  const m = raw.match(/^GV(\d+)$/);
  return `GV${m ? Number(m[1]) + 1 : 1}`;
}

export class UserService {
  async findMany(params: { search?: string; role?: string; page: number; limit: number }) {
    const offset = (params.page - 1) * params.limit;

    let q = supabase
      .from('users')
      .select('user_id, email, username, phone, is_active, role_id, roles(role_name)', { count: 'exact' });

    if (params.search) {
      q = q.or(`email.ilike.%${params.search}%,username.ilike.%${params.search}%`);
    }

    const result = await q
      .order('created_at', { ascending: false })
      .range(offset, offset + params.limit);

    if (result.error) {
      return errResp(result.error.message, 'DB_ERROR');
    }

    const users = (result.data ?? []).map((u: any) => ({
      ...u,
      role_name: u.roles?.role_name || '',
    }));

    return {
      success: true as const,
      data: users,
      total: result.count ?? 0,
      page: params.page,
      limit: params.limit,
    };
  }

  async findById(userId: number) {
    const result = await supabase.from('users').select('*').eq('user_id', userId).single();

    if (result.error || !result.data) {
      return errResp('Không tìm thấy người dùng', 'NOT_FOUND');
    }

    return success(result.data);
  }

  async createUser(input: CreateUserInput) {
    const roleResult = await supabase
      .from('roles')
      .select('role_id')
      .eq('role_name', input.role)
      .single();

    if (roleResult.error || !roleResult.data) {
      return errResp('Vai trò không hợp lệ', 'INVALID_ROLE');
    }

    const roleId = roleResult.data.role_id;
  let studentCode: string | undefined = input.student_code;
  let teacherCode: string | undefined = input.teacher_code;

  let schoolYearIdForStudent: number | undefined
  if (input.role === 'HocSinh-PhuHuynh' && !studentCode && input.class_id) {
    schoolYearIdForStudent = input.school_year_id
    if (!schoolYearIdForStudent) {
      const classQuery = await supabase.from('classes').select('school_year_id').eq('class_id', input.class_id).single()
      schoolYearIdForStudent = classQuery.data?.school_year_id as number | undefined
    }
    if (schoolYearIdForStudent) {
      studentCode = await generateStudentCode(schoolYearIdForStudent)
    }
  }
  if (input.role === 'GiaoVien' && !teacherCode) {
    teacherCode = await generateTeacherCode();
  }

  const nameSlug = toSlug(input.full_name || input.username || '');

 input.email = input.role === 'HocSinh-PhuHuynh'
   ? (studentCode ? `${studentCode}@cmc.edu.vn` : input.email)
   : input.role === 'GiaoVien'
   ? (teacherCode ? `${nameSlug}.${teacherCode}@cmc.edu.vn` : input.email)
   : input.email;

    const { data: existingUser } = await supabase
      .from('users')
      .select('user_id')
      .eq('email', input.email)
      .maybeSingle();

    if (existingUser) {
      return errResp('Email đã tồn tại', 'EMAIL_EXISTS');
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
    });

    if (authError || !authData.user) {
      return errResp(authError?.message || 'Tạo tài khoản thất bại', 'AUTH_ERROR');
    }

    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        auth_id: authData.user.id,
        email: input.email,
        username: input.username || input.email,
        phone: input.phone || null,
        role_id: roleId,
        is_active: input.is_active ?? true,
      })
      .select('user_id')
      .single();

    if (userError || !newUser) {
      await supabase.auth.admin.deleteUser(authData.user.id);
      return errResp(userError?.message || 'Tạo user thất bại', 'CREATE_FAILED');
    }

    const userId = newUser.user_id;

    if (input.role === 'HocSinh-PhuHuynh') {
      const { error: studentError } = await supabase.from('students').insert({
        user_id: userId,
        full_name: input.full_name || input.username || input.email,
        gender: input.gender || null,
        date_of_birth: input.date_of_birth || null,
        class_id: input.class_id || null,
        student_code: studentCode || null,
      });

      if (studentError) {
        await supabase.from('users').delete().eq('user_id', userId);
        await supabase.auth.admin.deleteUser(authData.user.id);
        return errResp(studentError.message, 'CREATE_STUDENT_FAILED');
      }
    }

    if (input.role === 'GiaoVien') {
      const { error: teacherError } = await supabase.from('teachers').insert({
        user_id: userId,
        teacher_code: teacherCode || null,
        full_name: input.full_name || input.username || input.email,
        gender: input.gender || null,
        date_of_birth: input.date_of_birth || null,
        phone: input.phone || null,
        department: input.department || null,
      });

      if (teacherError) {
        await supabase.from('users').delete().eq('user_id', userId);
        await supabase.auth.admin.deleteUser(authData.user.id);
        return errResp(teacherError.message, 'CREATE_TEACHER_FAILED');
      }
    }

    const { data: finalUser } = await supabase
      .from('users')
      .select('user_id, email, username, phone, is_active, role_id, roles(role_name)')
      .eq('user_id', userId)
      .single();

    return success({
      ...finalUser,
      role_name: (finalUser as any).roles?.role_name || input.role,
    });
  }

async updateUser(userId: number, patch: Partial<CreateUserInput>) {
  const updateData: any = {};
  if (patch.email !== undefined) updateData.email = patch.email;
  if (patch.username !== undefined) updateData.username = patch.username;
  if (patch.phone !== undefined) updateData.phone = patch.phone;
  if (patch.is_active !== undefined) updateData.is_active = patch.is_active;
  if (patch.role !== undefined) {
    const { data: roleRow } = await supabase.from("roles").select("role_id").eq("role_name", patch.role).single();
    if (roleRow) updateData.role_id = roleRow.role_id;
  }

  const { error: userError } = await supabase
    .from("users")
    .update(updateData)
    .eq("user_id", userId);

  if (userError) {
    return errResp("Cập nhật thất bại", "UPDATE_FAILED");
  }

  if (patch.full_name !== undefined || patch.gender !== undefined || patch.date_of_birth !== undefined || patch.class_id !== undefined || patch.student_code !== undefined) {
    const studentData: any = {};
    if (patch.full_name !== undefined) studentData.full_name = patch.full_name;
    if (patch.gender !== undefined) studentData.gender = patch.gender;
    if (patch.date_of_birth !== undefined) studentData.date_of_birth = patch.date_of_birth;
    if (patch.class_id !== undefined) studentData.class_id = patch.class_id;
    if (patch.student_code !== undefined) studentData.student_code = patch.student_code;
    const { error: studentError } = await supabase.from("students").update(studentData).eq("user_id", userId);
    if (studentError) return errResp(studentError.message, "UPDATE_STUDENT_FAILED");
  }

  if (patch.full_name !== undefined || patch.gender !== undefined || patch.date_of_birth !== undefined || patch.phone !== undefined || patch.teacher_code !== undefined || patch.department !== undefined) {
    const teacherData: any = {};
    if (patch.full_name !== undefined) teacherData.full_name = patch.full_name;
    if (patch.gender !== undefined) teacherData.gender = patch.gender;
    if (patch.date_of_birth !== undefined) teacherData.date_of_birth = patch.date_of_birth;
    if (patch.phone !== undefined) teacherData.phone = patch.phone;
    if (patch.teacher_code !== undefined) teacherData.teacher_code = patch.teacher_code;
    if (patch.department !== undefined) teacherData.department = patch.department;
    const { error: teacherError } = await supabase.from("teachers").update(teacherData).eq("user_id", userId);
    if (teacherError) return errResp(teacherError.message, "UPDATE_TEACHER_FAILED");
  }

  const { data } = await supabase.from("users").select("*").eq("user_id", userId).single();
  return success(data);
}


  async getStats() {
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { data: rolesData } = await supabase.from('roles').select('*');

    const adminRoleId = rolesData?.find((r: any) => r.role_name === 'Admin')?.role_id;
    const studentRoleId = rolesData?.find((r: any) => r.role_name === 'HocSinh-PhuHuynh')?.role_id;
    const teacherRoleId = rolesData?.find((r: any) => r.role_name === 'GiaoVien')?.role_id;

    let teacherCount = 0;
    if (teacherRoleId) {
      const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_id', teacherRoleId);
      teacherCount = count ?? 0;
    }

    return success({
      totalStudents: totalUsers ?? 0,
      totalTeachers: teacherCount,
    });
  }
}

export { generateStudentCode };

export const userService = new UserService();
