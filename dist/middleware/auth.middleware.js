import { verifyToken } from '../utils/jwt';
export function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    const token = header.split(' ')[1];
    try {
        const decoded = verifyToken(token);
        req.user = decoded;
        next();
    }
    catch {
        return res.status(401).json({ success: false, error: 'Invalid token', code: 'INVALID_TOKEN' });
    }
}
//# sourceMappingURL=auth.middleware.js.map