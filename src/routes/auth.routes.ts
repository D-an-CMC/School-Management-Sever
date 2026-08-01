import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { success, error } from '../utils/response';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
  try {
    const parsed = loginSchema.parse(req.body) as any;
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Browser';
    const result = await authService.login(parsed, { ip, userAgent });
    return res.json(success(result));
  } catch (err: any) {
    return res.status(400).json(error(err.message || 'Login failed', 'LOGIN_FAILED'));
  }
});

router.post('/logout', authMiddleware, async (req: any, res) => {
  try {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Browser';
    const result = await authService.logout(
      { id: req.user.userId, email: req.user.email, role: req.user.role },
      { ip, userAgent }
    );
    return res.json(success(result));
  } catch (err: any) {
    return res.status(400).json(error(err.message, 'LOGOUT_FAILED'));
  }
});

router.get('/me', authMiddleware, async (req: any, res) => {
  try {
    const user = await authService.me(req.user.userId);
    return res.json(success(user));
  } catch (err: any) {
    return res.status(404).json(error(err.message, 'NOT_FOUND'));
  }
});

export default router;
