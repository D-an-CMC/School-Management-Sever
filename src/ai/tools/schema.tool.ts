import { queryPool } from '../../config/pg';
import { Tool, ToolContext } from '../types';

interface ColumnInfo {
  name: string;
  type: string;
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
const CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchSchema(): Promise<Record<string, ColumnInfo[]>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  const { rows } = await queryPool<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );
  const map: Record<string, ColumnInfo[]> = {};
  for (const r of rows) {
    if (!ALL_TABLES.includes(r.table_name)) continue;
    (map[r.table_name] ??= []).push({ name: r.column_name, type: r.data_type });
  }
  cache = { data: map, at: Date.now() };
  return map;
}

export interface DbSchemaTool extends Tool {}

export const dbSchemaTool: DbSchemaTool = {
  name: 'get_db_schema',
  description:
    'Trả về cấu trúc (tên bảng + cột) của cơ sở dữ liệu trường học ở dạng JSON. Gọi tool này TRƯỚC khi viết SQL để biết chính xác tên bảng, tên cột.',
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