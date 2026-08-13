import { Router } from 'express';
import { z } from 'zod';
import { ruleService } from '../services/rule.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

const ruleItem = z.object({
  subject_id: z.coerce.number(),
  periods_per_week: z.coerce.number().default(0),
  session: z.enum(['morning', 'afternoon', 'any']).default('any'),
  double_period: z.coerce.number().default(1),
  teacher_id: z.coerce.number().nullable().optional(),
});

const bulkBody = z.object({
  rules: z.array(ruleItem).default([]),
});

// GET /rules — list all schedule rules
router.get('/', roleMiddleware(['Admin', 'GiaoVien']), async (_req: any, res) => {
  try {
    const result = await ruleService.list();
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// PUT /rules/bulk — upsert many rules at once
router.put('/bulk', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = bulkBody.parse(req.body);
    const result = await ruleService.upsert(body.rules as any);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

export default router;
