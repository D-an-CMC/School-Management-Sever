import { AuthRequest } from './auth.middleware';

export function roleMiddleware(allowedRoles: string[]) {
  return (req: AuthRequest, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    const userRole = (req.user as any).role as string;
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
  };
}
