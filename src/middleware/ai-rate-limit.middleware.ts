import { AuthRequest } from './auth.middleware';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<number, Bucket>();

/**
 * Rate limit theo user_id (in-memory): tối đa N request / phút.
 * Cấu hình qua env AI_RATE_LIMIT_PER_MIN.
 */
export function aiRateLimitMiddleware(
  req: AuthRequest,
  res: any,
  next: any
) {
  // Nếu chưa config AI thì không chặn (để route trả lỗi cấu hình rõ ràng hơn)
  const limit = Number(process.env.AI_RATE_LIMIT_PER_MIN || 0);
  if (limit <= 0 || !req.user?.userId) {
    return next();
  }
  const key = req.user.userId;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + 60_000 };
    buckets.set(key, bucket);
  }
  if (bucket.count >= limit) {
    return res.status(429).json({
      success: false,
      error: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng chờ 1 phút rồi thử lại.',
      code: 'AI_RATE_LIMITED',
    });
  }
  bucket.count += 1;
  next();
}

export function cleanupRateLimitBuckets() {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k);
  }
}

// L3: dọn bucket hết hạn mỗi 5 phút để tránh rò rỉ bộ nhớ trên server chạy lâu.
setInterval(cleanupRateLimitBuckets, 5 * 60 * 1000).unref();