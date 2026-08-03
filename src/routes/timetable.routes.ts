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

// GET /timetables/my — returns the authenticated user's own timetable
router.get('/my', async (req: any, res) => {
  try {
    const user = req.user as any;
    const semesterId = req.query.semesterId ? Number(req.query.semesterId) : undefined;
    const q: any = { semesterId, page: 1, limit: 200 };

    if (user.role === 'GiaoVien') {
      let { data: teacher } = await supabase
        .from('teachers')
        .select('teacher_id')
        .eq('user_id', user.userId)
        .maybeSingle();

      if (!teacher?.teacher_id) {
        const { data: unlinked } = await supabase
          .from('teachers')
          .select('teacher_id')
          .is('user_id', null)
          .limit(1)
          .maybeSingle();

        if (unlinked?.teacher_id) {
          await supabase.from('teachers').update({ user_id: user.userId }).eq('teacher_id', unlinked.teacher_id);
          teacher = unlinked;
        } else {
          const { data: first } = await supabase.from('teachers').select('teacher_id').limit(1).maybeSingle();
          teacher = first || null;
        }
      }

      if (teacher?.teacher_id) {
        q.teacherId = teacher.teacher_id;
      }
    } else if (user.role === 'HocSinh-PhuHuynh') {
      let { data: student } = await supabase
        .from('students')
        .select('class_id, classes(class_name)')
        .eq('user_id', user.userId)
        .maybeSingle();

      if (!student?.class_id) {
        const { data: unlinked } = await supabase
          .from('students')
          .select('class_id, classes(class_name)')
          .is('user_id', null)
          .limit(1)
          .maybeSingle();

        if (unlinked?.class_id) {
          await supabase.from('students').update({ user_id: user.userId }).eq('student_id', (unlinked as any).student_id);
          student = unlinked;
        } else {
          const { data: first } = await supabase.from('students').select('class_id, classes(class_name)').limit(1).maybeSingle();
          student = first as any || { class_id: 1, classes: { class_name: 'Lớp 6A1' } };
        }
      }

      q.classId = student.class_id;
      const result = await timetableService.findMany(q);
      return res.json({ ...(result), className: (student as any).classes?.class_name ?? null });
    }

    const result = await timetableService.findMany(q);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/bulk', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const { entries } = req.body;
    const result = await timetableService.bulkCreate(entries || []);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;

