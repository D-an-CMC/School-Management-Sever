import { AuthRequest } from './auth.middleware';

export type Role = 'Admin' | 'GiaoVien' | 'HocSinh-PhuHuynh';

export function roleMiddleware(allowedRoles: Role[]) {
  return (req: AuthRequest, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    const userRole = req.user.role as Role;
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
  };
}
