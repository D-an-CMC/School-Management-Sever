import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { studentSelfService } from '../services/student-self.service';

const router = Router();

router.get('/my-info', authMiddleware, roleMiddleware(['HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    const userId = (req.user as any).userId as number;
    const result = await studentSelfService.getMyInfo(userId);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: 'Lỗi server', code: 'SERVER_ERROR' });
  }
});

router.get('/my-grades', authMiddleware, roleMiddleware(['HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    const userId = (req.user as any).userId as number;
    const result = await studentSelfService.getMyGrades(userId);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: 'Lỗi server', code: 'SERVER_ERROR' });
  }
});

router.get('/my-timetable', authMiddleware, roleMiddleware(['HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    const userId = (req.user as any).userId as number;
    const semesterId = req.query.semesterId ? Number(req.query.semesterId) : undefined;
    const result = await studentSelfService.getMyTimetable(userId, semesterId);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: 'Lỗi server', code: 'SERVER_ERROR' });
  }
});

router.get('/my-attendance', authMiddleware, roleMiddleware(['HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    const userId = (req.user as any).userId as number;
    const result = await studentSelfService.getMyAttendance(userId);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: 'Lỗi server', code: 'SERVER_ERROR' });
  }
});

router.get('/my-activities', authMiddleware, roleMiddleware(['HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    const userId = (req.user as any).userId as number;
    const result = await studentSelfService.getMyActivities(userId);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: 'Lỗi server', code: 'SERVER_ERROR' });
  }
});

export default router;
