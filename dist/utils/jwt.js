import jwt from 'jsonwebtoken';
import { env } from '../config/env';
export function signToken(payload) {
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}
export function verifyToken(token) {
    return jwt.verify(token, env.JWT_SECRET);
}
//# sourceMappingURL=jwt.js.map