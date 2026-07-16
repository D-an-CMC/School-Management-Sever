import { supabase } from '../config/supabase';
import { success, error as errResp } from '../utils/response';
import { buildPagination, paginate } from '../utils/pagination';

export class AttendanceService {
  async findSessions(params: { teacherId?: number; page: number; limit: number }) {
    const { offset, limit } = buildPagination({ page: params.page, limit: params.limit });

    let q = supabase.from('attendance_sessions').select('*', { count: 'exact' });

    if (params.teacherId) {
      q = q.eq('teacher_id', params.teacherId);
    }

    const result = await q.order('session_date', { ascending: false }).range(offset, offset + limit);

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
        status: r.status,
        check_time: r.check_time,
        note: r.note,
      })),
    });
  }

  async createSession(data: { teacherId?: number; sessionDate?: string }) {
    const result = await supabase
      .from('attendance_sessions')
      .upsert({
        teacher_id: data.teacherId,
        session_date: data.sessionDate,
      })
      .select()
      .single();

    if (result.error || !result.data) {
      return errResp(result.error?.message || 'Tạo phiên thất bại', 'CREATE_FAILED');
    }

    return success(result.data);
  }

  async batchUpdate(records: { attendanceId: number; status: string; note?: string }[]) {
    const results = [];
    for (const rec of records) {
      const result = await supabase
        .from('attendances')
        .update({ status: rec.status, note: rec.note })
        .eq('attendance_id', rec.attendanceId)
        .select()
        .single();
      results.push({ attendanceId: rec.attendanceId, data: result.data, error: result.error });
    }

    return success(results);
  }
}

export const attendanceService = new AttendanceService();
