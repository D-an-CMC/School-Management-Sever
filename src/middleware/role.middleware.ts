import { AuthRequest } from './auth.middleware';

export function roleMiddleware(allowedRoles: string[]) {
  const lower = allowedRoles.map((r) => r.toLowerCase());
  return (req: AuthRequest, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    const userRole = String((req.user as any).role ?? '').toLowerCase();
    // L6: so sánh không phân biệt hoa thường (JWT: 'Admin'... DB: 'admin'...)
    if (!lower.includes(userRole)) {
      return res.status(403).json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
  };
}
