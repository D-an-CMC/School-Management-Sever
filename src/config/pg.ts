import { Pool } from 'pg';
import { env } from './env';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  if (!env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL chưa được cấu hình — AI SQL/RAG cần kết nối Postgres trực tiếp (lấy từ Supabase Dashboard → Project Settings → Database → Connection string)'
    );
  }
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  return pool;
}

export async function queryPool<T = any>(
  text: string,
  params?: any[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  return getPool().query(text, params);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}