import { Router } from 'express';
import { z } from 'zod';
import { timetableService } from '../services/timetable.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { supabase } from '../config/supabase';

const router = Router();
router.use(authMiddleware);

const timetableQuery = z.object({
  teacherId: z.coerce.number().optional(),
  classId: z.coerce.number().optional(),
  semesterId: z.coerce.number().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(50),
});

const createBody = z.object({
  classId: z.coerce.number().default(0),
  subjectId: z.coerce.number(),
  teacherId: z.coerce.number().optional(),
  semesterId: z.coerce.number(),
  dayOfWeek: z.string().default(''),
  periodNo: z.coerce.number().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  room: z.string().optional(),
});

// GET /timetables — list (filtered by role)
router.get('/', roleMiddleware(['Admin', 'GiaoVien', 'HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    let q = timetableQuery.parse(req.query);
    if ((req.user as any).role === 'HocSinh-PhuHuynh') {
      const { data: student } = await supabase
        .from('students')
        .select('class_id')
        .eq('user_id', (req.user as any).userId)
        .maybeSingle();
      if (!student?.class_id) {
        return res.json({ success: true, data: [], pagination: { total: 0, page: 1, limit: q.limit } });
      }
      q = { ...q, classId: student.class_id };
    }
    const result = await timetableService.findMany(q);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// POST /timetables — create a timetable entry
router.post('/', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = createBody.parse(req.body);
    const result = await timetableService.create(body as { classId: number; subjectId: number; teacherId?: number; semesterId: number; dayOfWeek: string; periodNo?: number; startTime?: string; endTime?: string; room?: string });
    if (!result.success) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// DELETE /timetables/:id — delete a timetable entry
router.delete('/:id', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    const result = await timetableService.remove(id);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

router.get('/exam-schedules', async (req: any, res) => {
  try {
    const classId = req.query.classId ? Number(req.query.classId) : undefined;
    const semesterId = req.query.semesterId ? Number(req.query.semesterId) : undefined;
    const result = await timetableService.examSchedules({ classId, semesterId });
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/subjects', async (_req, res) => {
  const result = await timetableService.subjects();
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

router.get('/semesters', async (_req, res) => {
  const result = await timetableService.semesters();
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

export default router;
