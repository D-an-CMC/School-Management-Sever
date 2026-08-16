import { getPool } from '../../config/pg';
import { env } from '../../config/env';
import { Tool, ToolContext } from '../types';

// ── Bảng được phép GHI (chỉ Admin) ─────────────────────────────
// Chỉ các bảng nghiệp vụ; users được phép vì học sinh/gv phải có user (FK),
// nhưng KHÔNG cho phép ghi roles/security_logs/ai_* (hệ thống + bảo mật).
const WRITE_TABLES = new Set([
  'users',
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
  'departments',
]);

const DANGEROUS_KEYWORDS =
  /\b(drop|alter|truncate|create|grant|revoke|copy|execute|call|do|vacuum|analyze|refresh|merge|replace|load|explain|select|union)\b/i;
const HAS_SEMICOLON = /;/;
const HAS_COMMENT = /(--|\/\*|\*\/)/;
const HAS_PG_INTERNAL = /\b(pg_|information_schema|citus_|timescaledb_)/i;
const HAS_WHERE = /\bwhere\b/i;

const INSERT_RE = /^\s*insert\s+into\s+([a-z_][a-z0-9_]*)\b/i;
const UPDATE_RE = /^\s*update\s+([a-z_][a-z0-9_]*)\b/i;
const DELETE_RE = /^\s*delete\s+from\s+([a-z_][a-z0-9_]*)\b/i;

// ── Cột tự sinh (identity) — phải loại khỏi INSERT ─────────────
// Ai hay nhớ nhầm "cần insert student_id/user_id" gây lỗi
// "cannot insert a non-DEFAULT value into column". Tự truy vấn và loại bỏ.
const identityCache = new Map<string, string[]>();

async function identityColumns(table: string): Promise<string[]> {
  const cached = identityCache.get(table);
  if (cached) return cached;
  const { queryPool } = await import('../../config/pg');
  const { rows } = await queryPool<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND is_identity = 'YES'`,
    [table]
  );
  const cols = rows.map((r) => r.column_name);
  identityCache.set(table, cols);
  return cols;
}

/** Tách cột tự sinh ra khỏi câu INSERT (cột + giá trị tương ứng). */
async function stripIdentityFromInsert(stmt: string, table: string): Promise<{ sql: string; removed: string[] }> {
  const colsRe = /^\s*insert\s+into\s+[a-z_][a-z0-9_]*\s*\(([a-z_][a-z0-9_]*\s*(?:,\s*[a-z_][a-z0-9_]*\s*)*)\)/i;
  const m = colsRe.exec(stmt);
  if (!m) return { sql: stmt, removed: [] };
  const identities = await identityColumns(table);
  if (identities.length === 0) return { sql: stmt, removed: [] };

  const header = m[0];
  const rest = stmt.slice(header.length);
  // Phần VALUES(...): tìm cặp ngoặc đơn đầu tiên sau "VALUES" (bỏ qua chuỗi/quote)
  const vRe = /^\s*values\s*\(/i;
  const vm = vRe.exec(rest);
  if (!vm) return { sql: stmt, removed: [] };
  let i = vm.index + vm[0].length;
  let depth = 1;
  let inStr: string | null = null;
  const bodyStart = i;
  while (i < rest.length && depth > 0) {
    const ch = rest[i];
    if (inStr) {
      if (ch === inStr && rest[i - 1] !== '\\') inStr = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  if (depth !== 0) return { sql: stmt, removed: [] };
  const inside = rest.slice(bodyStart, i);
  const after = rest.slice(i + 1);

  // Tách các giá trị cấp cao nhất theo dấu phẩy (bỏ qua phẩy trong chuỗi)
  const values: string[] = [];
  let cur = '';
  inStr = null;
  let paren = 0;
  for (const ch of inside) {
    if (inStr) {
      cur += ch;
      if (ch === inStr && cur[cur.length - 2] !== '\\') inStr = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
      cur += ch;
    } else if (ch === '(') {
      paren++;
      cur += ch;
    } else if (ch === ')') {
      paren--;
      cur += ch;
    } else if (ch === ',' && paren === 0) {
      values.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  values.push(cur);

  const cols = header
    .replace(/^\s*insert\s+into\s+[a-z_][a-z0-9_]*\s*\(/i, '')
    .replace(/\)\s*$/i, '')
    .split(',')
    .map((c) => c.trim());

  if (cols.length !== values.length) return { sql: stmt, removed: [] };

  const removed: string[] = [];
  const keptCols: string[] = [];
  const keptVals: string[] = [];
  cols.forEach((c, idx) => {
    if (identities.includes(c.toLowerCase())) {
      removed.push(c);
    } else {
      keptCols.push(c);
      keptVals.push(values[idx]);
    }
  });
  if (removed.length === 0) return { sql: stmt, removed: [] };

  const newHeader = `INSERT INTO ${table} (${keptCols.join(', ')})`;
  // giữ nguyên phần sau `)` (bảo toàn RETURNING ...)
  const newStmt = `${newHeader} VALUES (${keptVals.join(', ')})${after}`;
  return { sql: newStmt, removed };
}

export const writeSqlTool: Tool = {
  name: 'execute_write',
  description:
    `Ghi dữ liệu vào cơ sở dữ liệu — CHỈ dành cho vai trò QUẢN TRỊ VIÊN, CHỈ khi người dùng yêu cầu rõ ràng ` +
    `(thêm mới / sửa / xóa một học sinh, giáo viên, lớp, điểm, điểm danh...). ` +
    `Chấp nhận 1 câu INSERT (có thể kèm RETURNING để lấy id vừa tạo), UPDATE hoặc DELETE duy nhất trên bảng nghiệp vụ ` +
    `(gồm cả users — vì học sinh/giáo viên phải có user: tạo user trước với role_id 3 = HocSinh-PhuHuynh hoặc 2 = GiaoVien, ` +
    `dùng 'INSERT INTO users (...) VALUES (...) RETURNING user_id' để lấy user_id, rồi ghi students/teachers tham chiếu user_id đó). ` +
    `Quy tắc: (1) INSERT: nêu rõ cột và giá trị, CỘT TỰ SINH (student_id, user_id, class_id...) do hệ thống tự tạo — không cần ghi, ` +
    `nếu ghi hệ thống sẽ tự loại bỏ; (2) UPDATE/DELETE BẮT BUỘC có điều kiện WHERE cụ thể (không WHERE sẽ bị từ chối) ` +
    `và chỉ ảnh hưởng tối đa ${env.AI_WRITE_MAX_ROWS} dòng (quá mức sẽ bị hủy); ` +
    `(3) không dùng dấu ";" giữa câu, không comment, không SELECT lồng; ` +
    `(4) trước khi ghi nên execute_sql để kiểm tra dữ liệu hiện có; (5) sau khi ghi, báo lại số dòng đã thay đổi.`,
  parameters: {
    type: 'object',
    properties: {
      statement: {
        type: 'string',
        description: 'Câu INSERT (có thể có RETURNING)/UPDATE/DELETE hợp lệ (không dấu ; giữa câu, không comment)',
      },
    },
    required: ['statement'],
  },
  async execute(ctx: ToolContext, args: Record<string, any>): Promise<string> {
    if (ctx.role !== 'Admin') {
      return JSON.stringify({
        error: 'Chỉ QUẢN TRỊ VIÊN mới được ghi dữ liệu. Vui lòng báo lập trình viên hoặc admin hệ thống.',
      });
    }

    const stmt = String(args.statement ?? '').trim().replace(/;\s*$/, '');
    if (!stmt) return JSON.stringify({ error: 'Thiếu tham số statement' });

    if (HAS_SEMICOLON.test(stmt)) {
      return JSON.stringify({ error: 'Không được dùng dấu ";" giữa câu — chỉ 1 lệnh ghi duy nhất.' });
    }
    if (HAS_COMMENT.test(stmt)) {
      return JSON.stringify({ error: 'Không được dùng comment SQL (-- hoặc /* */).' });
    }
    if (HAS_PG_INTERNAL.test(stmt)) {
      return JSON.stringify({ error: 'Không được truy cập hệ thống nội bộ Postgres (pg_*, information_schema).' });
    }
    if (!/^\s*(insert|update|delete)\b/i.test(stmt)) {
      return JSON.stringify({ error: 'Chỉ chấp nhận 1 câu INSERT, UPDATE hoặc DELETE.' });
    }
    if (DANGEROUS_KEYWORDS.test(stmt)) {
      return JSON.stringify({
        error: 'Câu lệnh chứa từ khóa bị cấm (drop/alter/truncate/select/union...) — chỉ viết INSERT/UPDATE/DELETE thuần túy.',
      });
    }

    let table: string | null = null;
    let action: string | null = null;
    let m = INSERT_RE.exec(stmt);
    if (m) {
      table = m[1].toLowerCase();
      action = 'INSERT';
    } else {
      m = UPDATE_RE.exec(stmt);
      if (m) {
        table = m[1].toLowerCase();
        action = 'UPDATE';
      } else {
        m = DELETE_RE.exec(stmt);
        if (m) {
          table = m[1].toLowerCase();
          action = 'DELETE';
        }
      }
    }
    if (!table || !action) {
      return JSON.stringify({ error: 'Không xác định được bảng cần ghi — hãy viết câu lệnh rõ ràng.' });
    }
    if (!WRITE_TABLES.has(table)) {
      return JSON.stringify({
        error: `Bảng "${table}" không nằm trong danh sách được phép GHI. Các bảng cho phép: ${[...WRITE_TABLES].sort().join(', ')}`,
      });
    }
    if ((action === 'UPDATE' || action === 'DELETE') && !HAS_WHERE.test(stmt)) {
      return JSON.stringify({ error: `Câu ${action} BẮT BUỘC có điều kiện WHERE để tránh thay đổi toàn bộ bảng.` });
    }

    // Tự loại cột tự sinh (identity) khỏi INSERT — AI hay viết nhầm student_id/user_id.
    let finalStmt = stmt;
    let removedAutoCols: string[] = [];
    if (action === 'INSERT') {
      const stripped = await stripIdentityFromInsert(stmt, table);
      finalStmt = stripped.sql || stmt;
      removedAutoCols = stripped.removed;
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${env.AI_SQL_TIMEOUT_MS}`);
      const res = await client.query({ text: finalStmt });

      if ((res.rowCount ?? 0) > env.AI_WRITE_MAX_ROWS) {
        await client.query('ROLLBACK');
        return JSON.stringify({
          error: `Lệnh ${action} ảnh hưởng ${res.rowCount} dòng — vượt giới hạn ${env.AI_WRITE_MAX_ROWS} dòng/lần, đã HỦY. Hãy thu hẹp điều kiện và thử lại.`,
        });
      }
      if ((res.rowCount ?? 0) === 0 && !res.rows?.length) {
        await client.query('ROLLBACK');
        return JSON.stringify({
          error: `Lệnh ${action} không ảnh hưởng dòng nào (0 dòng) — kiểm tra lại dữ liệu hiện có và điều kiện.`,
        });
      }

      await client.query('COMMIT');
      const returned = res.rows && res.rows.length > 0 ? res.rows : undefined;
      return JSON.stringify({
        action,
        table,
        rowCount: res.rowCount ?? 0,
        ...(removedAutoCols.length > 0 ? { autoRemoved: removedAutoCols } : {}),
        ...(returned ? { returned } : {}),
        sql: finalStmt,
        ok: true,
      });
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      return JSON.stringify({
        error: `Lỗi SQL: ${e?.message ?? e}. Hãy sửa lại câu lệnh và thử lại.`,
      });
    } finally {
      client.release();
    }
  },
};