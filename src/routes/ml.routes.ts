import { Router } from 'express';
import { z } from 'zod';
import { mlService } from '../services/ml.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

const ROLES_VIEW = ['Admin', 'GiaoVien', 'HocSinh-PhuHuynh'];

// GET /api/ml/health — kiểm tra ML API có sống không
router.get('/health', roleMiddleware(ROLES_VIEW), async (_req, res) => {
  const result = await mlService.health();
  if (!(result as any).success) return res.status(503).json(result);
  return res.json(result);
});

// POST /api/ml/predict-class — dự đoán CK + ĐTB môn cho cả lớp (fill cột AI Dự Đoán)
// body: { classId, subjectId, semesterId? }
router.post('/predict-class', roleMiddleware(ROLES_VIEW), async (req: any, res) => {
  try {
    const schema = z.object({
      classId: z.coerce.number(),
      subjectId: z.coerce.number(),
      semesterId: z.coerce.number().optional(),
    });
    const { classId, subjectId, semesterId } = schema.parse(req.body);
    const result = await mlService.predictClass(classId, subjectId, semesterId);
    if (!(result as any).success) {
      const code = (result as any).code;
      const status =
        code === 'ML_NOT_CONFIGURED' ? 503 : code === 'ML_UNREACHABLE' || String(code).startsWith('ML_API') ? 502 : 400;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// POST /api/ml/predict-student — dự đoán ĐTB học kỳ cho 1 HS (gộp tất cả môn)
// body: { studentId, semesterId? }
router.post('/predict-student', roleMiddleware(ROLES_VIEW), async (req: any, res) => {
  try {
    const schema = z.object({
      studentId: z.coerce.number(),
      semesterId: z.coerce.number().optional(),
    });
    const { studentId, semesterId } = schema.parse(req.body);
    const result = await mlService.predictStudentSemester(studentId, semesterId);
    if (!(result as any).success) {
      const code = (result as any).code;
      const status =
        code === 'ML_NOT_CONFIGURED' ? 503 : code === 'ML_UNREACHABLE' || String(code).startsWith('ML_API') ? 502 : 400;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// POST /api/ml/predict — dự đoán điểm CK trực tiếp theo bộ điểm gửi lên
// body: { grade, semester, TX1, TX2?, TX3?, TX4?, GK, DTB1? }
router.post('/predict', roleMiddleware(ROLES_VIEW), async (req: any, res) => {
  try {
    const schema = z.object({
      grade: z.coerce.number().min(6).max(9),
      semester: z.string().transform((s) => s.toUpperCase()),
      TX1: z.coerce.number().min(0).max(10),
      TX2: z.coerce.number().min(0).max(10).optional(),
      TX3: z.coerce.number().min(0).max(10).optional(),
      TX4: z.coerce.number().min(0).max(10).optional(),
      GK: z.coerce.number().min(0).max(10),
      DTB1: z.coerce.number().min(0).max(10).optional(),
    });
    const payload = schema.parse(req.body);
    const result = await mlService.predict({
      grade: payload.grade,
      semester: payload.semester,
      TX1: payload.TX1,
      TX2: payload.TX2,
      TX3: payload.TX3,
      TX4: payload.TX4,
      GK: payload.GK,
      DTB1: payload.DTB1,
    });
    if (!(result as any).success) {
      const code = (result as any).code;
      const status =
        code === 'ML_NOT_CONFIGURED' ? 503 : code === 'ML_UNREACHABLE' || String(code).startsWith('ML_API') ? 502 : 400;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

export default router;
