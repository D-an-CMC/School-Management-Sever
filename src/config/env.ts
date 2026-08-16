import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  // CORS: danh sách origin cách nhau bởi dấu phẩy. Nếu trống → cho phép tất cả
  // origin (server chỉ xác thực qua Authorization Bearer token, không dùng cookie).
  CORS_ORIGIN: z.string().default(''),

  // ── AI Assistant ─────────────────────────────────────────────
  DATABASE_URL: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_BASE_URL: z.string().url().default('https://integrate.api.nvidia.com/v1'),
  AI_MODEL: z.string().default('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'),
  AI_EMBED_MODEL: z.string().default('nvidia/nemotron-3-embed-1b'),
  AI_EMBED_DIM: z.coerce.number().default(2048),
  AI_TEMPERATURE: z.coerce.number().default(0.2),
  AI_MAX_TOKENS: z.coerce.number().default(8192),
  AI_MAX_TOKENS_CAP: z.coerce.number().default(32768),
  AI_MAX_TURNS: z.coerce.number().default(6),
  AI_MAX_HISTORY: z.coerce.number().default(30),
  AI_SQL_MAX_ROWS: z.coerce.number().default(200),
  AI_SQL_TIMEOUT_MS: z.coerce.number().default(8000),
  AI_RATE_LIMIT_PER_MIN: z.coerce.number().default(15),
  AI_HTTP_TIMEOUT_MS: z.coerce.number().default(300000),
});

export const env = envSchema.parse(process.env);