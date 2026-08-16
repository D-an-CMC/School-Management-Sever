import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';
import { supabase } from '../config/supabase';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

// C4: token còn hạn 7 ngày — nhưng tài khoản bị khoá/hạ quyền phải bị chặn NGAY,
// không đợi token hết hạn. Mỗi request re-check is_active + role từ DB.
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = verifyToken(token);
    const { data } = await supabase
      .from('users')
      .select('user_id, is_active, role_id, user_roles:roles(role_name)')
      .eq('user_id', decoded.userId)
      .maybeSingle();
    if (!data || data.is_active !== true) {
      return res.status(401).json({ success: false, error: 'Tài khoản đã bị vô hiệu hóa', code: 'ACCOUNT_DISABLED' });
    }
    const dbRole = Array.isArray(data.user_roles)
      ? data.user_roles[0]?.role_name
      : (data as any).user_roles?.role_name;
    if (dbRole !== decoded.role) {
      return res.status(403).json({ success: false, error: 'Quyền đã thay đổi, vui lòng đăng nhập lại', code: 'ROLE_CHANGED' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid token', code: 'INVALID_TOKEN' });
  }
}
