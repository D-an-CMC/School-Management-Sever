import { Router } from 'express';
import { z } from 'zod';
import { activityService } from '../services/activity.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

const querySchema = z.object({
  classId: z.coerce.number().optional(),
  semesterId: z.coerce.number().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(20),
});

router.get('/', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const q = querySchema.parse(req.query);
    const result = await activityService.findMany(q);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

export default router;
