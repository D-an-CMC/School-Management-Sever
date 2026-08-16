import { queryPool } from '../../config/pg';
import { Tool, ToolContext } from '../types';

// ── Bộ tool tổng hợp thông tin (insight) — trả kết quả soạn sẵn theo đúng
// phạm vi quyền của người dùng, giúp agent trả lời 1 lượt thay vì nhiều vòng
// SQL quanh co. Mọi tool đều tự ép scope theo role — KHÔNG tin tham số người dùng.

const DAY_LABEL: Record<string, string> = {
  '2': 'Thứ 2',
  '3': 'Thứ 3',
  '4': 'Thứ 4',
  '5': 'Thứ 5',
  '6': 'Thứ 6',
  '7': 'Thứ 7',
  '8': 'Chủ nhật',
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** day_of_week (2-8) theo kiểu JS getDay() (0=CN … 6=TB) */
function vnDayFromDate(dateStr: string): string | null {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  return String(((d.getUTCDay() + 6) % 7) + 2);
}

async function activeSemester(): Promise<{ semester_id: string; semester_name: string; school_year_id: string } | null> {
  const { rows } = await queryPool<{ semester_id: string; semester_name: string; school_year_id: string }>(
    `SELECT semester_id, semester_name, school_year_id FROM semesters WHERE is_active = true ORDER BY semester_id ASC LIMIT 1`
  );
  return rows[0] ?? null;
}

/** Kiểm tra người dùng có được xem dữ liệu học sinh X không. */
async function canAccessStudent(ctx: ToolContext, studentId: number): Promise<string | null> {
  if (ctx.role === 'Admin') return null;
  if (ctx.role === 'HocSinh-PhuHuynh') {
    return ctx.studentId === studentId ? null : 'Bạn chỉ được xem dữ liệu của chính mình.';
  }
  const { rows } = await queryPool<{ ok: string }>(
    `SELECT 1 AS ok
     FROM students
     WHERE student_id = $1
       AND (class_id IN (SELECT class_id FROM classes WHERE homeroom_teacher_id = $2)
            OR class_id IN (SELECT class_id FROM teaching_assignments WHERE teacher_id = $2))`,
    [studentId, ctx.teacherId ?? 0]
  );
  return rows.length > 0 ? null : 'Học sinh này không thuộc lớp bạn chủ nhiệm hoặc dạy.';
}

/** Kiểm tra người dùng có được xem dữ liệu lớp X không. */
async function canAccessClass(ctx: ToolContext, classId: number): Promise<string | null> {
  if (ctx.role === 'Admin') return null;
  if (ctx.role === 'HocSinh-PhuHuynh') {
    const { rows } = await queryPool<{ ok: string }>(
      `SELECT 1 AS ok FROM students WHERE user_id = $1 AND class_id = $2`,
      [ctx.userId, classId]
    );
    return rows.length > 0 ? null : 'Bạn chỉ được xem dữ liệu lớp của chính mình.';
  }
  const { rows } = await queryPool<{ ok: string }>(
    `SELECT 1 AS ok FROM classes
     WHERE class_id = $1
       AND (homeroom_teacher_id = $2 OR class_id IN (SELECT class_id FROM teaching_assignments WHERE teacher_id = $2))`,
    [classId, ctx.teacherId ?? 0]
  );
  return rows.length > 0 ? null : 'Lớp này không thuộc quyền quản lý/dạy của bạn.';
}

/** class_id mặc định: học sinh → lớp của mình; giáo viên → lớp chủ nhiệm (hoặc lớp dạy đầu tiên), ưu tiên năm học hiện tại. */
async function defaultClassId(ctx: ToolContext): Promise<number | null> {
  if (ctx.role === 'HocSinh-PhuHuynh' && ctx.studentId) {
    const { rows } = await queryPool<{ class_id: string }>(`SELECT class_id FROM students WHERE student_id = $1`, [ctx.studentId]);
    return rows[0]?.class_id ? Number(rows[0].class_id) : null;
  }
  if (ctx.role === 'GiaoVien' && ctx.teacherId) {
    const year = await queryPool<{ school_year_id: string }>(
      `SELECT school_year_id FROM school_years WHERE is_current = true ORDER BY school_year_id ASC LIMIT 1`
    );
    const yearId = year.rows[0]?.school_year_id;
    const baseSql =
      `SELECT class_id FROM classes WHERE (homeroom_teacher_id = $1 OR class_id IN (SELECT class_id FROM teaching_assignments WHERE teacher_id = $1))`;
    if (yearId) {
      const { rows } = await queryPool<{ class_id: string }>(`${baseSql} AND school_year_id = $2 ORDER BY class_id ASC LIMIT 1`, [ctx.teacherId, yearId]);
      if (rows[0]) return Number(rows[0].class_id);
    }
    const { rows } = await queryPool<{ class_id: string }>(`${baseSql} ORDER BY class_id ASC LIMIT 1`, [ctx.teacherId]);
    return rows[0]?.class_id ? Number(rows[0].class_id) : null;
  }
  return null;
}

function table(columns: string[], rows: unknown[][], extra?: { subtables?: { title: string; columns: string[]; rows: unknown[][] }[] }): string {
  return JSON.stringify({ columns, rows, rowCount: rows.length, ...(extra?.subtables?.length ? { subtables: extra.subtables } : {}) });
}

// ── 1. get_current_context ───────────────────────────────────────
export const getCurrentContextTool: Tool = {
  name: 'get_current_context',
  description:
    `Lấy nhanh bối cảnh hiện tại: năm học đang hoạt động, học kỳ đang hoạt động, ngày hôm nay (thứ mấy), ` +
    `và thông tin của người dùng (vai trò, student_id / teacher_id, lớp của học sinh hoặc lớp chủ nhiệm của giáo viên). ` +
    `Gọi tool này TRƯỚC TIÊN khi câu hỏi liên quan đến "năm nay", "học kỳ này", "hôm nay", "tuần này"... để biết dùng school_year_id/semester_id nào.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(ctx: ToolContext): Promise<string> {
    const year = await queryPool<{ school_year_id: string; year_name: string; start_date: string | null; end_date: string | null }>(
      `SELECT school_year_id, year_name, start_date, end_date FROM school_years WHERE is_current = true ORDER BY school_year_id ASC LIMIT 1`
    );
    const sem = await activeSemester();
    const rows: unknown[][] = [
      ['Ngày hôm nay', `${todayStr()} (${DAY_LABEL[vnDayFromDate(todayStr()) ?? ''] ?? '?'})`],
      ['Năm học hiện tại', year.rows[0] ? `${year.rows[0].year_name} (school_year_id = ${year.rows[0].school_year_id})` : 'Không có (chưa cấu hình is_current)'],
      ['Học kỳ hiện tại', sem ? `${sem.semester_name} (semester_id = ${sem.semester_id})` : 'Không có (chưa cấu hình is_active)'],
      ['Bạn là', ctx.role === 'Admin' ? 'Quản trị viên' : ctx.role === 'GiaoVien' ? `Giáo viên (teacher_id = ${ctx.teacherId ?? '?'})` : `Học sinh (student_id = ${ctx.studentId ?? '?'})`],
    ];
    if (ctx.role !== 'Admin') {
      const cid = await defaultClassId(ctx);
      if (cid) {
        const { rows: crows } = await queryPool<{ class_name: string; grade_level: number }>(`SELECT class_name, grade_level FROM classes WHERE class_id = $1`, [cid]);
        rows.push([ctx.role === 'GiaoVien' ? 'Lớp của bạn' : 'Lớp của bạn', crows[0] ? `${crows[0].class_name} (khối ${crows[0].grade_level}, class_id = ${cid})` : `class_id = ${cid}`]);
      }
    }
    if (ctx.role === 'GiaoVien' && ctx.teacherId) {
      const { rows: trows } = await queryPool<{ class_name: string }>(
        `SELECT c.class_name FROM teaching_assignments ta JOIN classes c ON c.class_id = ta.class_id WHERE ta.teacher_id = $1 ORDER BY ta.class_id LIMIT 5`,
        [ctx.teacherId]
      );
      if (trows.length > 0) rows.push(['Lớp đang dạy', trows.map((r) => r.class_name).join(', ')]);
    }
    return table(['Mục', 'Giá trị'], rows);
  },
};

// ── 2. get_student_report ────────────────────────────────────────
export const getStudentReportTool: Tool = {
  name: 'get_student_report',
  description:
    `Báo cáo kết quả học tập của MỘT học sinh: điểm từng môn theo học kỳ (ĐTB môn học kỳ, ĐTB cả năm, xếp loại môn, nhận xét), ` +
    `trung bình chung mỗi học kỳ, kết quả năm học (xếp loại, số môn ≥ 9, danh hiệu, thăng cấp, cảnh báo chuyên cần) và điểm danh tổng hợp. ` +
    `Tham số student_id tùy chọn: học sinh/phụ huynh luôn lấy của chính mình; giáo viên có thể xem học sinh lớp mình dạy/Chủ nhiệm.`,
  parameters: {
    type: 'object',
    properties: { student_id: { type: 'number', description: 'ID học sinh (tùy chọn — mặc định là bản thân/học sinh trong lớp bạn)' } },
    required: [],
  },
  async execute(ctx: ToolContext, args: Record<string, any>): Promise<string> {
    let studentId = Number(args.student_id);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      if (ctx.role === 'HocSinh-PhuHuynh') studentId = ctx.studentId ?? 0;
      else studentId = 0;
    }
    if (!studentId || studentId <= 0) {
      return JSON.stringify({ error: 'Cần nêu rõ student_id của học sinh (câu hỏi kèm tên học sinh hoặc mã học sinh).' });
    }
    const denied = await canAccessStudent(ctx, studentId);
    if (denied) return JSON.stringify({ error: denied });

    const [info, marks, avg, yearly, att] = await Promise.all([
      queryPool<{ full_name: string; student_code: string; class_name: string; status: string }>(
        `SELECT st.full_name, st.student_code, c.class_name, st.status
         FROM students st LEFT JOIN classes c ON c.class_id = st.class_id WHERE st.student_id = $1`,
        [studentId]
      ),
      queryPool<{ semester_name: string; subject_name: string; dtb_mhk: string | null; dtb_mcn: string | null; ranking: string | null; teacher_comment: string | null }>(
        `SELECT sem.semester_name, sub.subject_name, r.dtb_mhk, r.dtb_mcn, r.ranking, r.teacher_comment
         FROM subject_results r
         JOIN subjects sub ON sub.subject_id = r.subject_id
         LEFT JOIN semesters sem ON sem.semester_id = r.semester_id
         WHERE r.student_id = $1
         ORDER BY sem.term_order ASC NULLS LAST, sub.subject_name`,
        [studentId]
      ),
      queryPool<{ semester_name: string; avg_mhk: string; avg_mcn: string; subject_count: string }>(
        `SELECT sem.semester_name,
                round(avg(r.dtb_mhk)::numeric, 2)::text AS avg_mhk,
                round(avg(r.dtb_mcn)::numeric, 2)::text AS avg_mcn,
                count(r.result_id)::text AS subject_count
         FROM subject_results r LEFT JOIN semesters sem ON sem.semester_id = r.semester_id
         WHERE r.student_id = $1 AND r.dtb_mhk IS NOT NULL
         GROUP BY sem.semester_id, sem.semester_name, sem.term_order
         ORDER BY sem.term_order ASC NULLS LAST`,
        [studentId]
      ),
      queryPool<{ year_name: string; academic_result: string | null; subjects_ge_9: number | null; award: string | null; promotion_status: string | null; attendance_warning: string | null; final_result: string | null }>(
        `SELECT sy.year_name, r.academic_result, r.subjects_ge_9, r.award, r.promotion_status, r.attendance_warning, r.final_result
         FROM student_year_results r JOIN school_years sy ON sy.school_year_id = r.school_year_id
         WHERE r.student_id = $1 ORDER BY r.school_year_id DESC`,
        [studentId]
      ),
      queryPool<{ status: string; cnt: string }>(
        `SELECT a.status, count(*)::text AS cnt
         FROM attendances a WHERE a.student_id = $1 GROUP BY a.status ORDER BY a.status`,
        [studentId]
      ),
    ]);

    if (info.rows.length === 0) return JSON.stringify({ error: 'Không tìm thấy học sinh này.' });

    const si = info.rows[0];
    const marksRows = marks.rows.map((m) => [
      m.semester_name ?? '?',
      m.subject_name,
      m.dtb_mhk ?? '—',
      m.dtb_mcn ?? '—',
      m.ranking ?? '—',
      m.teacher_comment ?? '—',
    ]);

    const subtables: { title: string; columns: string[]; rows: unknown[][] }[] = [];
    if (avg.rows.length > 0) {
      subtables.push({
        title: 'Trung bình chung theo học kỳ',
        columns: ['Học kỳ', 'TB cả kỳ (mhk)', 'TB cả năm (mcn)', 'Số môn'],
        rows: avg.rows.map((r) => [r.semester_name ?? '?', r.avg_mhk, r.avg_mcn ?? '—', r.subject_count]),
      });
    }
    if (yearly.rows.length > 0) {
      subtables.push({
        title: 'Kết quả từng năm học',
        columns: ['Năm học', 'Xếp loại', 'Số môn ≥ 9', 'Danh hiệu', 'Thăng cấp', 'Chuyên cần', 'Kết quả chốt'],
        rows: yearly.rows.map((r) => [
          r.year_name,
          r.academic_result ?? '—',
          r.subjects_ge_9 ?? '—',
          r.award ?? '—',
          r.promotion_status ?? '—',
          r.attendance_warning ?? '—',
          r.final_result ?? '—',
        ]),
      });
    }
    const statusMap: Record<string, string> = {};
    let attTotal = 0;
    for (const r of att.rows) { statusMap[r.status] = r.cnt; attTotal += Number(r.cnt) || 0; }
    const present = Number(statusMap['PRESENT'] ?? 0);
    if (attTotal > 0) {
      subtables.push({
        title: 'Điểm danh tổng hợp',
        columns: ['Chỉ số', 'Giá trị'],
        rows: [
          ['Tổng buổi điểm danh', String(attTotal)],
          ['Có mặt (PRESENT)', String(present)],
          ['Nghỉ có phép (ABSENT_EXCUSED)', statusMap['ABSENT_EXCUSED'] ?? '0'],
          ['Nghỉ không phép (ABSENT_UNEXCUSED)', statusMap['ABSENT_UNEXCUSED'] ?? '0'],
          ['Đi muộn (LATE)', statusMap['LATE'] ?? '0'],
          ['Tỉ lệ có mặt', attTotal > 0 ? `${Math.round((present / attTotal) * 100)}%` : '—'],
        ],
      });
    }

    return table(
      ['Học kỳ', 'Môn', 'ĐTB học kỳ', 'ĐTB cả năm', 'Xếp loại môn', 'Nhận xét'],
      marksRows,
      { subtables }
    );
  },
};

// ── 3. get_class_summary ─────────────────────────────────────────
export const getClassSummaryTool: Tool = {
  name: 'get_class_summary',
  description:
    `Tổng kết một lớp: sĩ số, điểm trung bình cả năm của lớp, phân bố xếp loại học lực, tình trạng thăng cấp, ` +
    `top 5 học sinh cao điểm nhất và danh sách học sinh cần lưu ý (học lực yếu hoặc cảnh báo chuyên cần). ` +
    `Tham số class_id tùy chọn: học sinh chỉ xem được lớp của mình; giáo viên xem lớp chủ nhiệm/dạy; Admin xem mọi lớp.`,
  parameters: {
    type: 'object',
    properties: { class_id: { type: 'number', description: 'ID lớp (tùy chọn — mặc định: lớp của người dùng)' } },
    required: [],
  },
  async execute(ctx: ToolContext, args: Record<string, any>): Promise<string> {
    let classId = Number(args.class_id);
    if (!Number.isInteger(classId) || classId <= 0) {
      const cid = await defaultClassId(ctx);
      classId = cid ?? classId;
    }
    if (!Number.isInteger(classId) || classId <= 0) {
      return JSON.stringify({ error: 'Cần nêu rõ class_id của lớp (hoặc bạn chưa thuộc lớp/chi nhánh nào).' });
    }
    const denied = await canAccessClass(ctx, classId);
    if (denied) return JSON.stringify({ error: denied });

    const year = await queryPool<{ school_year_id: string }>(
      `SELECT school_year_id FROM school_years WHERE is_current = true ORDER BY school_year_id ASC LIMIT 1`
    );
    const yearId = year.rows[0]?.school_year_id;

    const [cls, dist, promo, tops, warns, avg] = await Promise.all([
      queryPool<{ class_name: string; grade_level: number; si_so: string }>(
        `SELECT c.class_name, c.grade_level,
                (SELECT count(*)::text FROM students WHERE class_id = c.class_id AND status = 'ACTIVE') AS si_so
         FROM classes c WHERE c.class_id = $1`,
        [classId]
      ),
      queryPool<{ academic_result: string; cnt: string }>(
        `SELECT r.academic_result, count(*)::text AS cnt
         FROM student_year_results r JOIN students s ON s.student_id = r.student_id
         WHERE s.class_id = $1 AND r.school_year_id = $2 AND r.academic_result IS NOT NULL
         GROUP BY r.academic_result ORDER BY r.academic_result`,
        [classId, yearId]
      ),
      queryPool<{ promotion_status: string; cnt: string }>(
        `SELECT r.promotion_status, count(*)::text AS cnt
         FROM student_year_results r JOIN students s ON s.student_id = r.student_id
         WHERE s.class_id = $1 AND r.school_year_id = $2 AND r.promotion_status IS NOT NULL
         GROUP BY r.promotion_status ORDER BY r.promotion_status`,
        [classId, yearId]
      ),
      queryPool<{ full_name: string; tbm: string }>(
        `SELECT s.full_name, round(avg(r.dtb_mcn)::numeric, 2)::text AS tbm
         FROM students s JOIN subject_results r ON r.student_id = s.student_id AND r.dtb_mcn IS NOT NULL
         WHERE s.class_id = $1 GROUP BY s.student_id, s.full_name
         ORDER BY avg(r.dtb_mcn) DESC LIMIT 5`,
        [classId]
      ),
      queryPool<{ full_name: string; academic_result: string | null; attendance_warning: string | null }>(
        `SELECT s.full_name, r.academic_result, r.attendance_warning
         FROM student_year_results r JOIN students s ON s.student_id = r.student_id
         WHERE s.class_id = $1 AND r.school_year_id = $2
           AND (r.academic_result IN ('Yếu', 'Kém') OR r.attendance_warning IS NOT NULL AND r.attendance_warning <> 'NORMAL')
         ORDER BY s.full_name LIMIT 10`,
        [classId, yearId]
      ),
      queryPool<{ tbm_tb: string; hs_co_ket_qua: string }>(
        `SELECT round(avg(x.tb)::numeric, 2)::text AS tbm_tb, count(*)::text AS hs_co_ket_qua
         FROM (SELECT avg(r.dtb_mcn) AS tb FROM subject_results r JOIN students s ON s.student_id = r.student_id
               WHERE s.class_id = $1 AND r.dtb_mcn IS NOT NULL GROUP BY r.student_id) x`,
        [classId]
      ),
    ]);

    if (cls.rows.length === 0) return JSON.stringify({ error: 'Không tìm thấy lớp này.' });
    const c = cls.rows[0];
    const subtables: { title: string; columns: string[]; rows: unknown[][] }[] = [];
    const yearName = year.rows[0] ? `năm học ${year.rows[0].school_year_id}` : '?';
    if (dist.rows.length > 0) {
      subtables.push({ title: `Phân bố xếp loại (${yearName})`, columns: ['Xếp loại', 'Số học sinh'], rows: dist.rows.map((r) => [r.academic_result, r.cnt]) });
    }
    if (promo.rows.length > 0) {
      subtables.push({ title: 'Tình trạng thăng cấp', columns: ['Trạng thái', 'Số học sinh'], rows: promo.rows.map((r) => [r.promotion_status, r.cnt]) });
    }
    if (tops.rows.length > 0) {
      subtables.push({ title: 'Top 5 điểm cao nhất (TB cả năm)', columns: ['Học sinh', 'TB cả năm'], rows: tops.rows.map((r) => [r.full_name, r.tbm]) });
    }
    if (warns.rows.length > 0) {
      subtables.push({ title: 'Cần lưu ý', columns: ['Học sinh', 'Xếp loại', 'Cảnh báo chuyên cần'], rows: warns.rows.map((r) => [r.full_name, r.academic_result ?? '—', r.attendance_warning ?? '—']) });
    }
    if (!subtables.length) {
      subtables.push({ title: 'Lưu ý', columns: ['Thông tin'], rows: [[`Chưa có dữ liệu kết quả cho lớp này (năm hiện tại school_year_id = ${yearId ?? '?'}).`]] });
    }

    return table(
      ['Lớp', 'Khối', 'Sĩ số', 'TB cả năm của lớp', 'Số HS có điểm'],
      [[c.class_name, String(c.grade_level ?? '—'), c.si_so ?? '0', avg.rows[0]?.tbm_tb ?? '—', avg.rows[0]?.hs_co_ket_qua ?? '0']],
      { subtables }
    );
  },
};

// ── 4. get_attendance_report ─────────────────────────────────────
export const getAttendanceReportTool: Tool = {
  name: 'get_attendance_report',
  description:
    `Báo cáo điểm danh/chuyên cần. Nếu có student_id: chi tiết của học sinh đó (tổng buổi, có mặt, nghỉ có phép, nghỉ không phép, đi muộn, tỉ lệ có mặt) ` +
    `theo khoảng thời gian tùy chọn (from, to — định dạng YYYY-MM-DD). Nếu KHÔNG có student_id (giáo viên/admin), thống kê theo lớp: ` +
    `mỗi học sinh + từng trạng thái điểm danh (truyền class_id hoặc để hệ thống lấy lớp của bạn). Không có tham số khác: học sinh tự lấy của mình.`,
  parameters: {
    type: 'object',
    properties: {
      student_id: { type: 'number', description: 'ID học sinh (tùy chọn)' },
      class_id: { type: 'number', description: 'ID lớp (chỉ dùng khi tổng hợp theo lớp, tùy chọn)' },
      from: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD (tùy chọn)' },
      to: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD (tùy chọn)' },
    },
    required: [],
  },
  async execute(ctx: ToolContext, args: Record<string, any>): Promise<string> {
    const from = String(args.from ?? '').trim();
    const to = String(args.to ?? '').trim();
    let pIdx = 1; // $1 luôn là student_id hoặc class_id
    const dateClause: string[] = [];
    const dateParams: unknown[] = [];
    const pushDate = (v: string) => { pIdx += 1; dateParams.push(v); return `$${pIdx}`; };
    if (from) dateClause.push(`asn.session_date >= ${pushDate(from)}`);
    if (to) dateClause.push(`asn.session_date <= ${pushDate(to)}`);

    const studentId = Number(args.student_id);
    // Học sinh/phụ huynh không truyền student_id → mặc định lấy của chính mình
    if ((!Number.isInteger(studentId) || studentId <= 0) && ctx.role === 'HocSinh-PhuHuynh' && ctx.studentId) {
      return this.execute(ctx, { ...args, student_id: ctx.studentId });
    }
    if (Number.isInteger(studentId) && studentId > 0) {
      const denied = await canAccessStudent(ctx, studentId);
      if (denied) return JSON.stringify({ error: denied });
      const params: unknown[] = [studentId, ...dateParams];
      const extra = dateClause.length ? ` AND ${dateClause.join(' AND ')}` : '';
      const [att, info] = await Promise.all([
        queryPool<{ status: string; cnt: string }>(
          `SELECT a.status, count(*)::text AS cnt
           FROM attendances a JOIN attendance_sessions asn ON asn.session_id = a.session_id
           WHERE a.student_id = $1${extra} GROUP BY a.status ORDER BY a.status`,
          params
        ),
        queryPool<{ full_name: string; class_name: string }>(
          `SELECT st.full_name, c.class_name FROM students st LEFT JOIN classes c ON c.class_id = st.class_id WHERE st.student_id = $1`,
          [studentId]
        ),
      ]);
      const m: Record<string, string> = {};
      let total = 0;
      for (const r of att.rows) { m[r.status] = r.cnt; total += Number(r.cnt) || 0; }
      const present = Number(m['PRESENT'] ?? 0);
      return table(
        ['Chỉ số', 'Giá trị'],
        [
          ['Học sinh', info.rows[0]?.full_name ?? `#${studentId}`],
          ['Lớp', info.rows[0]?.class_name ?? '—'],
          ['Tổng buổi điểm danh', String(total)],
          ['Có mặt (PRESENT)', String(present)],
          ['Nghỉ có phép (ABSENT_EXCUSED)', m['ABSENT_EXCUSED'] ?? '0'],
          ['Nghỉ không phép (ABSENT_UNEXCUSED)', m['ABSENT_UNEXCUSED'] ?? '0'],
          ['Đi muộn (LATE)', m['LATE'] ?? '0'],
          ['Tỉ lệ có mặt', total > 0 ? `${Math.round((present / total) * 100)}%` : '—'],
        ]
      );
    }

    // Tổng hợp theo lớp
    let classId = Number(args.class_id);
    if (!Number.isInteger(classId) || classId <= 0) {
      const cid = await defaultClassId(ctx);
      classId = cid ?? 0;
    }
    if (!classId) return JSON.stringify({ error: 'Cần truyền student_id hoặc class_id để lập báo cáo điểm danh.' });
    const denied = await canAccessClass(ctx, classId);
    if (denied) return JSON.stringify({ error: denied });

    const params: unknown[] = [classId, ...dateParams];
    const extra = dateClause.length ? ` AND ${dateClause.join(' AND ')}` : '';
    const rows = await queryPool<{ full_name: string; status: string; cnt: string }>(
      `SELECT st.full_name, a.status, count(*)::text AS cnt
       FROM attendances a
       JOIN attendance_sessions asn ON asn.session_id = a.session_id
       JOIN students st ON st.student_id = a.student_id
       WHERE st.class_id = $1${extra}
       GROUP BY st.full_name, a.status ORDER BY st.full_name, a.status`,
      params
    );
    return table(
      ['Học sinh', 'Trạng thái', 'Số buổi'],
      rows.rows.map((r) => [r.full_name, r.status, r.cnt])
    );
  },
};

// ── 5. get_schedule ──────────────────────────────────────────────
export const getScheduleTool: Tool = {
  name: 'get_schedule',
  description:
    `Thời khóa biểu: liệt kê các tiết học theo thứ/tiết (môn, giờ, phòng). ` +
    `Không đối số: toàn bộ tuần của lớp/giáo viên (học sinh: lớp mình; giáo viên: các tiết mình dạy; admin: cần class_id). ` +
    `Có thể lọc theo ngày cụ thể (YYYY-MM-DD) hoặc ngày trong tuần (2=Thứ 2 … 8=Chủ nhật), class_id (tùy chọn — phải thuộc quyền).`,
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Ngày cụ thể YYYY-MM-DD — chỉ lấy tiết của ngày đó (tùy chọn)' },
      day_of_week: { type: 'number', description: 'Ngày trong tuần 2-8 (tùy chọn, 2 = Thứ 2)' },
      class_id: { type: 'number', description: 'ID lớp (tùy chọn — mặc định lớp của bạn)' },
    },
    required: [],
  },
  async execute(ctx: ToolContext, args: Record<string, any>): Promise<string> {
    const date = String(args.date ?? '').trim();
    const dowArg = Number(args.day_of_week);
    let dow: string | null = null;
    if (date) dow = vnDayFromDate(date);
    else if (Number.isInteger(dowArg) && dowArg >= 2 && dowArg <= 8) dow = String(dowArg);

    let classId: number | null = Number(args.class_id);
    const isTeacher = ctx.role === 'GiaoVien';

    const where: string[] = [];
    const params: unknown[] = [];
    if (!Number.isInteger(classId) || classId <= 0) {
      if (isTeacher && ctx.teacherId) {
        classId = null;
      } else if (ctx.role === 'Admin') {
        return JSON.stringify({ error: 'Admin cần truyền class_id để xem thời khóa biểu.' });
      } else {
        const cid = await defaultClassId(ctx);
        classId = cid;
        if (!classId) return JSON.stringify({ error: 'Không xác định được lớp của bạn.' });
      }
    }
    if (classId) {
      const denied = await canAccessClass(ctx, classId);
      if (denied) return JSON.stringify({ error: denied });
      params.push(classId);
      where.push(`t.class_id = $${params.length}`);
    } else if (isTeacher && ctx.teacherId) {
      params.push(ctx.teacherId);
      where.push(`t.teacher_id = $${params.length}`);
    }
    if (dow) {
      params.push(dow);
      where.push(`t.day_of_week = $${params.length}`);
    }
    if (date) {
      params.push(date);
      where.push(`(t.week_start IS NULL OR t.week_start <= $${params.length})`);
    }

    const baseWhere = [...where];
    const baseParams = [...params];

    const SELECT_TXT =
      `SELECT t.day_of_week, t.period_no,
              t.start_time::text AS start_time, t.end_time::text AS end_time,
              COALESCE(sub.subject_name, t.custom_subject_name, t.exam_name, '(môn khác)') AS subject_name,
              t.room
       FROM timetables t
       LEFT JOIN subjects sub ON sub.subject_id = t.subject_id`;

    // Lọc theo học kỳ hiện tại trước; nếu học kỳ hiện tại chưa có tiết (dữ liệu cũ),
    // fallback hiển thị mọi tiết còn lại trong phạm vi quyền.
    const sem = await activeSemester();
    let rows: { day_of_week: string; period_no: number; start_time: string | null; end_time: string | null; subject_name: string; room: string | null }[];
    let fallbackNote = '';
    if (sem) {
      const q1 = `${SELECT_TXT} WHERE ${where.join(' AND ')} AND t.semester_id = $${params.length + 1} ORDER BY t.day_of_week::int, t.period_no LIMIT 100`;
      const r1 = await queryPool<{ day_of_week: string; period_no: number; start_time: string | null; end_time: string | null; subject_name: string; room: string | null }>(
        q1,
        [...params, sem.semester_id]
      );
      rows = r1.rows;
      if (rows.length === 0) {
        fallbackNote = 'Học kỳ hiện tại chưa có tiết — hiển thị dữ liệu lịch gần nhất.';
        const r2 = await queryPool<{ day_of_week: string; period_no: number; start_time: string | null; end_time: string | null; subject_name: string; room: string | null }>(
          `${SELECT_TXT} WHERE ${baseWhere.join(' AND ')} ORDER BY t.day_of_week::int, t.period_no LIMIT 100`,
          baseParams
        );
        rows = r2.rows;
      }
    } else {
      const r2 = await queryPool<{ day_of_week: string; period_no: number; start_time: string | null; end_time: string | null; subject_name: string; room: string | null }>(
        `${SELECT_TXT} WHERE ${baseWhere.join(' AND ')} ORDER BY t.day_of_week::int, t.period_no LIMIT 100`,
        baseParams
      );
      rows = r2.rows;
    }
    if (rows.length === 0) {
      return JSON.stringify({ columns: ['Thứ', 'Tiết', 'Môn', 'Phòng'], rows: [], rowCount: 0, note: 'Không có tiết học nào trong phạm vi của bạn.' });
    }
    const out: Record<string, unknown> = {
      columns: ['Thứ', 'Tiết', 'Giờ bắt đầu', 'Giờ kết thúc', 'Môn', 'Phòng'],
      rows: rows.map((r) => [DAY_LABEL[r.day_of_week] ?? `Thứ ${r.day_of_week}`, String(r.period_no), r.start_time ?? '—', r.end_time ?? '—', r.subject_name, r.room ?? '—']),
      rowCount: rows.length,
    };
    if (fallbackNote) out.note = fallbackNote.trim();
    return JSON.stringify(out);
  },
};

// ── 6. get_exam_schedule ─────────────────────────────────────────
export const getExamScheduleTool: Tool = {
  name: 'get_exam_schedule',
  description:
    `Lịch thi của một lớp: ngày thi, giờ, loại thi (giữa kỳ/cuối kỳ...), môn thi, phòng thi. ` +
    `Học sinh: lịch thi của lớp mình (kèm phòng/ghế nếu có phân công). Giáo viên: lịch thi lớp mình dạy/chủ nhiệm. ` +
    `Không đối số cũng được (tự lấy lớp của bạn); có thể lọc theo class_id (phải thuộc quyền).`,
  parameters: {
    type: 'object',
    properties: {
      class_id: { type: 'number', description: 'ID lớp (tùy chọn — mặc định lớp của bạn)' },
      from: { type: 'string', description: 'Chỉ lấy lịch thi từ ngày YYYY-MM-DD trở đi (tùy chọn)' },
    },
    required: [],
  },
  async execute(ctx: ToolContext, args: Record<string, any>): Promise<string> {
    let classId = Number(args.class_id);
    if (!Number.isInteger(classId) || classId <= 0) {
      const cid = await defaultClassId(ctx);
      classId = cid ?? 0;
    }
    if (!classId) return JSON.stringify({ error: 'Cần nêu rõ class_id (hoặc bạn chưa thuộc lớp nào).' });
    const denied = await canAccessClass(ctx, classId);
    if (denied) return JSON.stringify({ error: denied });

    const params: unknown[] = [classId];
    let extra = '';
    const from = String(args.from ?? '').trim();
    if (from) { params.push(from); extra = ' AND e.exam_date >= $2'; }

    const [exams, seat] = await Promise.all([
      queryPool<{ exam_date: string; start_time: string | null; exam_type: string | null; subject_name: string; class_name: string; room: string | null }>(
        `SELECT e.exam_date, e.start_time::text AS start_time, e.exam_type,
                COALESCE(sub.subject_name, '(môn khác)') AS subject_name,
                c.class_name, e.room
         FROM exam_schedules e
         LEFT JOIN subjects sub ON sub.subject_id = e.subject_id
         LEFT JOIN classes c ON c.class_id = e.class_id
         WHERE e.class_id = $1${extra}
         ORDER BY e.exam_date, e.start_time`,
        params
      ),
      ctx.studentId
        ? queryPool<{ exam_date: string; subject_name: string; room_name: string | null; seat_no: number | null }>(
            `SELECT e.exam_date, COALESCE(sub.subject_name, '(môn khác)') AS subject_name,
                    r.room_name, a.seat_no
             FROM exam_exam_assignment a
             JOIN exam_schedules e ON e.exam_id = a.exam_schedule_id
             LEFT JOIN subjects sub ON sub.subject_id = e.subject_id
             LEFT JOIN rooms r ON r.room_id = a.room_id
             WHERE a.student_id = $1
             ORDER BY e.exam_date`,
            [ctx.studentId]
          )
        : Promise.resolve({ rows: [] as any[] }),
    ]);

    const subtables: { title: string; columns: string[]; rows: unknown[][] }[] = [];
    if (seat.rows.length > 0) {
      subtables.push({
        title: 'Phòng thi / chỗ ngồi của bạn',
        columns: ['Ngày', 'Môn', 'Phòng', 'Số báo danh / chỗ'],
        rows: seat.rows.map((r) => [r.exam_date, r.subject_name, r.room_name ?? '—', r.seat_no ?? '—']),
      });
    }
    return table(
      ['Ngày', 'Giờ', 'Loại thi', 'Môn', 'Lớp', 'Phòng'],
      exams.rows.map((r) => [r.exam_date, r.start_time ?? '—', r.exam_type ?? '—', r.subject_name, r.class_name ?? `#${classId}`, r.room ?? '—']),
      { subtables }
    );
  },
};