import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';
import { env } from '../config/env';

// Môn "Đạt/Chưa đạt" — không gọi ML.
const NON_SCORED_SUBJECT_IDS = new Set<number>([4, 9, 14, 15, 35, 36, 37]);

function getMlBase(): string {
  return (env.ML_API_URL || '').trim().replace(/\/+$/, '');
}

function calcAvg(tx: number[], gk: number | null, ck: number | null): number | null {
  const validTx = tx.filter((n) => Number.isFinite(n));
  let total = validTx.reduce((a, b) => a + b, 0);
  let weight = validTx.length;
  if (gk != null && Number.isFinite(gk)) {
    total += gk * 2;
    weight += 2;
  }
  if (ck != null && Number.isFinite(ck)) {
    total += ck * 3;
    weight += 3;
  }
  if (weight === 0) return null;
  return Math.round((total / weight) * 10) / 10;
}

async function callMlPredict(payload: Record<string, any>): Promise<{ prediction: number; model: string }> {
  const base = getMlBase();
  if (!base) throw new Error('ML_NOT_CONFIGURED');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.ML_API_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.success !== true) {
      throw new Error(json?.detail || json?.error || `ML_API_${res.status}`);
    }
    return { prediction: Number(json.prediction), model: String(json.model || '') };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveSemester(semesterId?: number) {
  if (semesterId) {
    const { data } = await supabase
      .from('semesters')
      .select('semester_id, school_year_id, term_order')
      .eq('semester_id', semesterId)
      .maybeSingle();
    if (data) return data;
  }
  const { data: currentYear } = await supabase
    .from('school_years')
    .select('school_year_id')
    .eq('is_current', true)
    .maybeSingle();
  if (currentYear) {
    const { data: activeSem } = await supabase
      .from('semesters')
      .select('semester_id, school_year_id, term_order')
      .eq('school_year_id', currentYear.school_year_id)
      .eq('is_active', true)
      .maybeSingle();
    if (activeSem) return activeSem;
  }
  const { data: firstSem } = await supabase
    .from('semesters')
    .select('semester_id, school_year_id, term_order')
    .order('semester_id', { ascending: true })
    .limit(1)
    .maybeSingle();
  return firstSem;
}

type StudentScore = { tx: number[]; gk: number | null; ck: number | null };

async function getClassSubjectScores(
  studentIds: number[],
  subjectId: number,
  semesterId: number
): Promise<Map<number, StudentScore>> {
  const map = new Map<number, StudentScore>();
  for (const sid of studentIds) map.set(sid, { tx: [], gk: null, ck: null });

  const { data: results } = await supabase
    .from('subject_results')
    .select('result_id, student_id')
    .in('student_id', studentIds)
    .eq('subject_id', subjectId)
    .eq('semester_id', semesterId)
    .order('result_id', { ascending: false });
  if (!results || results.length === 0) return map;

  // Giữ result mới nhất mỗi HS (chống duplicate).
  const seen = new Set<number>();
  const activeIds: number[] = [];
  const resultToStudent = new Map<number, number>();
  for (const r of results as any[]) {
    if (seen.has(r.student_id)) continue;
    seen.add(r.student_id);
    activeIds.push(r.result_id);
    resultToStudent.set(r.result_id, r.student_id);
  }

  const { data: items } = await supabase
    .from('grade_items')
    .select('result_id, score, grade_types(type_code, type_name)')
    .in('result_id', activeIds);
  for (const g of (items as any[]) || []) {
    const sid = resultToStudent.get(g.result_id);
    if (sid == null) continue;
    const entry = map.get(sid)!;
    const code = String(g.grade_types?.type_code || '').toUpperCase();
    const name = String(g.grade_types?.type_name || '').toLowerCase();
    const isMid = code === 'GK' || name.includes('giữa') || name.includes('mid');
    const isFinal = code === 'CK' || name.includes('cuối') || name.includes('final');
    const score = Number(g.score);
    if (!Number.isFinite(score)) continue;
    if (isMid) entry.gk = score;
    else if (isFinal) entry.ck = score;
    else entry.tx.push(score);
  }
  // Chuẩn hoá TX về đúng 4 cột, thiếu → NaN để ML báo thiếu.
  return map;
}

export class MlService {
  async health() {
    const base = getMlBase();
    if (!base) return error('Chưa cấu hình ML_API_URL', 'ML_NOT_CONFIGURED');
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${base}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      const json: any = await res.json().catch(() => ({}));
      return success({ configured: true, base, ml: json });
    } catch (e: any) {
      return error(`Không kết nối được ML API: ${e?.message || e}`, 'ML_UNREACHABLE');
    }
  }

  /**
   * Dự đoán CK + ĐTB môn cho cả lớp (1 môn).
   * Client grade-management gọi API này để fill cột "AI Dự Đoán".
   */
  async predictClass(classId: number, subjectId: number, semesterId?: number) {
    const base = getMlBase();
    if (!base) return error('Chưa cấu hình ML_API_URL', 'ML_NOT_CONFIGURED');
    if (!classId || !subjectId) return error('Thiếu classId/subjectId', 'VALIDATION_ERROR');
    if (NON_SCORED_SUBJECT_IDS.has(Number(subjectId))) {
      return error('Môn Đạt/Chưa đạt không dự đoán điểm số', 'NON_SCORED_SUBJECT');
    }

    const { data: cls } = await supabase
      .from('classes')
      .select('class_id, class_name, grade_level, school_year_id')
      .eq('class_id', classId)
      .maybeSingle();
    if (!cls) return error('Không tìm thấy lớp', 'CLASS_NOT_FOUND');
    const gradeLevel = Number((cls as any).grade_level || 0);
    if (!(gradeLevel >= 6 && gradeLevel <= 9)) {
      return error(`Model ML chỉ hỗ trợ khối 6-9 (lớp này grade_level=${gradeLevel})`, 'GRADE_UNSUPPORTED');
    }

    const sem: any = await resolveSemester(semesterId);
    if (!sem) return error('Không xác định được học kỳ', 'SEMESTER_NOT_FOUND');
    const semesterLabel = Number(sem.term_order) === 2 ? 'II' : 'I';
    const semId = Number(sem.semester_id);

    // Danh sách HS của lớp (theo enrollments = nguồn lịch sử chuẩn).
    let enrQ = supabase.from('student_class_enrollments').select('student_id').eq('class_id', classId);
    if ((cls as any).school_year_id != null) enrQ = enrQ.eq('school_year_id', (cls as any).school_year_id);
    const { data: enrRows } = await enrQ;
    const studentIds = ((enrRows as any[]) || []).map((r) => Number(r.student_id)).filter(Boolean);
    if (studentIds.length === 0) return success({ semester: semesterLabel, predictions: [] });

    const scoreMap = await getClassSubjectScores(studentIds, Number(subjectId), semId);

    // DTB1 cho kỳ II = ĐTB môn của HK I (tính từ grade_items HK trước).
    let prevMap: Map<number, StudentScore> | null = null;
    if (semesterLabel === 'II') {
      const { data: prevSem } = await supabase
        .from('semesters')
        .select('semester_id')
        .eq('school_year_id', sem.school_year_id)
        .eq('term_order', 1)
        .maybeSingle();
      if (prevSem) prevMap = await getClassSubjectScores(studentIds, Number(subjectId), Number((prevSem as any).semester_id));
    }

    const predictions: any[] = [];
    // Gọi ML theo batch 10 để không quá tải Render free (1 worker).
    const ids = [...scoreMap.keys()];
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const results = await Promise.all(
        batch.map(async (sid) => {
          const s = scoreMap.get(sid)!;
          const validTx = s.tx.filter((n) => Number.isFinite(n));
          // Cần ít nhất 1 điểm TX + 1 điểm GK mới dự đoán được.
          if (validTx.length === 0 || s.gk == null) {
            return {
              student_id: sid,
              predicted_ck: null,
              predicted_avg: null,
              current_avg: calcAvg(s.tx, s.gk, s.ck),
              reason: s.gk == null ? 'Thiếu điểm Giữa kỳ (GK)' : 'Chưa có điểm Thường xuyên (TX)',
            };
          }
          // Bù điểm TX nếu học sinh mới có 1-3 cột TX bằng trung bình các điểm TX hiện có
          const avgTx = validTx.reduce((a, b) => a + b, 0) / validTx.length;
          const tx1 = validTx[0];
          const tx2 = validTx[1] ?? avgTx;
          const tx3 = validTx[2] ?? avgTx;
          const tx4 = validTx[3] ?? avgTx;

          let dtb1: number | undefined;
          if (semesterLabel === 'II' && prevMap) {
            const p = prevMap.get(sid);
            if (p) {
              const prevAvg = calcAvg(p.tx, p.gk, p.ck);
              if (prevAvg != null) dtb1 = prevAvg;
            }
          }
          try {
            const { prediction, model } = await callMlPredict({
              grade: gradeLevel,
              semester: semesterLabel,
              TX1: tx1,
              TX2: tx2,
              TX3: tx3,
              TX4: tx4,
              GK: s.gk,
              ...(dtb1 != null ? { DTB1: dtb1 } : {}),
            });
            return {
              student_id: sid,
              predicted_ck: prediction,
              predicted_avg: calcAvg(s.tx, s.gk, prediction),
              current_avg: calcAvg(s.tx, s.gk, s.ck),
              ck_actual: s.ck,
              model,
              ...(dtb1 != null ? { dtb1 } : {}),
            };
          } catch (e: any) {
            return {
              student_id: sid,
              predicted_ck: null,
              predicted_avg: null,
              current_avg: calcAvg(s.tx, s.gk, s.ck),
              reason: e?.message || 'ML_ERROR',
            };
          }
        })
      );
      predictions.push(...results);
    }

    return success({
      class_id: classId,
      class_name: (cls as any).class_name,
      grade_level: gradeLevel,
      subject_id: Number(subjectId),
      semester_id: semId,
      semester: semesterLabel,
      count: predictions.length,
      predictions,
    });
  }

  /**
   * Dự đoán ĐTB học kỳ cho 1 HS (gộp tất cả môn có điểm).
   * Công thức ĐTB HK = trung bình các TBM (TBM = (TX + GK*2 + CK_pred*3)/(nTX+5)).
   */
  async predictStudentSemester(studentId: number, semesterId?: number) {
    const base = getMlBase();
    if (!base) return error('Chưa cấu hình ML_API_URL', 'ML_NOT_CONFIGURED');
    if (!studentId) return error('Thiếu studentId', 'VALIDATION_ERROR');

    const { data: stu } = await supabase
      .from('students')
      .select('student_id, full_name, student_code')
      .eq('student_id', studentId)
      .maybeSingle();
    if (!stu) return error('Không tìm thấy học sinh', 'STUDENT_NOT_FOUND');

    // Lớp hiện tại của HS để lấy grade_level.
    const { data: enr } = await supabase
      .from('student_class_enrollments')
      .select('class_id, classes(class_id, class_name, grade_level, school_year_id)')
      .eq('student_id', studentId)
      .order('enrollment_id', { ascending: false })
      .limit(1)
      .maybeSingle();
    const cls: any = (enr as any)?.classes;
    const gradeLevel = Number(cls?.grade_level || 0);
    if (!(gradeLevel >= 6 && gradeLevel <= 9)) {
      return error(`Model ML chỉ hỗ trợ khối 6-9 (grade_level=${gradeLevel})`, 'GRADE_UNSUPPORTED');
    }

    const sem: any = await resolveSemester(semesterId);
    if (!sem) return error('Không xác định được học kỳ', 'SEMESTER_NOT_FOUND');
    const semesterLabel = Number(sem.term_order) === 2 ? 'II' : 'I';
    const semId = Number(sem.semester_id);

    const { data: results } = await supabase
      .from('subject_results')
      .select('result_id, subject_id, subjects(subject_id, subject_name)')
      .eq('student_id', studentId)
      .eq('semester_id', semId);
    if (!results || results.length === 0) {
      return success({ student_id: studentId, semester: semesterLabel, subjects: [], semester_avg_predicted: null });
    }

    const scored = (results as any[]).filter((r) => !NON_SCORED_SUBJECT_IDS.has(Number(r.subject_id)));
    const resultIds = scored.map((r) => r.result_id);
    const { data: items } = resultIds.length
      ? await supabase.from('grade_items').select('result_id, score, grade_types(type_code, type_name)').in('result_id', resultIds)
      : { data: [] as any[] };

    const byResult = new Map<number, StudentScore>();
    for (const r of scored) byResult.set(r.result_id, { tx: [], gk: null, ck: null });
    for (const g of (items as any[]) || []) {
      const e = byResult.get(g.result_id);
      if (!e) continue;
      const code = String(g.grade_types?.type_code || '').toUpperCase();
      const name = String(g.grade_types?.type_name || '').toLowerCase();
      const isMid = code === 'GK' || name.includes('giữa') || name.includes('mid');
      const isFinal = code === 'CK' || name.includes('cuối') || name.includes('final');
      const score = Number(g.score);
      if (!Number.isFinite(score)) continue;
      if (isMid) e.gk = score;
      else if (isFinal) e.ck = score;
      else e.tx.push(score);
    }

    // DTB1 từng môn (kỳ II): lấy avg HK trước.
    let prevAvgBySubject = new Map<number, number>();
    if (semesterLabel === 'II') {
      const { data: prevSem } = await supabase
        .from('semesters')
        .select('semester_id')
        .eq('school_year_id', sem.school_year_id)
        .eq('term_order', 1)
        .maybeSingle();
      if (prevSem) {
        const { data: prevResults } = await supabase
          .from('subject_results')
          .select('result_id, subject_id')
          .eq('student_id', studentId)
          .eq('semester_id', (prevSem as any).semester_id);
        const prevIds = ((prevResults as any[]) || []).map((r) => r.result_id);
        if (prevIds.length) {
          const { data: prevItems } = await supabase
            .from('grade_items')
            .select('result_id, score, grade_types(type_code, type_name)')
            .in('result_id', prevIds);
          const tmp = new Map<number, StudentScore>();
          for (const r of (prevResults as any[]) || []) tmp.set(r.result_id, { tx: [], gk: null, ck: null });
          for (const g of (prevItems as any[]) || []) {
            const e = tmp.get(g.result_id);
            if (!e) continue;
            const code = String(g.grade_types?.type_code || '').toUpperCase();
            const score = Number(g.score);
            if (code === 'GK') e.gk = score;
            else if (code === 'CK') e.ck = score;
            else e.tx.push(score);
          }
          for (const r of (prevResults as any[]) || []) {
            const e = tmp.get(r.result_id);
            if (!e) continue;
            const avg = calcAvg(e.tx, e.gk, e.ck);
            if (avg != null) prevAvgBySubject.set(Number(r.subject_id), avg);
          }
        }
      }
    }

    const subjects: any[] = [];
    for (const r of scored) {
      const e = byResult.get(r.result_id)!;
      const subjectName = (r as any).subjects?.subject_name || `Môn ${r.subject_id}`;
      const validTx = e.tx.filter((n) => Number.isFinite(n));
      if (validTx.length === 0 || e.gk == null) {
        subjects.push({
          subject_id: r.subject_id,
          subject_name: subjectName,
          predicted_ck: null,
          reason: e.gk == null ? 'Thiếu điểm Giữa kỳ (GK)' : 'Chưa có điểm Thường xuyên (TX)',
          current_avg: calcAvg(e.tx, e.gk, e.ck),
        });
        continue;
      }
      const avgTx = validTx.reduce((a, b) => a + b, 0) / validTx.length;
      const tx1 = validTx[0];
      const tx2 = validTx[1] ?? avgTx;
      const tx3 = validTx[2] ?? avgTx;
      const tx4 = validTx[3] ?? avgTx;

      try {
        const dtb1 = prevAvgBySubject.get(Number(r.subject_id));
        const { prediction, model } = await callMlPredict({
          grade: gradeLevel,
          semester: semesterLabel,
          TX1: tx1,
          TX2: tx2,
          TX3: tx3,
          TX4: tx4,
          GK: e.gk,
          ...(dtb1 != null ? { DTB1: dtb1 } : {}),
        });
        subjects.push({
          subject_id: r.subject_id,
          subject_name: subjectName,
          predicted_ck: prediction,
          predicted_avg: calcAvg(e.tx, e.gk, prediction),
          current_avg: calcAvg(e.tx, e.gk, e.ck),
          ck_actual: e.ck,
          model,
        });
      } catch (err: any) {
        subjects.push({
          subject_id: r.subject_id,
          subject_name: subjectName,
          predicted_ck: null,
          reason: err?.message || 'ML_ERROR',
          current_avg: calcAvg(e.tx, e.gk, e.ck),
        });
      }
    }

    const validAvgs = subjects.map((s) => s.predicted_avg).filter((n) => Number.isFinite(n)) as number[];
    const semesterAvg =
      validAvgs.length > 0 ? Math.round((validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length) * 10) / 10 : null;

    return success({
      student_id: studentId,
      full_name: (stu as any).full_name,
      grade_level: gradeLevel,
      semester_id: semId,
      semester: semesterLabel,
      subjects,
      semester_avg_predicted: semesterAvg,
      subjects_predicted: validAvgs.length,
      subjects_total: subjects.length,
    });
  }

  /**
   * Dự đoán trực tiếp cho bộ điểm tùy biến.
   */
  async predict(payload: {
    grade: number;
    semester: string;
    TX1: number;
    TX2?: number;
    TX3?: number;
    TX4?: number;
    GK: number;
    DTB1?: number;
  }) {
    const base = getMlBase();
    if (!base) return error('Chưa cấu hình ML_API_URL', 'ML_NOT_CONFIGURED');
    try {
      const res = await callMlPredict(payload);
      return success({
        grade: payload.grade,
        semester: payload.semester,
        predicted_ck: res.prediction,
        model: res.model,
      });
    } catch (e: any) {
      return error(e?.message || 'Không thể dự đoán', 'ML_ERROR');
    }
  }
}

export const mlService = new MlService();
