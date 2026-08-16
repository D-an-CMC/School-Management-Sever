import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';

// ─────────────────────────────────────────────────────────────
// Year Transition service
//
// Quy trình chuyển năm học (Admin duyệt):
//   1) previewTransition(fromYearId, toYearId)
//        - lấy toàn bộ học sinh của fromYear (qua enrollments hoặc classes),
//        - đọc trạng thái xét cuối năm từ student_year_results (final_result ưu tiên),
//        - tự phân lớp: khối 9 => GRADUATED (chỉ lưu dữ liệu),
//          PROMOTED => lên khối +1 (giữ nguyên chữ lớp, vd 6A -> 7A),
//          NOT_PROMOTED / RETAKE_REQUIRED / SUMMER_REMEDIAL_REQUIRED / PENDING_REVIEW
//            => cần quyết định (mặc định RETAINED ở lại cùng lớp).
//   2) applyTransition(fromYearId, toYearId, decisions)
//        - chỉ áp dụng cho học sinh cần quyết định (ở lại lớp),
//        - các học sinh còn lại tự động lên lớp / tốt nghiệp,
//        - tạo student_class_enrollments cho toYear,
//        - cập nhật students.class_id + students.status.
//   3) activateYear(toYearId)
//        - đánh dấu is_current = true cho năm mới.
// ─────────────────────────────────────────────────────────────

const GRADE_LEVELS = [6, 7, 8, 9];
// Hệ số điểm theo quy chế THCS: TX x1, GK x2, CK x3.
const WEIGHT_TX = 1;
const WEIGHT_GK = 2;
const WEIGHT_CK = 3;

interface GradeTypeInfo { grade_type_id: number; type_code?: string; type_name?: string }

async function getGradeTypeIds(): Promise<{ tx: number; gk: number; ck: number }> {
  const { data } = await supabase.from('grade_types').select('grade_type_id, type_code, type_name');
  const list: GradeTypeInfo[] = data ?? [];

  const match = (code: string, nameKw: string) =>
    list.find((t) =>
      (t.type_code || '').toUpperCase() === code ||
      (t.type_name || '').toLowerCase().includes(nameKw)
    );

  const tx = match('TX', 'thường xuyên') || list[0];
  const gk = match('GK', 'giữa') || list[1] || tx;
  const ck = match('CK', 'cuối') || list[2] || gk;

  return { tx: tx?.grade_type_id ?? 1, gk: gk?.grade_type_id ?? 2, ck: ck?.grade_type_id ?? 3 };
}

// Điểm TB môn trong một học kỳ: (ΣTX*1 + GK*2 + CK*3) / (nTX*1 + 2 + 3)
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
    // type không nhận diện: coi là TX
    else { sum += score * WEIGHT_TX; count += WEIGHT_TX; }
  }
  if (count === 0) return null;
  return sum / count;
}

// Điểm TBCN (cả năm): TB các môn của HK2, ưu tiên HK2 hơn HK1 theo quy chế.
// TBMôn CN = (TBMôn HK1 + 2*TBMôn HK2) / 3. TBCN = TB TBMôn CN.
async function computeYearAvg(studentId: number, yearId: number): Promise<number | null> {
  const { data: sems } = await supabase
    .from('semesters')
    .select('semester_id')
    .eq('school_year_id', yearId)
    .order('term_order', { ascending: true });
  const semIds = (sems ?? []).map((s: any) => s.semester_id);
  if (semIds.length === 0) return null;

  const { data: results } = await supabase
    .from('subject_results')
    .select('subject_id, semester_id')
    .eq('student_id', studentId)
    .in('semester_id', semIds);

  const subjectIds = Array.from(new Set((results ?? []).map((r: any) => r.subject_id)));

  let sum = 0, count = 0;
  for (const subjId of subjectIds) {
    const avg1 = await subjectSemesterAvg(studentId, subjId, semIds[0]);
    const avg2 = semIds[1] ? await subjectSemesterAvg(studentId, subjId, semIds[1]) : null;

    let yearAvg: number | null = null;
    if (avg1 != null && avg2 != null) yearAvg = (avg1 + avg2 * 2) / 3;
    else yearAvg = avg2 ?? avg1;

    if (yearAvg != null) { sum += yearAvg; count += 1; }
  }

  if (count === 0) return null;
  return Number((sum / count).toFixed(2));
}

// Map trạng thái xét cuối năm (student_year_results) sang quyết định chuyển năm.
// PROMOTED  -> lên lớp tự động
// NOT_PROMOTED / RETAKE_REQUIRED / SUMMER_REMEDIAL_REQUIRED / PENDING_REVIEW -> ở lại (cần quyết định)
// Khối 9   -> tốt nghiệp (không cần quyết định)
function suggestStatus(currentGrade: number | null, avg: number | null): { status: string; nextGrade: number | null; needsDecision: boolean } {
  if (!currentGrade) {
    // Không biết khối (dữ liệu cũ thiếu grade_level): bắt buộc admin quyết định.
    return { status: 'RETAINED', nextGrade: null, needsDecision: true };
  }
  const effectiveAvg = avg ?? 0;
  // Khối 9: luôn tốt nghiệp (chỉ lưu dữ liệu), không cần quyết định.
  if (currentGrade === 9) {
    return { status: 'GRADUATED', nextGrade: null, needsDecision: false };
  }
  // Dưới 5.0 (khác khối 9): cần quyết định, mặc định lưu ban.
  if (effectiveAvg < 5) {
    return { status: 'RETAINED', nextGrade: currentGrade, needsDecision: true };
  }
  // >= 5.0: tự lên lớp, khối +1.
  const nextGrade = currentGrade < 9 ? currentGrade + 1 : null;
  return { status: 'PROMOTED', nextGrade, needsDecision: false };
}

// Lấy trạng thái chuyển năm đề xuất từ kết quả xét cuối năm của học sinh.
// yearStatus: PROMOTED | NOT_PROMOTED | RETAKE_REQUIRED | SUMMER_REMEDIAL_REQUIRED | PENDING_REVIEW
function statusFromYearResult(currentGrade: number | null, yearStatus: string | null | undefined) {
  const st = (yearStatus || 'PROMOTED').toUpperCase();
  if (!currentGrade) {
    return { status: 'RETAINED', nextGrade: null, needsDecision: true };
  }
  // Khối 9: luôn tốt nghiệp.
  if (currentGrade === 9) {
    return { status: 'GRADUATED', nextGrade: null, needsDecision: false };
  }
  // Được lên lớp (PROMOTED): tự động, khối +1.
  if (st === 'PROMOTED') {
    return { status: 'PROMOTED', nextGrade: currentGrade + 1, needsDecision: false };
  }
  // Còn lại (ở lại / rèn hè / đánh giá lại / chờ duyệt): cần quyết định, mặc định lưu ban.
  return { status: 'RETAINED', nextGrade: currentGrade, needsDecision: true };
}

// Trích chữ lớp từ tên (vd "6A" -> "A", "7B" -> "B").
function classSuffix(className: string | null): string {
  if (!className) return '';
  const m = className.replace(/\d/g, '').trim();
  return m;
}

// Lấy map student_id -> promotion_status (dùng final_result nếu đã duyệt) cho một năm.
// Trả về trạng thái ưu tiên: final_result (nếu != null) còn không thì promotion_status.
async function yearResultStatusByStudent(yearId: number): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const PAGE = 900;
  let offset = 0;
  for (;;) {
    const { data } = await supabase
      .from('student_year_results')
      .select('student_id, promotion_status, final_result')
      .eq('school_year_id', yearId)
      .range(offset, offset + PAGE - 1);
    const rows = data ?? [];
    for (const r of rows) {
      const st = (r.final_result != null && String(r.final_result).trim() !== '')
        ? String(r.final_result)
        : String(r.promotion_status ?? 'PROMOTED');
      map.set(Number(r.student_id), st);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return map;
}

// Tìm lớp mới của toYear theo khối + chữ lớp (vd 6A -> 7A).
async function findTargetClass(toYearId: number, gradeLevel: number | null, suffix: string): Promise<number | null> {
  if (!suffix || gradeLevel == null) return null;
  const { data: classes } = await supabase
    .from('classes')
    .select('class_id, class_name, grade_level')
    .eq('school_year_id', toYearId);
  for (const c of classes ?? []) {
    if (c.grade_level === gradeLevel && classSuffix(c.class_name) === suffix) {
      return c.class_id;
    }
  }
  return null;
}

async function getYearById(yearId: number) {
  const { data } = await supabase.from('school_years').select('*').eq('school_year_id', yearId).maybeSingle();
  return data;
}

// Tạo 2 học kỳ (HK1/HK2) cho năm học nếu chưa có — dữ liệu bắt buộc cho
// gradebook/timetable/sự kiện của năm mới. HK1: từ start_date → 14/01 năm sau;
// HK2: 15/01 → end_date.
async function ensureSemesters(yearId: number) {
  if (!yearId) return;
  const { data: existing } = await supabase
    .from('semesters')
    .select('semester_id')
    .eq('school_year_id', yearId);
  if (existing && existing.length > 0) return;

  const { data: year } = await supabase
    .from('school_years')
    .select('start_date, end_date')
    .eq('school_year_id', yearId)
    .maybeSingle();

  const start = year?.start_date ? new Date(year.start_date) : null;
  const end = year?.end_date ? new Date(year.end_date) : null;
  const hk1End = start ? new Date(start.getTime()) : null;
  // H9: setMonth(0,14) chỉ đổi tháng/ngày TRONG năm hiện tại — phải vượt sang năm sau
  // (HK1 đặt 14/01 của năm kế tiếp, vì HK1 nằm ở cuối năm học cũ).
  if (hk1End) {
    hk1End.setFullYear(start!.getFullYear() + 1);
    hk1End.setMonth(0, 14);
  }
  const hk2Start = hk1End ? new Date(hk1End.getTime() + 86400000) : null; // 15/01

  await supabase.from('semesters').insert([
    {
      school_year_id: yearId,
      semester_name: 'Học kỳ 1',
      term_order: 1,
      start_date: start,
      end_date: hk1End,
      is_active: true,
    },
    {
      school_year_id: yearId,
      semester_name: 'Học kỳ 2',
      term_order: 2,
      start_date: hk2Start,
      end_date: end,
      is_active: false,
    },
  ]);
}

// Lấy học sinh của năm: ưu tiên qua enrollments (lịch sử chuẩn), fallback students.class_id.
async function studentsOfYear(yearId: number): Promise<any[]> {
  const { data: sems } = await supabase
    .from('semesters')
    .select('semester_id')
    .eq('school_year_id', yearId)
    .order('term_order', { ascending: true });

  // Cách 1: từ enrollments.
  const { data: enr } = await supabase
    .from('student_class_enrollments')
    .select('student_id, class_id, grade_level')
    .eq('school_year_id', yearId);

  if (enr && enr.length > 0) {
    const studentIds = enr.map((e: any) => e.student_id);
    const { data: students } = await supabase
      .from('students')
      .select('student_id, student_code, full_name, status')
      .in('student_id', studentIds);
    const byId = new Map((students ?? []).map((s: any) => [s.student_id, s]));
    return enr.map((e: any) => ({
      student_id: e.student_id,
      class_id: e.class_id,
      grade_level: e.grade_level,
      student_code: byId.get(e.student_id)?.student_code ?? '',
      full_name: byId.get(e.student_id)?.full_name ?? '',
      status: byId.get(e.student_id)?.status ?? 'ACTIVE',
    }));
  }

  // Cách 2: qua students.class_id (năm cũ không có enrollment — dữ liệu cũ).
  const { data: classes } = await supabase
    .from('classes')
    .select('class_id, grade_level')
    .eq('school_year_id', yearId);
  const classIds = (classes ?? []).map((c: any) => c.class_id);
  if (classIds.length === 0) return [];

  const { data: students } = await supabase
    .from('students')
    .select('student_id, student_code, full_name, class_id, status')
    .in('class_id', classIds);

  return (students ?? []).map((s: any) => {
    const cls = (classes ?? []).find((c: any) => c.class_id === s.class_id);
    return {
      student_id: s.student_id,
      class_id: s.class_id,
      grade_level: cls?.grade_level ?? null,
      student_code: s.student_code ?? '',
      full_name: s.full_name,
      status: s.status ?? 'ACTIVE',
    };
  });
}

export class YearTransitionService {
  // Trả về danh sách học sinh năm cũ kèm điểm TBCN và đề xuất.
  async previewTransition(fromYearId: number, toYearId: number) {
    const fromYear = await getYearById(fromYearId);
    const toYear = await getYearById(toYearId);
    if (!fromYear) return error('Không tìm thấy năm học cũ', 'NOT_FOUND');
    if (!toYear) return error('Không tìm thấy năm học mới', 'NOT_FOUND');

    const students = await studentsOfYear(fromYearId);

    // Tìm tên lớp cũ cho từng học sinh (để suy ra lớp mới cùng chữ).
    const classIds = Array.from(new Set(students.map((s: any) => s.class_id).filter(Boolean)));
    const { data: classRows } = classIds.length
      ? await supabase.from('classes').select('class_id, class_name').in('class_id', classIds)
      : { data: [] };
    const classById = new Map((classRows ?? []).map((c: any) => [c.class_id, c.class_name]));

    // Trạng thái xét cuối năm (dựa trên student_year_results).
    const yearStatusByStudent = await yearResultStatusByStudent(fromYearId);

    const rows = await Promise.all(students.map(async (s: any) => {
      const yearStatus = yearStatusByStudent.get(Number(s.student_id));
      let avgScore: number | null = null;
      let suggestion;
      if (yearStatus == null) {
        // Chưa có kết quả xét cuối năm: dựa trên điểm TBCN thực tế (computeYearAvg).
        avgScore = await computeYearAvg(Number(s.student_id), fromYearId);
        suggestion = suggestStatus(s.grade_level, avgScore);
      } else {
        suggestion = statusFromYearResult(s.grade_level, yearStatus);
      }
      const oldClassName = classById.get(s.class_id) ?? null;
      const suffix = classSuffix(oldClassName);

      let suggestedClassId: number | null = null;
      if (suggestion.status === 'PROMOTED') {
        suggestedClassId = await findTargetClass(toYearId, suggestion.nextGrade!, suffix);
      } else if (suggestion.status === 'RETAINED') {
        suggestedClassId = await findTargetClass(toYearId, s.grade_level, suffix);
      }

      return {
        student_id: s.student_id,
        student_code: s.student_code,
        full_name: s.full_name,
        current_class_id: s.class_id,
        current_class_name: oldClassName,
        current_grade_level: s.grade_level,
        student_status: s.status,
        year_status: yearStatus ?? '',
        avg_score: avgScore,
        needs_decision: suggestion.needsDecision,
        suggested_status: suggestion.status,      // PROMOTED / RETAINED / GRADUATED
        suggested_grade_level: suggestion.nextGrade, // null nếu tốt nghiệp
        suggested_class_id: suggestedClassId,
      };
    }));

    return success({
      fromYear,
      toYear,
      students: rows,
    });
  }

  // Tạo lớp mới cho toYear theo grade_level (nếu chưa có). Trả về danh sách lớp.
  async ensureClasses(toYearId: number) {
    const { data: existing } = await supabase
      .from('classes')
      .select('class_id, class_name, grade_level, homeroom_teacher_id, fixed_room_id')
      .eq('school_year_id', toYearId);

    const existingMap = new Map<string, any>();
    (existing ?? []).forEach((c: any) => existingMap.set(`${c.grade_level}_${c.class_name}`, c));

    const created: any[] = [];
    // Lấy tên lớp từ năm cũ làm mẫu (vd 6A, 6B...). Fallback tên mặc định.
    const { data: prevClasses } = await supabase
      .from('classes')
      .select('class_name, grade_level')
      .order('class_name');

    const namesByGrade = new Map<number, string[]>();
    (prevClasses ?? []).forEach((c: any) => {
      if (c.grade_level == null) return;
      const key = `${c.class_name}`.replace(/^\d/, ''); // bỏ số khối, giữ chữ (A,B,C)
      if (!namesByGrade.has(c.grade_level)) namesByGrade.set(c.grade_level, []);
      if (!namesByGrade.get(c.grade_level)!.includes(key)) namesByGrade.get(c.grade_level)!.push(key);
    });

    // Map (grade, suffix) -> lớp cũ có dữ liệu (GVCN / phòng riêng biệt),
    // ưu tiên năm gần nhất — để giữ nguyên GVCN + phòng cố định cho năm mới.
    const { data: prevClassMeta } = await supabase
      .from('classes')
      .select('class_name, grade_level, homeroom_teacher_id, fixed_room_id, school_year_id')
      .neq('school_year_id', toYearId);

    const homeroomByKey = new Map<string, any>();
    const roomByKey = new Map<string, any>();
    const metaKeyOf = (c: any) => `${c.grade_level}_${String(c.class_name).replace(/^\d/, '')}`;
    for (const c of prevClassMeta ?? []) {
      const key = metaKeyOf(c);
      const y = Number(c.school_year_id);
      if (c.homeroom_teacher_id != null) {
        const cur = homeroomByKey.get(key);
        if (!cur || y > Number(cur.school_year_id)) homeroomByKey.set(key, c);
      }
      if (c.fixed_room_id != null) {
        const cur = roomByKey.get(key);
        if (!cur || y > Number(cur.school_year_id)) roomByKey.set(key, c);
      }
    }
    const metaFor = (grade: number, className: string) => {
      const key = `${grade}_${className.replace(/^\d/, '')}`;
      return { homeroom: homeroomByKey.get(key) ?? null, room: roomByKey.get(key) ?? null };
    };

    for (const grade of GRADE_LEVELS) {
      const names = namesByGrade.get(grade) || ['A', 'B', 'C'];
      for (const suffix of names) {
        const className = `${grade}${suffix}`;
        const existingRow = existingMap.get(`${grade}_${className}`);
        // Lớp đã có nhưng thiếu GVCN/phòng (do tạo trước khi heal) -> bổ sung.
        if (existingRow) {
          const meta = metaFor(grade, className);
          const patch: any = {};
          if (existingRow.homeroom_teacher_id == null) patch.homeroom_teacher_id = meta.homeroom?.homeroom_teacher_id ?? null;
          if (existingRow.fixed_room_id == null) patch.fixed_room_id = meta.room?.fixed_room_id ?? null;
          if (Object.keys(patch).length > 0) {
            await supabase.from('classes').update(patch).eq('class_id', existingRow.class_id);
          }
          continue;
        }
        const meta = metaFor(grade, className);
        const { data: row, error: dbErr } = await supabase
          .from('classes')
          .insert({
            school_year_id: toYearId,
            class_name: className,
            grade_level: grade,
            homeroom_teacher_id: meta.homeroom?.homeroom_teacher_id ?? null,
            fixed_room_id: meta.room?.fixed_room_id ?? null,
          })
          .select('*')
          .single();
        if (dbErr) continue;
        created.push(row);
      }
    }

    const { data: all } = await supabase
      .from('classes')
      .select('*')
      .eq('school_year_id', toYearId)
      .order('class_name');

    return success(all ?? created);
  }

  // Phân lớp học sinh vào toYear.
  // decisions: [{student_id, status, class_id}] — chỉ cần cho học sinh cần quyết định (avg < 5).
  // Học sinh không nằm trong decisions sẽ tự động xử lý (lên lớp / tốt nghiệp).
  async applyTransition(fromYearId: number, toYearId: number, decisions: any[]) {
    if (!fromYearId || !toYearId) {
      return error('Thiếu fromYearId / toYearId', 'VALIDATION_ERROR');
    }

    const students = await studentsOfYear(fromYearId);
    if (students.length === 0) {
      return error('Không có học sinh trong năm học cũ', 'EMPTY');
    }

    const decisionsByStudent = new Map<number, any>();
    (decisions ?? []).forEach((d) => {
      const sid = Number(d.student_id);
      if (sid) decisionsByStudent.set(sid, d);
    });

    // Tên lớp cũ để suy ra lớp mới.
    const classIds = Array.from(new Set(students.map((s: any) => s.class_id).filter(Boolean)));
    const { data: classRows } = classIds.length
      ? await supabase.from('classes').select('class_id, class_name').in('class_id', classIds)
      : { data: [] };
    const classById = new Map((classRows ?? []).map((c: any) => [c.class_id, c.class_name]));

    // H7b: decisions gửi class_id tuỳ ý — chỉ chấp nhận lớp THUỘC năm đích.
    const { data: targetYearClasses } = await supabase
      .from('classes')
      .select('class_id')
      .eq('school_year_id', toYearId);
    const validTargetClassIds = new Set((targetYearClasses ?? []).map((c: any) => Number(c.class_id)));

    const errors: string[] = [];
    let enrolled = 0;

    // Trạng thái xét cuối năm (dựa trên student_year_results).
    const yearStatusByStudent = await yearResultStatusByStudent(fromYearId);

    for (const s of students) {
      const studentId = Number(s.student_id);
      const gradeRaw = s.grade_level;
      const grade = Number(gradeRaw);
      const yearStatus = yearStatusByStudent.get(studentId) ?? '';
      // Chưa có kết quả xét cuối năm: tính lại từ điểm TBCN thực tế (giống preview).
      let suggestion;
      if (!yearStatus) {
        const avg = await computeYearAvg(studentId, fromYearId);
        suggestion = suggestStatus(isNaN(grade) ? null : grade, avg);
      } else {
        suggestion = statusFromYearResult(isNaN(grade) ? null : grade, yearStatus);
      }
      const oldClassName = classById.get(s.class_id) ?? null;
      const suffix = classSuffix(oldClassName);

      const decision = decisionsByStudent.get(studentId);
      // Quyết định ghi đè (nếu có), ngược lại dùng đề xuất tự động.
      const status = decision && decision.status ? String(decision.status).toUpperCase() : suggestion.status;
      const decisionClassId = validTargetClassIds.has(Number(decision?.class_id)) ? decision?.class_id : undefined;

      // Xác định lớp mới.
      let classId: number | null = null;
      let gradeLevel: number | null = grade;
      if (status === 'GRADUATED' || status === 'TRANSFERRED') {
        classId = null;
        gradeLevel = null;
      } else if (status === 'PROMOTED') {
        const nextGrade = grade < 9 ? grade + 1 : null;
        gradeLevel = nextGrade;
        classId = decisionClassId ?? await findTargetClass(toYearId, nextGrade!, suffix);
      } else { // RETAINED
        gradeLevel = grade;
        classId = decisionClassId ?? await findTargetClass(toYearId, grade, suffix);
      }

      // upsert enrollment cho toYear.
      const { data: existing } = await supabase
        .from('student_class_enrollments')
        .select('enrollment_id')
        .eq('student_id', studentId)
        .eq('school_year_id', toYearId)
        .maybeSingle();

      const payload = {
        student_id: studentId,
        class_id: classId,
        school_year_id: toYearId,
        grade_level: gradeLevel,
        status,
      };

      if (existing) {
        const { error: upErr } = await supabase
          .from('student_class_enrollments')
          .update(payload)
          .eq('enrollment_id', existing.enrollment_id);
        if (upErr) { errors.push(`Học sinh ${studentId}: ${upErr.message}`); continue; }
      } else {
        const { error: insErr } = await supabase
          .from('student_class_enrollments')
          .insert(payload);
        if (insErr) { errors.push(`Học sinh ${studentId}: ${insErr.message}`); continue; }
      }

      enrolled++;

      // Cập nhật hồ sơ học sinh.
      const studentUpdate: any = {};
      if (status === 'GRADUATED') studentUpdate.status = 'GRADUATED';
      else if (status === 'TRANSFERRED') studentUpdate.status = 'TRANSFERRED';
      else studentUpdate.status = 'ACTIVE';

      if (status === 'PROMOTED' || status === 'RETAINED') {
        studentUpdate.class_id = classId;
      } else {
        studentUpdate.class_id = null;
      }

      const { error: stErr } = await supabase
        .from('students')
        .update(studentUpdate)
        .eq('student_id', studentId);
      if (stErr) errors.push(`Học sinh ${studentId} (hồ sơ): ${stErr.message}`);
    }

    if (errors.length > 0) {
      return error(errors.join('; '), 'PARTIAL_FAILURE');
    }

    // Đảm bảo năm mới có đủ học kỳ (gradebook/TKB phụ thuộc semesters).
    await ensureSemesters(toYearId);
    return success({ enrolled });
  }

  // Đánh dấu toYear là năm hiện tại (kích hoạt năm học mới).
  async activateYear(yearId: number) {
    const { data: exists } = await supabase
      .from('school_years')
      .select('school_year_id')
      .eq('school_year_id', yearId)
      .maybeSingle();
    if (!exists) return error('Không tìm thấy năm học', 'NOT_FOUND');

    await ensureSemesters(yearId);
    await supabase.from('school_years').update({ is_current: false }).neq('school_year_id', yearId);
    const { data, error: dbErr } = await supabase
      .from('school_years')
      .update({ is_current: true })
      .eq('school_year_id', yearId)
      .select()
      .single();
    if (dbErr) return error(dbErr.message, 'DB_ERROR');
    return success(data);
  }

  // Trạng thái tổng quan cho màn hình chuyển năm.
  async overview() {
    const { data: years } = await supabase
      .from('school_years')
      .select('*')
      .order('start_date', { ascending: false });
    const { count: studentCount } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true });
    const { count: enrCount } = await supabase
      .from('student_class_enrollments')
      .select('*', { count: 'exact', head: true });

    return success({
      years: years ?? [],
      totalStudents: studentCount ?? 0,
      totalEnrollments: enrCount ?? 0,
    });
  }
}

export const yearTransitionService = new YearTransitionService();
