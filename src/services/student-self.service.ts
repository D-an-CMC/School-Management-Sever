import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';

export class StudentSelfService {
  private async ensureStudent(userId: number) {
    let { data: student } = await supabase
      .from('students')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!student) {
      const { data: unlinked } = await supabase
        .from('students')
        .select('*')
        .is('user_id', null)
        .limit(1)
        .maybeSingle();

      if (unlinked) {
        await supabase.from('students').update({ user_id: userId }).eq('student_id', unlinked.student_id);
        student = { ...unlinked, user_id: userId };
      } else {
        const { data: first } = await supabase.from('students').select('*').limit(1).maybeSingle();
        student = first || null;
      }
    }
    return student;
  }

  async getMyInfo(userId: number) {
    const student = await this.ensureStudent(userId);

    if (!student) {
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

  // Map môn học -> giáo viên (tên + mã) của một lớp.
  // Ưu tiên teaching_assignments; fallback sang timetables (lịch dạy thực tế) khi chưa có.
  private async getSubjectTeachers(classId: number): Promise<Map<number, { teacher_name: string; teacher_code: string }>> {
    const map = new Map<number, { teacher_name: string; teacher_code: string }>();
    const { data: assignments } = await supabase
      .from('teaching_assignments')
      .select('subject_id, teachers(full_name, teacher_code)')
      .eq('class_id', classId);
    (assignments ?? []).forEach((a: any) => {
      const t = Array.isArray(a.teachers) ? a.teachers[0] : a.teachers;
      if (t && t.full_name) {
        map.set(Number(a.subject_id), { teacher_name: t.full_name, teacher_code: t.teacher_code ?? '' });
      }
    });
    if (map.size > 0) return map;

    const { data: timetables } = await supabase
      .from('timetables')
      .select('subject_id, teachers!timetables_teacher_id_fkey(full_name, teacher_code)')
      .eq('class_id', classId);
    (timetables ?? []).forEach((tt: any) => {
      const t = Array.isArray(tt.teachers) ? tt.teachers[0] : tt.teachers;
      if (t && t.full_name && !map.has(Number(tt.subject_id))) {
        map.set(Number(tt.subject_id), { teacher_name: t.full_name, teacher_code: t.teacher_code ?? '' });
      }
    });
    return map;
  }

  async getMyGrades(userId: number, semesterId?: number) {
    const student = await this.ensureStudent(userId);

    if (!student) {
      return error('Không tìm thấy học sinh', 'NOT_FOUND');
    }

    let query = supabase
      .from('subject_results')
      .select('*, subjects(*), semesters(*)')
      .eq('student_id', student.student_id);

    if (semesterId) {
      query = query.eq('semester_id', semesterId);
    }

    const { data: results, error: rErr } = await query.order('semester_id', { ascending: false });

    if (rErr) return error(rErr.message, 'DB_ERROR');

    const { data: allSubjects } = await supabase
      .from('subjects')
      .select('subject_id, subject_name, subject_code')
      .order('subject_id');

    const teacherMap = await this.getSubjectTeachers(student.class_id);

    const enriched = await Promise.all((results || []).map(async (r: any) => {
      const { data: items } = await supabase
        .from('grade_items')
        .select('*, grade_types(*)')
        .eq('result_id', r.result_id)
        .order('sequence_no');

      const teacher = teacherMap.get(Number(r.subject_id));

      return {
        result_id: r.result_id,
        subject_id: r.subject_id,
        semester_id: r.semester_id,
        subject_name: r.subjects?.subject_name,
        subject_code: r.subjects?.subject_code,
        semester_name: r.semesters?.semester_name,
        teacher_name: teacher?.teacher_name ?? null,
        teacher_code: teacher?.teacher_code ?? null,
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

    // Ensure every subject is present, even when no result was entered yet.
    const bySubject = new Map<number, any>();
    (enriched || []).forEach((e: any) => bySubject.set(Number(e.subject_id), e));

    const merged = (allSubjects || []).map((s: any) => {
      const existing = bySubject.get(Number(s.subject_id));
      if (existing) return existing;
      const teacher = teacherMap.get(Number(s.subject_id));
      return {
        result_id: null,
        subject_id: s.subject_id,
        semester_id: semesterId ?? null,
        subject_name: s.subject_name,
        subject_code: s.subject_code,
        semester_name: null,
        teacher_name: teacher?.teacher_name ?? null,
        teacher_code: teacher?.teacher_code ?? null,
        dtb_mhk: null,
        dtb_mcn: null,
        reassess_dtb_mhk: null,
        reassess_dtb_mcn: null,
        ranking: '',
        teacher_comment: '',
        grade_items: [],
      };
    });

    return success(merged);
  }

  // Điểm cả năm của học sinh: gộp HK1 + HK2 theo từng môn.
  // TBM môn CN = (TBM HK1 + 2*TBM HK2) / 3; môn không-điểm dùng ranking (ưu tiên HK2).
  async getMyGradesYear(userId: number) {
    const student = await this.ensureStudent(userId);
    if (!student) {
      return error('Không tìm thấy học sinh', 'NOT_FOUND');
    }

    // Hai học kỳ của năm học hiện tại (theo class -> school_year -> semesters).
    let classInfo: any = null;
    const { data: cls } = await supabase
      .from('classes')
      .select('school_year_id')
      .eq('class_id', student.class_id)
      .maybeSingle();
    const yearId = cls?.school_year_id ?? null;

    let sems: any[] = [];
    if (yearId) {
      const { data: s } = await supabase
        .from('semesters')
        .select('semester_id')
        .eq('school_year_id', yearId)
        .order('term_order', { ascending: true });
      sems = s ?? [];
    }
    if (sems.length < 2) {
      const { data: all } = await supabase
        .from('semesters')
        .select('semester_id')
        .order('term_order', { ascending: true })
        .limit(2);
      sems = all ?? [];
    }
    const sem1Id = sems[0]?.semester_id;
    const sem2Id = sems[1]?.semester_id;

    const { data: results } = await supabase
      .from('subject_results')
      .select('result_id, subject_id, semester_id, ranking')
      .eq('student_id', student.student_id);

    // Lấy grade_types một lần.
    const { data: gTypes } = await supabase.from('grade_types').select('grade_type_id, type_code, type_name');
    const gs = gTypes ?? [];
    const isTx = (t: any) => (t.type_code || '').toUpperCase() === 'TX' || (t.type_name || '').toLowerCase().includes('thường xuyên');
    const isGk = (t: any) => (t.type_code || '').toUpperCase() === 'GK' || (t.type_name || '').toLowerCase().includes('giữa');
    const isCk = (t: any) => (t.type_code || '').toUpperCase() === 'CK' || (t.type_name || '').toLowerCase().includes('cuối');
    const typeBy = new Map<number, 'TX' | 'GK' | 'CK'>();
    gs.forEach((t: any) => {
      if (isTx(t)) typeBy.set(t.grade_type_id, 'TX');
      else if (isGk(t)) typeBy.set(t.grade_type_id, 'GK');
      else if (isCk(t)) typeBy.set(t.grade_type_id, 'CK');
      else typeBy.set(t.grade_type_id, 'TX');
    });

    const semOf = new Map<number, number>(); // result_id -> semester_id
    const rankingOf = new Map<number, string>(); // result_id -> ranking
    const subjectOf = new Map<number, number>(); // result_id -> subject_id
    const resultIds: number[] = [];
    (results ?? []).forEach((r: any) => {
      resultIds.push(r.result_id);
      semOf.set(r.result_id, r.semester_id);
      rankingOf.set(r.result_id, r.ranking);
      subjectOf.set(r.result_id, r.subject_id);
    });

    // điểm TB môn từ grade_items.
    const avgByResult = new Map<number, number>();
    if (resultIds.length) {
      for (let i = 0; i < resultIds.length; i += 500) {
        const chunk = resultIds.slice(i, i + 500);
        const { data: items } = await supabase
          .from('grade_items')
          .select('result_id, score, grade_type_id')
          .in('result_id', chunk);
        const agg = new Map<number, { sum: number; count: number }>();
        (items ?? []).forEach((it: any) => {
          const w = typeBy.get(it.grade_type_id) === 'GK' ? 2 : typeBy.get(it.grade_type_id) === 'CK' ? 3 : 1;
          const cur = agg.get(it.result_id) || { sum: 0, count: 0 };
          agg.set(it.result_id, { sum: cur.sum + Number(it.score) * w, count: cur.count + w });
        });
        agg.forEach((v, rid) => {
          if (v.count > 0) avgByResult.set(rid, Number((v.sum / v.count).toFixed(2)));
        });
      }
    }

    // Gộp theo môn.
    const { data: allSubjects } = await supabase
      .from('subjects')
      .select('subject_id, subject_name, subject_code')
      .order('subject_id');

    const subjectIds = Array.from(new Set((results ?? []).map((r: any) => r.subject_id)));
    const teacherMap = await this.getSubjectTeachers(student.class_id);
    const rows = (allSubjects ?? []).map((s: any) => {
      const teacher = teacherMap.get(Number(s.subject_id));
      if (!subjectIds.includes(s.subject_id)) {
        return {
          subject_id: s.subject_id,
          subject_name: s.subject_name,
          subject_code: s.subject_code,
          teacher_name: teacher?.teacher_name ?? null,
          teacher_code: teacher?.teacher_code ?? null,
          avg1: null,
          avg2: null,
          yearAvg: null,
          ranking1: '',
          ranking2: '',
          ranking: '',
        };
      }
      const myResults = (results ?? []).filter((r: any) => r.subject_id === s.subject_id);
      const r1 = myResults.find((r: any) => r.semester_id === sem1Id);
      const r2 = myResults.find((r: any) => r.semester_id === sem2Id);
      const avg1 = r1 ? avgByResult.get(r1.result_id) ?? null : null;
      const avg2 = r2 ? avgByResult.get(r2.result_id) ?? null : null;
      const ranking1 = r1?.ranking ?? '';
      const ranking2 = r2?.ranking ?? '';
      let yearAvg: number | null = null;
      if (avg1 != null && avg2 != null) yearAvg = Number(((avg1 + avg2 * 2) / 3).toFixed(2));
      else yearAvg = avg2 ?? avg1;
      return {
        subject_id: s.subject_id,
        subject_name: s.subject_name,
        subject_code: s.subject_code,
        teacher_name: teacher?.teacher_name ?? null,
        teacher_code: teacher?.teacher_code ?? null,
        avg1,
        avg2,
        yearAvg,
        ranking1,
        ranking2,
        ranking: ranking2 || ranking1 || '',
      };
    });

    // TBCN cả năm (chỉ môn có điểm).
    const scored = rows.filter((r: any) => r.yearAvg != null);
    const overall = scored.length
      ? Number((scored.reduce((a, b) => a + b.yearAvg, 0) / scored.length).toFixed(2))
      : null;

    return success({ sem1Id, sem2Id, rows, overall });
  }

  async getMyTimetable(userId: number, semesterId?: number) {
    const student = await this.ensureStudent(userId);

    // L4: trước đây class_id thiếu âm thầm tra TKB của lớp 1.
    if (!student?.class_id) {
      return error('Tài khoản của bạn chưa được xếp vào lớp nào — hãy báo giáo viên chủ nhiệm/trường.', 'NO_CLASS');
    }
    const classId = student.class_id;

    let query = supabase
      .from('timetables')
      .select('*, subjects(*), teachers(*), classes(*, rooms!classes_fixed_room_id_fkey(room_name)), semesters(*)')
      .eq('class_id', classId)
      .order('day_of_week')
      .order('period_no');

    if (semesterId) {
      query = query.eq('semester_id', semesterId);
    }

    const { data, error: tErr } = await query;

    if (tErr) return error(tErr.message, 'DB_ERROR');

    const DAY_MAP: Record<string, string> = { '1': 'Sunday', '2': 'Monday', '3': 'Tuesday', '4': 'Wednesday', '5': 'Thursday', '6': 'Friday', '7': 'Saturday' };

    const enriched = (data || []).map((t: any) => {
      const cls = Array.isArray(t.classes) ? t.classes[0] : t.classes;
      const fixedRoom = cls?.rooms;
      const roomName = Array.isArray(fixedRoom) ? fixedRoom[0]?.room_name : fixedRoom?.room_name;
      return {
      schedule_id: t.schedule_id,
      class_id: t.class_id,
      subject_id: t.subject_id,
      teacher_id: t.teacher_id,
      semester_id: t.semester_id,
      day_of_week: DAY_MAP[t.day_of_week] || t.day_of_week,
      period_no: t.period_no,
      start_time: t.start_time,
      end_time: t.end_time,
      room: t.room || roomName || '',
      subject_name: t.subjects?.subject_name,
      class_name: t.classes?.class_name,
      subject_code: t.subjects?.subject_code,
      teacher_name: t.teachers?.full_name,
      semester_name: t.semesters?.semester_name,
    };
    });

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
      .select('*, attendance_sessions(session_id, session_date, attendance_date, session, teacher_id, created_at)')
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
      attendance_date: a.attendance_sessions?.attendance_date ?? a.attendance_sessions?.session_date,
      session: a.attendance_sessions?.session,
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
