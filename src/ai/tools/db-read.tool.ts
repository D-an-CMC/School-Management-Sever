import { queryPool } from '../../config/pg';
import { Tool, ToolContext } from '../types';
import { ALL_TABLES } from './schema.tool';
import { injectScope, scopePredicate, enforceLimit } from './sql.tool';

// Bộ tool đọc CSDL kiểu glob / grep / read — thiết kế riêng cho agent
// truy vấn dữ liệu: tìm bảng (glob), tìm cột (grep), đọc chi tiết bảng (read).

function toLike(pattern: string): string {
  const p = pattern.replace(/\*/g, '%').replace(/\?/g, '_').trim();
  return p ? `%${p.toLowerCase()}%` : '%';
}

// ── list_tables (glob): tìm bảng theo mẫu tên ──────────────────
export const listTablesTool: Tool = {
  name: 'list_tables',
  description:
    `Tìm bảng theo mẫu tên (giống glob): liệt kê các bảng trong CSDL trường học khớp mẫu, kèm số cột của mỗi bảng. ` +
    `VD: pattern="*student*" tìm mọi bảng có chứa "student" (students, student_class_enrollments, student_year_results...). ` +
    `Dùng "*" cho ký tự bất kỳ. Nhanh hơn get_db_schema khi chỉ cần biết bảng nào tồn tại.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Mẫu tên bảng, dùng * làm wildcard. VD: *student*, *grade*' },
    },
    required: [],
  },
  async execute(_ctx: ToolContext, args: Record<string, any>): Promise<string> {
    const like = toLike(String(args.pattern ?? '*'));
    const { rows } = await queryPool<{ table_name: string; col_count: number }>(
      `SELECT t.table_name,
              (SELECT count(*) FROM information_schema.columns c
               WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS col_count
       FROM information_schema.tables t
       WHERE t.table_schema = 'public'
         AND t.table_name LIKE $1
         AND t.table_name = ANY($2)
       ORDER BY t.table_name`,
      [like, ALL_TABLES]
    );
    return JSON.stringify({
      pattern: String(args.pattern ?? '*'),
      columns: ['table_name', 'col_count'],
      rows: rows.map((r) => [r.table_name, r.col_count]),
      rowCount: rows.length,
    });
  },
};

// ── search_columns (grep): tìm cột trên mọi bảng ────────────────
export const searchColumnsTool: Tool = {
  name: 'search_columns',
  description:
    `Tìm kiếm cột trên MỌI bảng theo mẫu tên cột (giống grep): trả về (bảng, cột, kiểu dữ liệu, bắt buộc không). ` +
    `VD: pattern="*class_id*" cho biết những bảng nào có cột class_id (FK lớp). ` +
    `Hữu ích khi muốn biết bảng nào liên kết với nhau qua cột nào trước khi viết JOIN.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Mẫu tên cột, dùng * làm wildcard. VD: *class*, *name*' },
    },
    required: [],
  },
  async execute(_ctx: ToolContext, args: Record<string, any>): Promise<string> {
    const like = toLike(String(args.pattern ?? '*'));
    const { rows } = await queryPool<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name LIKE $1
         AND table_name = ANY($2)
       ORDER BY table_name, ordinal_position`,
      [like, ALL_TABLES]
    );
    return JSON.stringify({
      pattern: String(args.pattern ?? '*'),
      columns: ['table_name', 'column_name', 'data_type', 'nullable'],
      rows: rows.map((r) => [r.table_name, r.column_name, r.data_type, r.is_nullable === 'YES']),
      rowCount: rows.length,
    });
  },
};

// ── read_table (read): đọc chi tiết một bảng ────────────────────
export const readTableTool: Tool = {
  name: 'read_table',
  description:
    `Đọc chi tiết một bảng (giống read file): cột (tên, kiểu, bắt buộc, tự sinh, giá trị mặc định), ` +
    `các ràng buộc (PRIMARY KEY / FOREIGN KEY / UNIQUE — FK chỉ rõ bảng tham chiếu), ` +
    `và 3 dòng dữ liệu mẫu (đã giới hạn theo đúng quyền truy cập của bạn). ` +
    `Gọi tool này TRƯỚC khi execute_write để biết cột nào bắt buộc, cột nào tự sinh, và ghi đúng giá trị hợp lệ.`,
  parameters: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Tên bảng chính xác (vd: students, classes, users)' },
    },
    required: ['table'],
  },
  async execute(ctx: ToolContext, args: Record<string, any>): Promise<string> {
    const table = String(args.table ?? '').trim().toLowerCase();
    if (!ALL_TABLES.includes(table)) {
      return JSON.stringify({
        error: `Bảng "${table}" không tồn tại hoặc không được phép. Bảng hợp lệ: ${ALL_TABLES.join(', ')}`,
      });
    }

    const cols = await queryPool<{ column_name: string; data_type: string; is_nullable: string; is_identity: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, is_identity, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );

    const cons = await queryPool<{ constraint_type: string; column_name: string; ref_table: string | null; ref_column: string | null }>(
      `SELECT tc.constraint_type,
              kcu.column_name,
              ccu.table_name AS ref_table,
              ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name
       LEFT JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema = 'public' AND tc.table_name = $1
       ORDER BY tc.constraint_type, kcu.column_name`,
      [table]
    );

    // Mẫu dữ liệu — ép đúng phạm vi quyền (giống execute_sql)
    let sample: { columns: string[]; rows: unknown[][]; sql?: string } | { error: string } = { columns: [], rows: [] };
    try {
      const pred = scopePredicate(table, ctx.role);
      let sql = `SELECT * FROM ${table}`;
      if (pred) sql = injectScope(sql, pred);
      sql = enforceLimit(sql, 3);
      const res = await queryPool<Record<string, unknown>>(sql, ctx.role === 'Admin' ? [] : [ctx.userId, ctx.teacherId ?? 0]);
      const sampleCols = res.rows.length > 0 ? Object.keys(res.rows[0]) : [];
      sample = {
        columns: sampleCols,
        rows: res.rows.map((r) => sampleCols.map((c) => (r[c] == null ? null : r[c]))),
        sql,
      };
    } catch (e: any) {
      sample = { error: `Không đọc được dữ liệu mẫu: ${e?.message ?? e}` };
    }

    return JSON.stringify({
      table,
      columns: cols.rows.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        auto: c.is_identity === 'YES',
        default: c.column_default ?? null,
      })),
      constraints: cons.rows.map((c) => ({
        type: c.constraint_type,
        column: c.column_name,
        refTable: c.ref_table ?? null,
        refColumn: c.ref_column ?? null,
      })),
      sample,
    });
  },
};