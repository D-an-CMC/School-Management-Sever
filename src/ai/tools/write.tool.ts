import { getPool } from '../../config/pg';
import { env } from '../../config/env';
import { Tool, ToolContext } from '../types';

// ── Bảng được phép GHI (chỉ Admin) ─────────────────────────────
// Chỉ các bảng nghiệp vụ; loại bỏ bảng hệ thống/bảo mật (users, roles,
// security_logs, ai_*) để tránh AI tự sửa tài khoản hay dữ liệu AI.
const WRITE_TABLES = new Set([
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
  /\b(drop|alter|truncate|create|grant|revoke|copy|execute|call|do|vacuum|analyze|refresh|merge|replace|load|explain|return|select|union)\b/i;
const HAS_SEMICOLON = /;/;
const HAS_COMMENT = /(--|\/\*|\*\/)/;
const HAS_PG_INTERNAL = /\b(pg_|information_schema|citus_|timescaledb_)/i;
const HAS_WHERE = /\bwhere\b/i;

const INSERT_RE = /^\s*insert\s+into\s+([a-z_][a-z0-9_]*)\b/i;
const UPDATE_RE = /^\s*update\s+([a-z_][a-z0-9_]*)\b/i;
const DELETE_RE = /^\s*delete\s+from\s+([a-z_][a-z0-9_]*)\b/i;

export const writeSqlTool: Tool = {
  name: 'execute_write',
  description:
    `Ghi dữ liệu vào cơ sở dữ liệu — CHỈ dành cho vai trò QUẢN TRỊ VIÊN, CHỈ khi người dùng yêu cầu rõ ràng ` +
    `(thêm mới / sửa / xóa một học sinh, giáo viên, lớp, điểm, điểm danh...). ` +
    `Chấp nhận 1 câu INSERT, UPDATE hoặc DELETE duy nhất trên bảng nghiệp vụ của nhà trường. ` +
    `Quy tắc: (1) INSERT: nêu rõ cột và giá trị; (2) UPDATE/DELETE BẮT BUỘC có điều kiện WHERE cụ thể ` +
    `(không WHERE sẽ bị từ chối) và chỉ ảnh hưởng tối đa ${env.AI_WRITE_MAX_ROWS} dòng (quá mức sẽ bị hủy); ` +
    `(3) không dùng dấu ";" giữa câu, không comment, không SELECT lồng; ` +
    `(4) trước khi ghi nên execute_sql để kiểm tra dữ liệu hiện có; (5) sau khi ghi, báo lại số dòng đã thay đổi.`,
  parameters: {
    type: 'object',
    properties: {
      statement: {
        type: 'string',
        description: 'Câu INSERT/UPDATE/DELETE hợp lệ (không có dấu ; cuối, không comment)',
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

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${env.AI_SQL_TIMEOUT_MS}`);
      const res = await client.query({ text: stmt });

      if ((res.rowCount ?? 0) > env.AI_WRITE_MAX_ROWS) {
        await client.query('ROLLBACK');
        return JSON.stringify({
          error: `Lệnh ${action} ảnh hưởng ${res.rowCount} dòng — vượt giới hạn ${env.AI_WRITE_MAX_ROWS} dòng/lần, đã HỦY. Hãy thu hẹp điều kiện và thử lại.`,
        });
      }
      if ((res.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return JSON.stringify({
          error: `Lệnh ${action} không ảnh hưởng dòng nào (0 dòng) — kiểm tra lại dữ liệu hiện có và điều kiện.`,
        });
      }

      await client.query('COMMIT');
      return JSON.stringify({
        action,
        table,
        rowCount: res.rowCount,
        sql: stmt,
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