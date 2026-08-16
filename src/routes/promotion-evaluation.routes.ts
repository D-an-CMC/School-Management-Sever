import { Router } from 'express';
import { z } from 'zod';
import { promotionEvaluationService } from '../services/promotion-evaluation.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

// Tổng quan danh hiệu/lên lớp toàn trường.
router.get('/overview', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const yearId = Number(req.query.yearId);
    if (!yearId) return res.status(400).json({ success: false, error: 'Thiếu yearId' });
    const teacherId = req.query.teacherId ? Number(req.query.teacherId) : undefined;
    const result = await promotionEvaluationService.overview(yearId, { teacherId });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Tính + ghi kết quả cho cả lớp.
router.post('/classes/:classId/evaluate', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const classId = Number(req.params.classId);
    const { yearId } = z.object({ yearId: z.coerce.number() }).parse(req.body);
    const result = await promotionEvaluationService.evaluateClass(classId, yearId);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// Lấy kết quả một lớp (tự tính nếu chưa có).
router.get('/classes/:classId', roleMiddleware(['Admin', 'GiaoVien', 'HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    const classId = Number(req.params.classId);
    const yearId = Number(req.query.yearId);
    const recompute = req.query.recompute === 'true';
    if (!yearId) return res.status(400).json({ success: false, error: 'Thiếu yearId' });
    const result = await promotionEvaluationService.getClassResults(classId, yearId, recompute);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Chi tiết một học sinh.
router.get('/students/:studentId', roleMiddleware(['Admin', 'GiaoVien', 'HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    const studentId = Number(req.params.studentId);
    const yearId = Number(req.query.yearId);
    if (!yearId) return res.status(400).json({ success: false, error: 'Thiếu yearId' });
    const result = await promotionEvaluationService.getStudentResult(studentId, yearId);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// GVCN/Hiệu trưởng xác nhận kết quả cuối.
router.post('/results/:resultId/confirm', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const resultId = Number(req.params.resultId);
    const { finalResult } = z.object({ finalResult: z.string() }).parse(req.body);
    const reviewerId = Number(req.user?.userId);
    const result = await promotionEvaluationService.confirmResult(resultId, finalResult, reviewerId);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// Khóa kết quả.
router.post('/results/:resultId/finalize', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const resultId = Number(req.params.resultId);
    const finalizerId = Number(req.user?.userId);
    const result = await promotionEvaluationService.finalizeResult(resultId, finalizerId);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
