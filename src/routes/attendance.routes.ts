import { Router } from 'express';
import { z } from 'zod';
import { attendanceService } from '../services/attendance.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

const sessionQuery = z.object({
  teacherId: z.coerce.number().optional(),
  classId: z.coerce.number().optional(),
  semesterId: z.coerce.number().optional(),
  schoolYearId: z.coerce.number().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(50),
});

router.get('/sessions', roleMiddleware(['Admin', 'GiaoVien', 'HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    const q = sessionQuery.parse(req.query);
    const result = await attendanceService.findSessions(q);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

const createSessionSchema = z.object({
  teacherId: z.coerce.number().optional(),
  sessionDate: z.string().optional(),
  classId: z.coerce.number().optional(),
  semesterId: z.coerce.number().optional(),
  schoolYearId: z.coerce.number().optional(),
  session: z.enum(['MORNING', 'AFTERNOON']).optional(),
  students: z.array(z.coerce.number()).optional(),
});

router.post('/sessions', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const body = createSessionSchema.parse(req.body);
    const result = await attendanceService.createSession(body);
    if (!result.success) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

router.get('/sessions/:sessionId', roleMiddleware(['Admin', 'GiaoVien', 'HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    const result = await attendanceService.findWithRecords(Number(req.params.sessionId));
    if (!result.success) return res.status(404).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

const batchSchema = z.object({
  records: z.array(
    z.object({
      attendanceId: z.number(),
      status: z.string(),
      note: z.string().optional(),
    })
  ),
});

router.put('/records/batch', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const { records } = batchSchema.parse(req.body) as any;
    const result = await attendanceService.batchUpdate(records as any);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

const saveByStudentSchema = z.object({
  records: z.array(
    z.object({
      studentId: z.coerce.number(),
      status: z.string(),
      note: z.string().optional(),
    })
  ),
});

// Ghi điểm danh theo session + student_id (tự tạo bản ghi nếu chưa có).
router.put('/sessions/:sessionId/records', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const { records } = saveByStudentSchema.parse(req.body) as any;
    const result = await attendanceService.saveByStudent(sessionId, records as any);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

export default router;
