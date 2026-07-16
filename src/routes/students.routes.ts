import { Router } from 'express';
import { z } from 'zod';
import { studentService } from '../services/student.service';
import { generateStudentCode } from '../services/user.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { supabase } from '../config/supabase';

const router = Router();
router.use(authMiddleware);

const querySchema = z.object({
  search: z.string().optional(),
  classId: z.coerce.number().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(10),
});

router.get('/', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const q = querySchema.parse(req.query);
    const result = await studentService.findMany(q);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

router.get('/:id', async (req: any, res) => {
  try {
    const result = await studentService.findById(Number(req.params.id));
    if (!result.success) return res.status(404).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/stats/count', roleMiddleware(['Admin']), async (_req, res) => {
  const result = await studentService.getStats();
  return res.json(result);
});

const previewSchema = z.object({ classId: z.coerce.number().optional(), schoolYearId: z.coerce.number().optional() });

router.get('/preview/code', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const { classId, schoolYearId } = previewSchema.parse(req.query);
    let yearId = schoolYearId
    if (!yearId && classId) {
      const c = await supabase.from('classes').select('school_year_id').eq('class_id', classId).single()
      yearId = c.data?.school_year_id
    }
    const code = await generateStudentCode(yearId || 1);
    return res.json({ success: true, data: { student_code: code, email: `${code}@cmc.edu.vn` } });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

export default router;
