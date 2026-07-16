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
    const parsed = loginSchema.parse(req.body);
    const result = await authService.login(parsed);
    return res.json(success(result));
  } catch (err: any) {
    return res.status(400).json(error(err.message || 'Login failed', 'LOGIN_FAILED'));
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
