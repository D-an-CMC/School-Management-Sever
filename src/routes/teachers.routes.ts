import { Router } from 'express';
import { z } from 'zod';
import { teacherService } from '../services/teacher.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

const querySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(10),
});

router.get('/', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const q = querySchema.parse(req.query);
    const result = await teacherService.findMany(q);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

router.get('/:id', async (req: any, res) => {
  try {
    const result = await teacherService.findById(Number(req.params.id));
    if (!result.success) return res.status(404).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/stats/summary', roleMiddleware(['Admin']), async (_req, res) => {
  const result = await teacherService.getStats();
  return res.json(result);
});

export default router;
