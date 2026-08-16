import { getPool } from '../../config/pg';
import { env } from '../../config/env';
import { Tool, ToolContext } from '../types';

// ── Bảng whitelist theo role ────────────────────────────────────
const PUBLIC_TABLES = ['school_years', 'semesters', 'subjects', 'grade_types', 'departments'];

const STUDENT_TABLES = new Set([
  'students',
  'classes',
  'subject_results',
  'grade_items',
  'timetables',
  'attendance_sessions',
  'attendances',
  'activities',
  'activity_participants',
  'notifications',
  'notification_recipients',
  ...PUBLIC_TABLES,
]);

const TEACHER_TABLES = new Set([
  ...STUDENT_TABLES,
  'teachers',
  'teaching_assignments',
  'schedule_rules',
  'rooms',
  'class_rooms',
  'exam_schedules',
  'exam_exam_assignment',
  'exam_makeup',
  'exam_proctors',
  'student_class_enrollments',
  'student_year_results',
]);

const ADMIN_TABLES = new Set([
  'users',
  'roles',
  'students',
  'teachers',
  'classes',
  'school_years',
  'semesters',
  'subjects',
  'grade_types',
  'subject_results',
  'grade_items',
  'timetables',
  'timetable_type',
  'teaching_assignments',
  'attendance_sessions',
  'attendances',
  'activities',
  'activity_participants',
  'notifications',
  'notification_recipients',
  'schedule_rules',
  'rooms',
  'class_rooms',
  'exam_schedules',
  'exam_exam_assignment',
  'exam_makeup',
  'exam_proctors',
  'student_class_enrollments',
  'student_year_results',
  'security_logs',
  'departments',
  'ai_conversations',
  'ai_messages',
  'ai_documents',
]);

function allowedTables(role: string): Set<string> {
  switch (role) {
    case 'Admin':
      return ADMIN_TABLES;
    case 'GiaoVien':
      return TEACHER_TABLES;
    default:
      return STUDENT_TABLES;
  }
}

// ── Scope predicate theo role ($1 = user_id, $2 = teacher_id) ────
const S = `(SELECT student_id FROM students WHERE user_id = $1)`;
const SC = `(SELECT class_id FROM students WHERE user_id = $1)`;
const TC =
  `(SELECT class_id FROM classes WHERE homeroom_teacher_id = $2 ` +
  `OR class_id IN (SELECT class_id FROM teaching_assignments WHERE teacher_id = $2))`;
const TS = `(SELECT subject_id FROM teaching_assignments WHERE teacher_id = $2)`;
const TSTUDENTS = `(SELECT student_id FROM students WHERE class_id IN ${TC})`;

const STUDENT_SCOPE: Record<string, string> = {
  students: `students.user_id = $1`,
  classes: `classes.class_id IN ${SC}`,
  subject_results: `subject_results.student_id IN ${S}`,
  grade_items: `grade_items.result_id IN (SELECT result_id FROM subject_results WHERE student_id IN ${S})`,
  timetables: `timetables.class_id IN ${SC}`,
  attendance_sessions: `attendance_sessions.class_id IN ${SC}`,
  attendances: `attendances.session_id IN (SELECT session_id FROM attendance_sessions WHERE class_id IN ${SC})`,
  activities: `activities.activity_id IN (SELECT activity_id FROM activity_participants WHERE student_id IN ${S})`,
  activity_participants: `activity_participants.student_id IN ${S}`,
  notifications: `notifications.notification_id IN (SELECT notification_id FROM notification_recipients WHERE user_id = $1)`,
  notification_recipients: `notification_recipients.user_id = $1`,
};

const TEACHER_SCOPE: Record<string, string> = {
  teachers: `teachers.user_id = $1`,
  classes: `classes.homeroom_teacher_id = $2 OR classes.class_id IN ${TC}`,
  teaching_assignments: `teaching_assignments.teacher_id = $2`,
  students: `students.class_id IN ${TC}`,
  subject_results:
    `subject_results.teacher_id = $2 OR ` +
    `(subject_results.subject_id IN ${TS} AND subject_results.student_id IN ${TSTUDENTS})`,
  grade_items: `grade_items.result_id IN (SELECT result_id FROM subject_results WHERE teacher_id = $2 OR (subject_id IN ${TS} AND student_id IN ${TSTUDENTS}))`,
  timetables: `timetables.teacher_id = $2 OR timetables.class_id IN ${TC}`,
  attendance_sessions: `attendance_sessions.teacher_id = $2 OR attendance_sessions.class_id IN ${TC}`,
  attendances: `attendances.session_id IN (SELECT session_id FROM attendance_sessions WHERE teacher_id = $2 OR class_id IN ${TC})`,
  activities: `activities.organizer_teacher_id = $2`,
  schedule_rules: `schedule_rules.teacher_id = $2 OR schedule_rules.subject_id IN ${TS}`,
  rooms: `rooms.room_id IN (SELECT fixed_room_id FROM classes WHERE homeroom_teacher_id = $2) OR rooms.room_id IN (SELECT room_id FROM class_rooms WHERE class_id IN ${TC})`,
  class_rooms: `class_rooms.class_id IN ${TC}`,
  exam_schedules: `exam_schedules.class_id IN ${TC}`,
  exam_exam_assignment: `exam_exam_assignment.student_id IN ${TSTUDENTS}`,
  exam_makeup: `exam_makeup.class_id IN ${TC}`,
  exam_proctors: `exam_proctors.teacher_id = $2`,
  student_class_enrollments: `student_class_enrollments.student_id IN ${TSTUDENTS}`,
  student_year_results: `student_year_results.student_id IN ${TSTUDENTS}`,
  notifications: `notifications.notification_id IN (SELECT notification_id FROM notification_recipients WHERE user_id = $1)`,
  notification_recipients: `notification_recipients.user_id = $1`,
};

function scopePredicate(table: string, role: string): string | null {
  if (role === 'Admin') return null;
  if (PUBLIC_TABLES.includes(table)) return null;
  if (role === 'GiaoVien') return TEACHER_SCOPE[table] ?? null;
  return STUDENT_SCOPE[table] ?? null;
}

// ── Validation ───────────────────────────────────────────────────
const BANNED_KEYWORDS =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|execute|call|do|vacuum|analyze|refresh|merge|replace|load|explain)\b/i;
const HAS_SEMICOLON = /;/;
const HAS_COMMENT = /(--|\/\*|\*\/)/;
const HAS_PG_INTERNAL = /\b(pg_|information_schema|citus_|timescaledb_)/i;

function extractTables(sql: string): string[] {
  const out = new Set<string>();
  // C3: trước đây chỉ bắt 1 bảng sau FROM/JOIN — "FROM students, users" chỉ bắt students,
  // bỏ lọt users khỏi whitelist + scope. Giờ bắt cả danh sách tách bằng dấu phẩy.
  const re = /(?:from|join)\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    m[1]
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .forEach((t) => out.add(t));
  }
  return [...out];
}

function validateSelect(
  sqlRaw: string,
  role: string
): { ok: true } | { ok: false; reason: string } {
  // Cho phép dấu ";" kết thúc (model hay sinh "SELECT ... ;"), chỉ chặn ";" giữa câu
  const sql = sqlRaw.trim().replace(/;\s*$/, '');
  if (!/^select\b/i.test(sql)) {
    return { ok: false, reason: 'Chỉ cho phép câu lệnh SELECT duy nhất.' };
  }
  if (HAS_SEMICOLON.test(sql)) {
    return { ok: false, reason: 'Không được dùng dấu ";" ở giữa câu — chỉ 1 lệnh SELECT.' };
  }
  if (HAS_COMMENT.test(sql)) {
    return { ok: false, reason: 'Không được dùng comment SQL (-- hoặc /* */).' };
  }
  if (HAS_PG_INTERNAL.test(sql)) {
    return { ok: false, reason: 'Không được truy cập hệ thống nội bộ Postgres (pg_*, information_schema).' };
  }
  if (BANNED_KEYWORDS.test(sql)) {
    return { ok: false, reason: 'Câu lệnh chứa thao tác ghi/dangerous — chỉ SELECT là hợp lệ.' };
  }
  const tables = extractTables(sql);
  if (tables.length === 0) {
    return { ok: false, reason: 'Không xác định được bảng trong FROM — hãy viết truy vấn rõ ràng.' };
  }
  const allowed = allowedTables(role);
  for (const t of tables) {
    if (!allowed.has(t)) {
      return {
        ok: false,
        reason: `Bảng "${t}" không nằm trong danh sách được phép của vai trò của bạn. Các bảng hợp lệ: ${[...allowed].join(', ')}`,
      };
    }
  }
  return { ok: true };
}

const KEYWORD_POS = /\b(group\s+by|order\s+by|limit|having|offset|union|except|intersect)\b/i;
const WHERE_POS = /\bwhere\b/i;

function injectScope(sql: string, predicate: string): string {
  const where = WHERE_POS.exec(sql);
  let insertAt: number;
  let prefix: string;

  if (where) {
    const after = sql.slice(where.index + where[0].length);
    const next = KEYWORD_POS.exec(after);
    prefix = sql.slice(0, where.index + where[0].length);
    insertAt = where.index + where[0].length + (next ? next.index : after.length);
    return `${prefix} (${sql.slice(where.index + where[0].length, insertAt).trim()}) AND (${predicate})${sql.slice(insertAt)}`;
  }

  const first = KEYWORD_POS.exec(sql);
  if (first) {
    prefix = sql.slice(0, first.index);
    return `${prefix} WHERE (${predicate}) ${sql.slice(first.index).trim()}`;
  }
  return `${sql.trim()} WHERE (${predicate})`;
}

function enforceLimit(sql: string, maxRows: number): string {
  const limitRe = /\blimit\s+(\d+)/gi;
  let capped = sql;
  const hasLimit = limitRe.test(sql);
  if (hasLimit) {
    capped = sql.replace(limitRe, (_m, n: string) => `limit ${Math.min(Number(n), maxRows)}`);
  } else {
    capped = `${sql.trim()} limit ${maxRows}`;
  }
  return capped;
}

// ── Tool ─────────────────────────────────────────────────────────
export const sqlTool: Tool = {
  name: 'execute_sql',
  description:
    `Chạy truy vấn SQL CHỈ ĐỌC (SELECT) trên cơ sở dữ liệu trường học và trả về kết quả dạng JSON. ` +
    `Quy tắc: (1) gọi get_db_schema trước nếu chưa rõ tên bảng/cột; (2) chỉ viết 1 lệnh SELECT, KHÔNG có dấu ";" hay comment; ` +
    `(3) KHÔNG dùng alias cho bảng, luôn tham chiếu đúng tên bảng (vd: students.full_name); ` +
    `(4) không dùng bảng ngoài danh sách được phép của vai trò của bạn — hệ thống tự ép phạm vi dữ liệu của bạn; ` +
    `(5) dùng WHERE cụ thể (không SELECT * toàn bộ bảng); (6) có thể dùng JOIN, GROUP BY, COUNT, AVG...`,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Câu lệnh SELECT hợp lệ (không có dấu ;)' },
    },
    required: ['query'],
  },
  async execute(ctx: ToolContext, args: Record<string, any>): Promise<string> {
    const query = String(args.query ?? '').trim().replace(/;\s*$/, '');
    if (!query) return JSON.stringify({ error: 'Thiếu tham số query' });

    const check = validateSelect(query, ctx.role);
    if (!check.ok) {
      const reason = 'reason' in check ? (check as { reason: string }).reason : 'Truy vấn không hợp lệ';
      return JSON.stringify({ error: reason });
    }

    const involved = extractTables(query)
      .map((t) => ({ t, p: scopePredicate(t, ctx.role) }))
      .filter((x) => x.p);

    const clauses = involved.map((x) => x.p as string);
    let finalSql = query;
    if (clauses.length > 0) {
      finalSql = injectScope(finalSql, clauses.join(' AND '));
    }
    finalSql = enforceLimit(finalSql, env.AI_SQL_MAX_ROWS);

    const params = ctx.role === 'Admin' ? [] : [ctx.userId, ctx.teacherId ?? 0];

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${env.AI_SQL_TIMEOUT_MS}`);
      await client.query('SET TRANSACTION READ ONLY');
      const res = await client.query({
        text: finalSql,
        values: params,
        rowMode: 'array',
      });
      await client.query('ROLLBACK');

      const columns: string[] = [];
      for (const f of res.fields) columns.push(f.name);
      const rows = res.rows.slice(0, env.AI_SQL_MAX_ROWS);

      return JSON.stringify({
        columns,
        rows,
        rowCount: rows.length,
        limited: env.AI_SQL_MAX_ROWS,
        sql: finalSql,
      });
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      return JSON.stringify({
        error: `Lỗi SQL: ${e?.message ?? e}. Hãy sửa lại truy vấn theo gợi ý của hệ thống và thử lại.`,
      });
    } finally {
      client.release();
    }
  },
};

export { validateSelect, extractTables, scopePredicate, injectScope, enforceLimit };