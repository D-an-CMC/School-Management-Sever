import { supabase } from '../config/supabase';
import { success, error as errResp } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

// Chuẩn trạng thái điểm danh mới (đơn vị: BUỔI).
export const ATTENDANCE_STATUS = ['PRESENT', 'ABSENT_EXCUSED', 'ABSENT_UNEXCUSED', 'LATE'] as const;
export const SESSIONS = ['MORNING', 'AFTERNOON'] as const;

// Map từ status cũ sang chuẩn mới (dự phòng cho dữ liệu cũ).
export function normalizeStatus(raw?: string | null): string {
  switch (raw) {
    case 'PRESENT': return 'PRESENT';
    case 'ABSENT_EXCUSED': return 'ABSENT_EXCUSED';
    case 'ABSENT_UNEXCUSED': return 'ABSENT_UNEXCUSED';
    case 'LATE': return 'LATE';
    case 'Có mặt': return 'PRESENT';
    case 'Vắng': return 'ABSENT_UNEXCUSED';
    case 'Vắng có phép': return 'ABSENT_EXCUSED';
    case 'Nghỉ ốm': return 'ABSENT_EXCUSED';
    case 'Trễ': return 'LATE';
    case 'Phép': return 'ABSENT_EXCUSED';
    default: return 'PRESENT';
  }
}

export class AttendanceService {
  async findSessions(params: { teacherId?: number; classId?: number; semesterId?: number; schoolYearId?: number; page?: number; limit?: number }) {
    const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

    let q = supabase
      .from('attendance_sessions')
      .select('*, classes(class_id, class_name), semesters(semester_id, semester_name), school_years(school_year_id, year_name)', { count: 'exact' });

    if (params.teacherId) {
      q = q.eq('teacher_id', params.teacherId);
    }
    if (params.classId) {
      q = q.eq('class_id', params.classId);
    }
    if (params.semesterId) {
      q = q.eq('semester_id', params.semesterId);
    }
    if (params.schoolYearId) {
      q = q.eq('school_year_id', params.schoolYearId);
    }

    const result = await q.order('attendance_date', { ascending: false }).range(offset, offset + limit);

    if (result.error) {
      return errResp(result.error.message, 'DB_ERROR');
    }

    return {
      success: true as const,
      ...paginate(result.data ?? [], result.count ?? 0, params.page, params.limit),
    };
  }

  async findWithRecords(sessionId: number) {
    const { data: session, error: sErr } = await supabase
      .from('attendance_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (sErr || !session) {
      return errResp('Không tìm thấy phiên điểm danh', 'NOT_FOUND');
    }

    const recordsResult = await supabase
      .from('attendances')
      .select('*')
      .eq('session_id', sessionId)
      .order('student_id');

    return success({
      session,
      records: (recordsResult.data ?? []).map((r) => ({
        attendance_id: r.attendance_id,
        session_id: r.session_id,
        student_id: r.student_id,
        status: normalizeStatus(r.status),
        check_time: r.check_time,
        note: r.note,
      })),
    });
  }

  async createSession(data: {
    teacherId?: number;
    sessionDate?: string;
    classId?: number;
    semesterId?: number;
    schoolYearId?: number;
    session?: string; // MORNING | AFTERNOON
    students?: number[];
  }) {
    // Nếu có classId + semesterId nhưng thiếu schoolYearId, tự suy từ semester.
    let schoolYearId = data.schoolYearId;
    if (!schoolYearId && data.semesterId) {
      const { data: sem } = await supabase
        .from('semesters')
        .select('school_year_id')
        .eq('semester_id', data.semesterId)
        .maybeSingle();
      schoolYearId = sem?.school_year_id ?? null;
    }

    const sessionCol = data.session === 'AFTERNOON' ? 'AFTERNOON' : 'MORNING';
    const attendanceDate = data.sessionDate
      ? new Date(data.sessionDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const result = await supabase
      .from('attendance_sessions')
      .upsert({
        teacher_id: data.teacherId,
        session_date: attendanceDate,
        class_id: data.classId ?? null,
        semester_id: data.semesterId ?? null,
        school_year_id: schoolYearId ?? null,
        session: sessionCol,
        attendance_date: attendanceDate,
      })
      .select()
      .single();

    if (result.error || !result.data) {
      return errResp(result.error?.message || 'Tạo phiên thất bại', 'CREATE_FAILED');
    }

    // Tự tạo bản ghi điểm danh mặc định PRESENT cho từng học sinh của lớp.
    const sessionId = result.data.session_id;
    if (sessionId && data.students && data.students.length > 0) {
      const rows = data.students.map((sid) => ({
        session_id: sessionId,
        student_id: sid,
        status: 'PRESENT',
      }));
      await supabase.from('attendances').upsert(rows, { onConflict: 'session_id,student_id' });
    }

    return success(result.data);
  }

  async batchUpdate(records: { attendanceId: number; status: string; note?: string }[]) {
    const results: any[] = [];
    const errors: string[] = [];
    for (const rec of records) {
      const status = normalizeStatus(rec.status);
      const result = await supabase
        .from('attendances')
        .update({ status, note: rec.note })
        .eq('attendance_id', rec.attendanceId)
        .select()
        .single();
      if (result.error) errors.push(result.error.message);
      else results.push({ attendanceId: rec.attendanceId, data: result.data });
    }

    if (errors.length > 0) return errResp(errors.join('; '), 'SAVE_FAILED');

    return success(results);
  }

  // Ghi điểm danh theo (session, student) dựa trên student_id, tự tạo bản ghi nếu chưa có.
  async saveByStudent(sessionId: number, records: { studentId: number; status: string; note?: string }[]) {
    const results: any[] = [];
    const errors: string[] = [];
    for (const rec of records) {
      const status = normalizeStatus(rec.status);
      const { data: existing } = await supabase
        .from('attendances')
        .select('attendance_id')
        .eq('session_id', sessionId)
        .eq('student_id', rec.studentId)
        .maybeSingle();

      let r;
      if (existing) {
        r = await supabase
          .from('attendances')
          .update({ status, note: rec.note })
          .eq('attendance_id', existing.attendance_id)
          .select()
          .single();
      } else {
        r = await supabase
          .from('attendances')
          .insert({ session_id: sessionId, student_id: rec.studentId, status, note: rec.note })
          .select()
          .single();
      }

      if (r.error) {
        errors.push(`Học sinh ${rec.studentId}: ${r.error.message}`);
      } else {
        results.push({ studentId: rec.studentId, data: r.data });
      }
    }

    if (errors.length > 0) {
      return errResp(errors.join('; '), 'SAVE_FAILED');
    }

    return success(results);
  }
}

export const attendanceService = new AttendanceService();
