import { Router } from 'express';
import { z } from 'zod';
import { classService } from '../services/class.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

const querySchema = z.object({
  teacherId: z.coerce.number().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(20),
});

router.get('/', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const q = querySchema.parse(req.query);
    const result = await classService.findMany(q);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

router.get('/:id', async (req: any, res) => {
  try {
    const result = await classService.findById(Number(req.params.id));
    if (!result.success) return res.status(404).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/:id/students', async (req: any, res) => {
  try {
    const result = await classService.getStudents(Number(req.params.id));
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/stats/by-grade', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const result = await classService.getGradeStats();
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/:id', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const result = await classService.update(Number(req.params.id), req.body);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/:id/students', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const result = await classService.addStudent(Number(req.params.id), req.body);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id/students/:studentId', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const result = await classService.removeStudent(Number(req.params.id), Number(req.params.studentId));
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;

