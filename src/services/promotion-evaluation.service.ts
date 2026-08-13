import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';

// ─────────────────────────────────────────────────────────────
// Promotion & Year-End Evaluation service
//
// Tính + xét kết quả cuối năm cho từng học sinh:
//   - Tổng hợp điểm danh cả năm (đơn vị: BUỔI)
//   - Tổng hợp học tập cả năm (TBM môn CN, TBCN, học lực, số môn >= 9.0)
//   - Đề xuất danh hiệu + tình trạng lên lớp
//   - Lưu vào student_year_results (1 dòng / HS / năm)
//
// KHÔNG tự ý lưu ban: mọi bất thường về điểm danh chỉ đưa PENDING_REVIEW
// và luôn chờ xác nhận của GVCN/Hiệu trưởng (system_recommendation vs final_result).
// ─────────────────────────────────────────────────────────────

// Hệ số điểm theo quy chế THCS.
const WEIGHT_TX = 1;
const WEIGHT_GK = 2;
const WEIGHT_CK = 3;

// Môn "Đạt/Chưa đạt" (không có điểm số, không tính vào TBCN).
const NON_SCORED_SUBJECT_IDS = new Set<number>([4, 9, 14, 15, 35, 36, 37]);

// Ngưỡng báo cáo điểm danh (đơn vị buổi).
const MAX_ABSENCE_PER_YEAR = 45;

// Ngưỡng học lực THCS (dùng để phân loại).
// Chưa đạt: TBCN < 5; Đạt: TBCN 5-><6.5; Khá: 6.5-><8; Tốt: >=8.
function classifyAcademic(avg: number | null): string {
  if (avg == null) return 'Chưa đạt';
  if (avg >= 8) return 'Tốt';
  if (avg >= 6.5) return 'Khá';
  if (avg >= 5) return 'Đạt';
  return 'Chưa đạt';
}

function classifyAttendance(totalAbsence: number): string {
  if (totalAbsence > MAX_ABSENCE_PER_YEAR) return 'EXCEEDED';
  if (totalAbsence === MAX_ABSENCE_PER_YEAR) return 'AT_LIMIT';
  if (totalAbsence >= MAX_ABSENCE_PER_YEAR - 5) return 'WARNING'; // 40-44
  return 'NORMAL';
}

async function getGradeTypeIds(): Promise<{ tx: number; gk: number; ck: number }> {
  const { data } = await supabase.from('grade_types').select('grade_type_id, type_code, type_name');
  const list = data ?? [];
  const match = (code: string, kw: string) =>
    list.find((t: any) => (t.type_code || '').toUpperCase() === code || (t.type_name || '').toLowerCase().includes(kw));
  const tx = match('TX', 'thường xuyên') || list[0];
  const gk = match('GK', 'giữa') || list[1] || tx;
  const ck = match('CK', 'cuối') || list[2] || gk;
  return { tx: tx?.grade_type_id ?? 1, gk: gk?.grade_type_id ?? 2, ck: ck?.grade_type_id ?? 3 };
}

// Điểm TB môn một học kỳ. Trả null nếu môn không có điểm (non-scored hoặc chưa nhập).
async function subjectSemesterAvg(studentId: number, subjectId: number, semesterId: number): Promise<number | null> {
  const { data: results } = await supabase
    .from('subject_results')
    .select('result_id')
    .eq('student_id', studentId)
    .eq('subject_id', subjectId)
    .eq('semester_id', semesterId)
    .order('result_id', { ascending: false })
    .limit(1);
  const resultId = results?.[0]?.result_id;
  if (!resultId) return null;

  const { data: items } = await supabase
    .from('grade_items')
    .select('score, grade_type_id')
    .eq('result_id', resultId);
  if (!items || items.length === 0) return null;

  const { tx, gk, ck } = await getGradeTypeIds();
  let sum = 0, count = 0;
  for (const it of items) {
    const score = Number(it.score);
    if (isNaN(score)) continue;
    if (it.grade_type_id === tx) { sum += score * WEIGHT_TX; count += WEIGHT_TX; }
    else if (it.grade_type_id === gk) { sum += score * WEIGHT_GK; count += WEIGHT_GK; }
    else if (it.grade_type_id === ck) { sum += score * WEIGHT_CK; count += WEIGHT_CK; }
    else { sum += score * WEIGHT_TX; count += WEIGHT_TX; }
  }
  if (count === 0) return null;
  return Number((sum / count).toFixed(2));
}

// Kết quả học tập cả năm: trả TBCN + danh sách TBM môn CN + học lực + số môn >= 9.0.
async function computeAcademic(studentId: number, yearId: number) {
  const { data: sems } = await supabase
    .from('semesters')
    .select('semester_id')
    .eq('school_year_id', yearId)
    .order('term_order', { ascending: true });
  const semIds = (sems ?? []).map((s: any) => s.semester_id);
  if (semIds.length === 0) return { avg: null, subjects: [], academic: 'Chưa đạt', subjectsGe9: 0 };

  const { data: results } = await supabase
    .from('subject_results')
    .select('subject_id, semester_id')
    .eq('student_id', studentId)
    .in('semester_id', semIds);

  const subjectIds = Array.from(new Set((results ?? []).map((r: any) => r.subject_id)));

  const subjects: { subjectId: number; avg: number }[] = [];
  let sum = 0, count = 0;
  for (const subjId of subjectIds) {
    if (NON_SCORED_SUBJECT_IDS.has(Number(subjId))) continue; // bỏ môn Đạt/Chưa đạt
    const avg1 = await subjectSemesterAvg(studentId, subjId, semIds[0]);
    const avg2 = semIds[1] ? await subjectSemesterAvg(studentId, subjId, semIds[1]) : null;
    let yearAvg: number | null = null;
    if (avg1 != null && avg2 != null) yearAvg = (avg1 + avg2 * 2) / 3;
    else yearAvg = avg2 ?? avg1;
    if (yearAvg == null) continue;
    yearAvg = Number(yearAvg.toFixed(2));
    subjects.push({ subjectId: subjId, avg: yearAvg });
    sum += yearAvg;
    count += 1;
  }

  const avg = count === 0 ? null : Number((sum / count).toFixed(2));
  const academic = classifyAcademic(avg);
  const subjectsGe9 = subjects.filter((s) => s.avg >= 9.0).length;
  return { avg, subjects, academic, subjectsGe9 };
}

// Tổng hợp điểm danh cả năm của học sinh.
async function computeAttendance(studentId: number, yearId: number) {
  const { data: sems } = await supabase
    .from('semesters')
    .select('semester_id')
    .eq('school_year_id', yearId)
    .order('term_order', { ascending: true });
  const semIds = (sems ?? []).map((s: any) => s.semester_id);

  const { data: sessions } = await supabase
    .from('attendance_sessions')
    .select('session_id')
    .in('semester_id', semIds.length ? semIds : [-1]);

  const sessionIds = (sessions ?? []).map((s: any) => s.session_id);
  if (sessionIds.length === 0) {
    return {
      totalSchoolDays: 0, present: 0, excused: 0, unexcused: 0, late: 0, totalAbsence: 0, warning: 'NORMAL',
    };
  }

  // Phân trang để tránh giới hạn 1000 dòng của Supabase.
  let present = 0, excused = 0, unexcused = 0, late = 0;
  const CHUNK = 900;
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const chunk = sessionIds.slice(i, i + CHUNK);
    const { data: records } = await supabase
      .from('attendances')
      .select('status')
      .eq('student_id', studentId)
      .in('session_id', chunk);
    for (const r of records ?? []) {
      switch (r.status) {
        case 'PRESENT': present++; break;
        case 'ABSENT_EXCUSED': excused++; break;
        case 'ABSENT_UNEXCUSED': unexcused++; break;
        case 'LATE': late++; break;
        default: break;
      }
    }
  }

  const totalAbsence = excused + unexcused;
  const totalSchoolDays = present + totalAbsence + late;
  return {
    totalSchoolDays, present, excused, unexcused, late, totalAbsence,
    warning: classifyAttendance(totalAbsence),
  };
}

// Đề xuất danh hiệu (không xét rèn luyện).
function recommendAward(academic: string, subjectsGe9: number): string {
  if (academic === 'Tốt' && subjectsGe9 >= 6) return 'HỌC SINH XUẤT SẮC';
  if (academic === 'Tốt') return 'HỌC SINH GIỎI';
  return 'KHÔNG CÓ DANH HIỆU';
}

// Đề xuất trạng thái lên lớp.
function recommendPromotion(academic: string, warning: string): { status: string; recommendation: string } {
  let status: string;
  if (academic === 'Chưa đạt') {
    status = 'NOT_PROMOTED';
  } else {
    status = 'PROMOTED';
  }
  // Bất thường điểm danh: không tự lưu ban, chuyển sang chờ duyệt.
  if (warning === 'AT_LIMIT' || warning === 'EXCEEDED') {
    status = 'PENDING_REVIEW';
  }
  return { status, recommendation: status };
}

// ─────────────────────────────────────────────────────────────
export class PromotionEvaluationService {
  // Tính + ghi (upsert) kết quả cuối năm cho một học sinh.
  async evaluateStudent(studentId: number, yearId: number) {
    const academic = await computeAcademic(studentId, yearId);
    const attendance = await computeAttendance(studentId, yearId);
    const award = recommendAward(academic.academic, academic.subjectsGe9);
    const { status, recommendation } = recommendPromotion(academic.academic, attendance.warning);

    const payload = {
      student_id: studentId,
      school_year_id: yearId,
      total_school_days: attendance.totalSchoolDays,
      present_sessions: attendance.present,
      absent_excused_sessions: attendance.excused,
      absent_unexcused_sessions: attendance.unexcused,
      late_sessions: attendance.late,
      total_absence_sessions: attendance.totalAbsence,
      academic_result: academic.academic,
      subjects_ge_9: academic.subjectsGe9,
      award,
      promotion_status: status,
      attendance_warning: attendance.warning,
      system_recommendation: recommendation,
    };

    // Upsert theo unique (student_id, school_year_id); giữ nguyên final_result đã duyệt.
    const { data: existing } = await supabase
      .from('student_year_results')
      .select('result_id')
      .eq('student_id', studentId)
      .eq('school_year_id', yearId)
      .maybeSingle();

    let result;
    if (existing) {
      result = await supabase
        .from('student_year_results')
        .update(payload)
        .eq('result_id', existing.result_id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('student_year_results')
        .insert(payload)
        .select()
        .single();
    }

    if (result.error || !result.data) {
      return error(result.error?.message || 'Lưu kết quả thất bại', 'SAVE_FAILED');
    }
    return success(result.data);
  }

  // Tính + ghi cho toàn bộ học sinh một lớp (phân trang để tránh giới hạn 1000).
  async evaluateClass(classId: number, yearId: number) {
    const { data: students } = await supabase
      .from('students')
      .select('student_id, full_name')
      .eq('class_id', classId)
      .order('full_name');

    if (!students || students.length === 0) return error('Lớp không có học sinh', 'EMPTY');

    const rows: any[] = [];
    const errors: string[] = [];
    for (const s of students) {
      const r = await this.evaluateStudent(s.student_id, yearId);
      if (r.success) rows.push(r.data);
      else errors.push(`Học sinh ${s.student_id}: ${(r as any).error}`);
    }

    if (errors.length > 0) return error(errors.join('; '), 'PARTIAL_FAILURE');
    return success({ evaluated: rows.length, rows });
  }

  // Lấy kết quả đã tính cho một lớp (nếu chưa có, tự tính).
  async getClassResults(classId: number, yearId: number, recompute = false) {
    const { data: students } = await supabase
      .from('students')
      .select('student_id, student_code, full_name')
      .eq('class_id', classId)
      .order('full_name');

    if (!students || students.length === 0) return error('Lớp không có học sinh', 'EMPTY');
    const studentIds = students.map((s: any) => s.student_id);

    const { data: existing } = await supabase
      .from('student_year_results')
      .select('*')
      .in('student_id', studentIds)
      .eq('school_year_id', yearId);

    const byStudent = new Map<number, any>();
    (existing ?? []).forEach((r: any) => byStudent.set(r.student_id, r));

    const rows = await Promise.all(students.map(async (s: any) => {
      const rec = byStudent.get(s.student_id);
      if (rec && !recompute) {
        return { ...s, result: rec };
      }
      // Chưa có hoặc yêu cầu tính lại: tính và lưu.
      const r = await this.evaluateStudent(s.student_id, yearId);
      return { ...s, result: r.success ? r.data : null, error: r.success ? undefined : (r as any).error };
    }));

    return success(rows);
  }

  // Lấy chi tiết một học sinh.
  async getStudentResult(studentId: number, yearId: number) {
    const { data: result } = await supabase
      .from('student_year_results')
      .select('*')
      .eq('student_id', studentId)
      .eq('school_year_id', yearId)
      .maybeSingle();

    if (!result) {
      const r = await this.evaluateStudent(studentId, yearId);
      return r;
    }
    return success(result);
  }

  // GVCN/Hiệu trưởng xác nhận kết quả cuối (ghi đè final_result).
  async confirmResult(resultId: number, finalResult: string, reviewerId: number) {
    if (!['PROMOTED', 'RETAKE_REQUIRED', 'SUMMER_REMEDIAL_REQUIRED', 'NOT_PROMOTED'].includes(finalResult)) {
      return error('final_result không hợp lệ', 'VALIDATION_ERROR');
    }
    const { data, error: dbErr } = await supabase
      .from('student_year_results')
      .update({ final_result: finalResult, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
      .eq('result_id', resultId)
      .select()
      .single();
    if (dbErr) return error(dbErr.message, 'DB_ERROR');
    return success(data);
  }

  // Khóa kết quả (finalized) — không cho sửa nữa.
  async finalizeResult(resultId: number, finalizerId: number) {
    const { data, error: dbErr } = await supabase
      .from('student_year_results')
      .update({ finalized: true, finalized_by: finalizerId, finalized_at: new Date().toISOString() })
      .eq('result_id', resultId)
      .select()
      .single();
    if (dbErr) return error(dbErr.message, 'DB_ERROR');
    return success(data);
  }

  // Tổng quan danh hiệu/lên lớp theo vai trò.
  // - Admin (không có teacherId): xét theo LỚP — số lớp đã xét xong + danh sách lớp chưa xét.
  // - Giáo viên (có teacherId): xét theo HỌC SINH trong lớp GVCN — đã xét bao nhiêu học sinh.
  async overview(yearId: number, opts?: { teacherId?: number }) {
    // Lấy danh sách lớp (lọc theo GVCN nếu có).
    let classQuery = supabase.from('classes').select('*').eq('school_year_id', yearId).order('class_name');
    if (opts?.teacherId) {
      classQuery = classQuery.eq('homeroom_teacher_id', opts.teacherId);
    }
    const { data: classes } = await classQuery;
    const classList = classes ?? [];

    const classIds = classList.map((c: any) => c.class_id);

    // Số học sinh mỗi lớp (phân trang tránh giới hạn 1000).
    const studentCountByClass = new Map<number, number>();
    if (classIds.length > 0) {
      const CHUNK = 900;
      for (let i = 0; i < classIds.length; i += CHUNK) {
        const chunk = classIds.slice(i, i + CHUNK);
        const { data: sts } = await supabase
          .from('students')
          .select('student_id, class_id')
          .in('class_id', chunk);
        for (const st of sts ?? []) {
          studentCountByClass.set(st.class_id, (studentCountByClass.get(st.class_id) || 0) + 1);
        }
      }
    }

    // Số bản ghi đã TÍNH (có trong student_year_results, chưa hẳn duyệt) theo lớp.
    const computedByClass = new Map<number, number>();
    // Số bản ghi đã XÉT XONG (finalized = true) theo lớp.
    const evaluatedByClass = new Map<number, number>();
    if (classIds.length > 0) {
      const { data: allResults } = await supabase
        .from('student_year_results')
        .select('student_id, school_year_id, finalized')
        .eq('school_year_id', yearId);

      // Map student -> class từ bảng students (chỉ trong năm này).
      const classOfStudent = new Map<number, number>();
      const CHUNK = 900;
      for (let i = 0; i < classIds.length; i += CHUNK) {
        const chunk = classIds.slice(i, i + CHUNK);
        const { data: sts } = await supabase
          .from('students')
          .select('student_id, class_id')
          .in('class_id', chunk);
        for (const st of sts ?? []) {
          if (st.class_id != null) classOfStudent.set(st.student_id, st.class_id);
        }
      }

      const seen = new Set<number>();
      for (const r of allResults ?? []) {
        if (seen.has(r.student_id)) continue;
        seen.add(r.student_id);
        const cid = classOfStudent.get(r.student_id);
        if (cid == null) continue;
        computedByClass.set(cid, (computedByClass.get(cid) || 0) + 1);
        if (r.finalized) {
          evaluatedByClass.set(cid, (evaluatedByClass.get(cid) || 0) + 1);
        }
      }
    }

    // Chi tiết từng lớp.
    const classesDetail = classList.map((c: any) => {
      const total = studentCountByClass.get(c.class_id) || 0;
      const computed = computedByClass.get(c.class_id) || 0;
      const evaluated = evaluatedByClass.get(c.class_id) || 0;
      return {
        class_id: c.class_id,
        class_name: c.class_name,
        grade_level: c.grade_level,
        total_students: total,
        computed_students: computed,
        evaluated_students: evaluated,
        done: total > 0 && evaluated >= total,
        pending: total > 0 && evaluated < total,
      };
    });

    const doneClasses = classesDetail.filter((c: any) => c.done);
    const pendingClasses = classesDetail.filter((c: any) => c.pending);

    // Thống kê tổng danh hiệu/lên lớp (đã xét).
    const { data: rows } = await supabase
      .from('student_year_results')
      .select('award, promotion_status, academic_result, attendance_warning')
      .eq('school_year_id', yearId);

    const awardCounts: Record<string, number> = {};
    const promoCounts: Record<string, number> = {};
    const academicCounts: Record<string, number> = {};
    const warningCounts: Record<string, number> = {};

    for (const r of rows ?? []) {
      awardCounts[r.award] = (awardCounts[r.award] || 0) + 1;
      promoCounts[r.promotion_status] = (promoCounts[r.promotion_status] || 0) + 1;
      academicCounts[r.academic_result] = (academicCounts[r.academic_result] || 0) + 1;
      warningCounts[r.attendance_warning] = (warningCounts[r.attendance_warning] || 0) + 1;
    }

    return success({
      // Dữ liệu chung
      total: (rows ?? []).length,
      awards: awardCounts,
      promotions: promoCounts,
      academics: academicCounts,
      attendanceWarnings: warningCounts,
      // Dữ liệu theo lớp (admin)
      classes: classesDetail,
      totalClasses: classesDetail.length,
      doneClasses: doneClasses.length,
      pendingClasses: pendingClasses.map((c: any) => c.class_name),
      // Dữ liệu cho giáo viên
      teacher: opts?.teacherId
        ? {
            teacherId: opts.teacherId,
            classes: classesDetail,
            evaluatedStudents: classesDetail.reduce((sum, c) => sum + (c.evaluated_students || 0), 0),
            computedStudents: classesDetail.reduce((sum, c) => sum + (c.computed_students || 0), 0),
            totalStudents: classesDetail.reduce((sum, c) => sum + (c.total_students || 0), 0),
          }
        : null,
    });
  }
}

export const promotionEvaluationService = new PromotionEvaluationService();
