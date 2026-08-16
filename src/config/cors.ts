import cors from 'cors';
import { env } from './env';

const allowedOrigins = env.CORS_ORIGIN
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const corsOptions: cors.CorsOptions = {
  // Nếu không cấu hình CORS_ORIGIN → cho phép mọi origin (server dùng Bearer token,
  // không có cookie nên không mở rộng bề mặt CSRF). Nếu có cấu hình → chỉ cho phép
  // đúng các origin trong danh sách.
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
};