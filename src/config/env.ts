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

  // ── ML dự đoán điểm (modsves-ml-api / FastAPI) ───────────────────
  // Base URL của ML API, ví dụ: http://127.0.0.1:8000 hoặc https://modsves-ml-api.onrender.com
  // Nếu để trống → API /api/ml/* trả lỗi ML_NOT_CONFIGURED thay vì crash.
  ML_API_URL: z.string().default('http://127.0.0.1:8000'),
  ML_API_TIMEOUT_MS: z.coerce.number().default(15000),
});

export const env = envSchema.parse(process.env);