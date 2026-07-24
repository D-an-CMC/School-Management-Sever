import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';

export class StudentSelfService {
  async getMyInfo(userId: number) {
    const { data: student, error: sErr } = await supabase
      .from('students')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (sErr || !student) {
      return error('Chưa tìm thấy thông tin học sinh', 'NOT_FOUND');
    }

    let classInfo: any = null;
    if (student.class_id) {
      const { data: cls } = await supabase
        .from('classes')
        .select('class_id, class_name, grade_level, school_year_id')
        .eq('class_id', student.class_id)
        .maybeSingle();

      if (cls) {
        let teacherName = '';
        const { data: classData } = await supabase
          .from('classes')
          .select('homeroom_teacher_id')
          .eq('class_id', student.class_id)
          .maybeSingle();

        if (classData?.homeroom_teacher_id) {
          const { data: t } = await supabase
            .from('teachers')
            .select('full_name')
            .eq('teacher_id', classData.homeroom_teacher_id)
            .maybeSingle();
          if (t) teacherName = t.full_name;
        }

        const gradeMap: Record<number, string> = { 6: 'Khối 6', 7: 'Khối 7', 8: 'Khối 8', 9: 'Khối 9' };
        classInfo = { ...cls, homeroom_teacher_name: teacherName, grade_name: gradeMap[cls.grade_level] || `Khối ${cls.grade_level}` };
      }
    }

    const { data: user } = await supabase
      .from('users')
      .select('email, phone, username')
      .eq('user_id', userId)
      .maybeSingle();

    return success({ ...student, class_info: classInfo, user: user ?? {} });
  }

  async getMyGrades(userId: number) {
    const { data: student } = await supabase
      .from('students')
      .select('student_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!student) {
      return error('Không tìm thấy học sinh', 'NOT_FOUND');
    }

    const { data: results, error: rErr } = await supabase
      .from('subject_results')
      .select('*, subjects(*), semesters(*)')
      .eq('student_id', student.student_id)
      .order('semester_id', { ascending: false });

    if (rErr) return error(rErr.message, 'DB_ERROR');

    const enriched = await Promise.all((results || []).map(async (r: any) => {
      const { data: items } = await supabase
        .from('grade_items')
        .select('*, grade_types(*)')
        .eq('result_id', r.result_id)
        .order('sequence_no');

      return {
        result_id: r.result_id,
        subject_id: r.subject_id,
        semester_id: r.semester_id,
        subject_name: r.subjects?.subject_name,
        subject_code: r.subjects?.subject_code,
        semester_name: r.semesters?.semester_name,
        dtb_mhk: r.dtb_mhk,
        dtb_mcn: r.dtb_mcn,
        reassess_dtb_mhk: r.reassess_dtb_mhk,
        reassess_dtb_mcn: r.reassess_dtb_mcn,
        ranking: r.ranking,
        teacher_comment: r.teacher_comment,
        grade_items: (items || []).map((gi: any) => ({
          grade_item_id: gi.grade_item_id,
          grade_type_id: gi.grade_type_id,
          sequence_no: gi.sequence_no,
          score: gi.score,
          recorded_date: gi.recorded_date,
          type_name: gi.grade_types?.type_name,
          weight: gi.grade_types?.weight,
        })),
      };
    }));

    return success(enriched);
  }

  async getMyTimetable(userId: number, semesterId?: number) {
    const { data: student } = await supabase
      .from('students')
      .select('class_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!student?.class_id) {
      return error('Không tìm thấy lớp học của bạn', 'NOT_FOUND');
    }

    let query = supabase
      .from('timetables')
      .select('*, subjects(*), teachers(*), classes(*), semesters(*)')
      .eq('class_id', student.class_id)
      .order('day_of_week')
      .order('period_no');

    if (semesterId) {
      query = query.eq('semester_id', semesterId);
    }

    const { data, error: tErr } = await query;

    if (tErr) return error(tErr.message, 'DB_ERROR');

    const DAY_MAP: Record<string, string> = { '1': 'Sunday', '2': 'Monday', '3': 'Tuesday', '4': 'Wednesday', '5': 'Thursday', '6': 'Friday', '7': 'Saturday' };

    const enriched = (data || []).map((t: any) => ({
      schedule_id: t.schedule_id,
      class_id: t.class_id,
      subject_id: t.subject_id,
      teacher_id: t.teacher_id,
      semester_id: t.semester_id,
      day_of_week: DAY_MAP[t.day_of_week] || t.day_of_week,
      period_no: t.period_no,
      start_time: t.start_time,
      end_time: t.end_time,
      room: t.room,
      subject_name: t.subjects?.subject_name,
      class_name: t.classes?.class_name,
      subject_code: t.subjects?.subject_code,
      teacher_name: t.teachers?.full_name,
      semester_name: t.semesters?.semester_name,
    }));

    return success(enriched);
  }

  async getMyAttendance(userId: number) {
    const { data: student } = await supabase
      .from('students')
      .select('student_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!student) {
      return error('Không tìm thấy học sinh', 'NOT_FOUND');
    }

    const { data, error: aErr } = await supabase
      .from('attendances')
      .select('*, attendance_sessions(session_id, session_date, teacher_id, created_at)')
      .eq('student_id', student.student_id)
      .order('attendance_id', { ascending: false });

    if (aErr) return error(aErr.message, 'DB_ERROR');

    const enriched = (data || []).map((a: any) => ({
      attendance_id: a.attendance_id,
      session_id: a.session_id,
      student_id: a.student_id,
      status: a.status,
      check_time: a.check_time,
      note: a.note,
      session_date: a.attendance_sessions?.session_date,
      created_at: a.attendance_sessions?.created_at,
    }));

    return success(enriched);
  }

  async getMyActivities(userId: number) {
    const { data: student } = await supabase
      .from('students')
      .select('student_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!student) {
      return error('Không tìm thấy học sinh', 'NOT_FOUND');
    }

    const { data: activities, error: aErr } = await supabase
      .from('activities')
      .select('*, teachers(*), semesters(*)')
      .order('start_datetime', { ascending: false });

    if (aErr) return error(aErr.message, 'DB_ERROR');

    const enriched = await Promise.all((activities || []).map(async (a: any) => {
      const { data: participation } = await supabase
        .from('activity_participants')
        .select('attendance_status, note')
        .eq('activity_id', a.activity_id)
        .eq('student_id', student.student_id)
        .maybeSingle();

      return {
        activity_id: a.activity_id,
        activity_name: a.activity_name,
        activity_type: a.activity_type,
        description: a.description,
        location: a.location,
        start_datetime: a.start_datetime,
        end_datetime: a.end_datetime,
        semester_id: a.semester_id,
        organizer_name: a.teachers?.full_name,
        semester_name: a.semesters?.semester_name,
        my_status: participation?.attendance_status || null,
        my_note: participation?.note || null,
      };
    }));

    return success(enriched);
  }
}

export const studentSelfService = new StudentSelfService();
