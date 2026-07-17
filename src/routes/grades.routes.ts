import { Router } from 'express';
import { z } from 'zod';
import { gradeService } from '../services/grade.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/class/:classId', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const classId = Number(req.params.classId);
    const result = await gradeService.findByClass(classId);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/types', async (_req, res) => {
  const result = await gradeService.gradeTypes();
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

router.put('/items/:gradeItemId', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const { score } = z.object({ score: z.coerce.number() }).parse(req.body);
    const result = await gradeService.updateGrade(Number(req.params.gradeItemId), score);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

const batchSchema = z.object({
  updates: z.array(
    z.object({
      gradeItemId: z.number(),
      score: z.coerce.number(),
    })
  ),
});

router.put('/batch', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const { updates } = batchSchema.parse(req.body) as any;
    const result = await gradeService.batchUpdate(updates as any);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

export default router;
