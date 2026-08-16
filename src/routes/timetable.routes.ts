import { Router } from 'express';
import { z } from 'zod';
import { timetableService } from '../services/timetable.service';
import { autoScheduleService } from '../services/auto.schedule.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { supabase } from '../config/supabase';

const router = Router();
router.use(authMiddleware);

const timetableQuery = z.object({
  teacherId: z.coerce.number().optional(),
  classId: z.coerce.number().optional(),
  semesterId: z.coerce.number().optional(),
  weekStart: z.string().optional(),
  timetableTypeId: z.coerce.number().optional(),
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
  weekStart: z.string().optional(),
  custom_subject_name: z.string().optional(),
  custom_teacher_name: z.string().optional(),
  timetableTypeId: z.coerce.number().optional(),
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
    const result = await timetableService.create(body as { classId: number; subjectId: number; teacherId?: number; semesterId: number; dayOfWeek: string; periodNo?: number; startTime?: string; endTime?: string; room?: string; weekStart?: string; custom_subject_name?: string; custom_teacher_name?: string; timetableTypeId?: number });
    if (!result.success) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// DELETE /timetables/grade — wipe the regular timetable for a whole grade
router.delete('/grade', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const gradeLevel = Number(req.query.gradeLevel);
    const semesterId = req.query.semesterId ? Number(req.query.semesterId) : undefined;
    const weekStart = req.query.weekStart ? String(req.query.weekStart) : undefined;
    if (!Number.isFinite(gradeLevel)) {
      return res.status(400).json({ success: false, error: 'Thiếu khối (gradeLevel)', code: 'VALIDATION_ERROR' });
    }
    const result = await timetableService.clearGradeTimetable({ gradeLevel, semesterId, weekStart });
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
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

// GET /timetables/exams — list exam schedule + seats + makeup
router.get('/exams', roleMiddleware(['Admin', 'GiaoVien', 'HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    const gradeLevel = req.query.gradeLevel ? Number(req.query.gradeLevel) : undefined;
    const semesterId = req.query.semesterId ? Number(req.query.semesterId) : undefined;
    const weekStart = req.query.weekStart ? String(req.query.weekStart) : undefined;
    const date = req.query.date ? String(req.query.date) : undefined;
    const result = await timetableService.findExams({ gradeLevel, semesterId, weekStart, date });
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// POST /timetables/exams — create an exam for a whole grade
router.post('/exams', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = z.object({
      gradeLevel: z.coerce.number(),
      examDate: z.string(),
      session: z.enum(['morning', 'afternoon', 'both']).default('morning'),
      dayOfWeek: z.string(),
      subjectId: z.coerce.number(),
      periods: z.array(z.coerce.number()).optional(),
      semesterId: z.coerce.number().optional(),
      examName: z.string().optional(),
      proctorsPerRoom: z.coerce.number().optional(),
    }).parse(req.body);
    const result = await timetableService.createExamForGrade(body as any);
    if (!result.success) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// POST /timetables/exams/:scheduleId/proctors — (re)assign proctors to an existing exam
router.post('/exams/:scheduleId/proctors', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const scheduleId = Number(req.params.scheduleId);
    const proctorsPerRoom = req.body?.proctorsPerRoom ? Number(req.body.proctorsPerRoom) : undefined;
    const result = await timetableService.reassignProctors(scheduleId, proctorsPerRoom);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

router.get('/subjects', roleMiddleware(['Admin', 'GiaoVien']), async (_req, res) => {
  const result = await timetableService.subjects();
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

router.post('/subjects', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const result = await timetableService.getOrCreateSubject({ subject_name: req.body?.subject_name, subject_code: req.body?.subject_code });
    if (!result.success) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/semesters', roleMiddleware(['Admin', 'GiaoVien']), async (_req, res) => {
  const result = await timetableService.semesters();
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

// GET /timetables/my — returns the authenticated user's own timetable
router.get('/my', async (req: any, res) => {
  try {
    const user = req.user as any;
    const semesterId = req.query.semesterId ? Number(req.query.semesterId) : undefined;
    const weekStart = req.query.weekStart ? String(req.query.weekStart) : undefined;
    const q: any = { semesterId, weekStart, page: 1, limit: 200 };

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
        const result = await timetableService.findMany(q);
        if (!result.success) return res.status(400).json(result);
        // Merge the teacher's exam proctoring (coi thi / giám thị) into their own timetable.
        const duties = await timetableService.proctorSchedule({ teacherId: teacher.teacher_id, semesterId, weekStart });
        const received = result as any;
        return res.json({
          ...received,
          data: [...(Array.isArray(received.data) ? received.data : []), ...(duties.success ? (duties.data ?? []) : [])],
        });
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

      let roomName = null;
      if (student?.class_id) {
        const { data: cls } = await supabase
          .from('classes')
          .select('fixed_room_id, room:rooms!classes_fixed_room_id_fkey(room_name)')
          .eq('class_id', student.class_id)
          .maybeSingle();
        const fixed = (cls as any)?.room;
        roomName = Array.isArray(fixed) ? fixed[0]?.room_name : fixed?.room_name ?? null;
      }

      return res.json({ ...(result), className: (student as any).classes?.class_name ?? null, roomName });
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
    const { entries, weekStart } = req.body;
    // H1: thiếu weekStart làm delete trong bulkCreate xoá TKB của MỌI tuần.
    if (!weekStart) return res.status(400).json({ success: false, error: 'Thiếu weekStart (thứ 2 của tuần cần ghi)', code: 'VALIDATION_ERROR' });
    const result = await timetableService.bulkCreate(entries || [], weekStart);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});// POST /timetables/auto — server-side auto schedule (Sắp xếp tất cả lớp)
router.post('/auto', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const scope = req.body?.scope === 'selectedGrade' ? 'selectedGrade' : 'all';
    const gradeLevel = req.body?.gradeLevel ? Number(req.body.gradeLevel) : undefined;
    const semesterId = req.body?.semesterId ? Number(req.body.semesterId) : undefined;
    const semesterIds = Array.isArray(req.body?.semesterIds)
      ? req.body.semesterIds.map((n: any) => Number(n)).filter((n: any) => Number.isFinite(n) && n > 0)
      : undefined;
    const result = await autoScheduleService.run({
      scope,
      gradeLevel,
      semesterId,
      semesterIds,
      daysOf3Periods: req.body?.daysOf3Periods != null ? Number(req.body.daysOf3Periods) : undefined,
      daysOf4Periods: req.body?.daysOf4Periods != null ? Number(req.body.daysOf4Periods) : undefined,
      khtnPriority: req.body?.khtnPriority,
      examBlocks: req.body?.examBlocks,
    });    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

export default router;

