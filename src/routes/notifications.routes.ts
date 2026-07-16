import { Router } from 'express';
import { z } from 'zod';
import { notificationService } from '../services/notification.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

const querySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(10),
});

router.get('/my', async (req: any, res) => {
  try {
    const q = querySchema.parse(req.query);
    const result = await notificationService.findByUser(req.user!.userId, q);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

router.put('/:id/read', async (req: any, res) => {
  try {
    const result = await notificationService.markAsRead(Number(req.params.id), req.user!.userId);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const input = z
      .object({ title: z.string(), content: z.string().optional(), targetType: z.string().optional() })
      .parse(req.body);
    const result = await notificationService.create({ ...input, senderId: req.user!.userId });
    if (!result.success) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

export default router;
