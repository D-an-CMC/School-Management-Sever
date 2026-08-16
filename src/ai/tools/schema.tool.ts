import { queryPool } from '../../config/pg';
import { Tool, ToolContext } from '../types';

interface ColumnInfo {
  name: string;
  type: string;
  /** true = cột tự sinh (identity) — KHÔNG được ghi trong INSERT */
  auto?: boolean;
  /** false = NOT NULL (bắt buộc khi INSERT) */
  nullable: boolean;
  /** mô tả ngắn gọn để agent hiểu dữ liệu? không có — chỉ flag */
}

const ALL_TABLES = [
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
];

let cache: { data: Record<string, ColumnInfo[]>; at: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // M1: 1h quá lâu — sau migration agent phục vụ schema cũ 60 phút

async function fetchSchema(): Promise<Record<string, ColumnInfo[]>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  const { rows } = await queryPool<
    { table_name: string; column_name: string; data_type: string; is_identity: string; is_nullable: string }
  >(
    `SELECT table_name, column_name, data_type, is_identity, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );
  const map: Record<string, ColumnInfo[]> = {};
  for (const r of rows) {
    if (!ALL_TABLES.includes(r.table_name)) continue;
    (map[r.table_name] ??= []).push({
      name: r.column_name,
      type: r.data_type,
      auto: r.is_identity === 'YES',
      nullable: r.is_nullable === 'YES',
    });
  }
  cache = { data: map, at: Date.now() };
  return map;
}

export interface DbSchemaTool extends Tool {}

export const dbSchemaTool: DbSchemaTool = {
  name: 'get_db_schema',
  description:
    `Trả về cấu trúc (bảng + cột) của cơ sở dữ liệu trường học dạng JSON. Mỗi cột có: name, type, nullable (false = bắt buộc), auto (true = cột tự sinh như *_id — KHÔNG ghi vào INSERT, hệ thống tự tạo). ` +
    `Gọi tool này TRƯỚC khi viết SQL để biết chính xác tên bảng, tên cột.`,
  parameters: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Tên bảng cần xem (tùy chọn). Nếu bỏ trống, trả về toàn bộ.' },
    },
  },
  async execute(_ctx: ToolContext, args: Record<string, any>): Promise<string> {
    const map = await fetchSchema();
    const wanted = args.table ? String(args.table) : '';
    if (wanted) {
      const cols = map[wanted];
      if (!cols) return JSON.stringify({ error: `Không tìm thấy bảng "${wanted}"` });
      return JSON.stringify({ table: wanted, columns: cols });
    }
    return JSON.stringify(map);
  },
};