import { Router } from 'express';
import { z } from 'zod';
import { timetableService } from '../services/timetable.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
const router = Router();
router.use(authMiddleware);
const timetableQuery = z.object({
    teacherId: z.coerce.number().optional(),
    classId: z.coerce.number().optional(),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50),
});
router.get('/timetables', roleMiddleware(['Admin', 'GiaoVien']), async (req, res) => {
    try {
        const q = timetableQuery.parse(req.query);
        const result = await timetableService.findMany(q);
        if (!result.success)
            return res.status(400).json(result);
        return res.json(result);
    }
    catch (err) {
        return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
    }
});
router.get('/exam-schedules', async (req, res) => {
    try {
        const classId = req.query.classId ? Number(req.query.classId) : undefined;
        const semesterId = req.query.semesterId ? Number(req.query.semesterId) : undefined;
        const result = await timetableService.examSchedules({ classId, semesterId });
        if (!result.success)
            return res.status(400).json(result);
        return res.json(result);
    }
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});
router.get('/subjects', async (_req, res) => {
    const result = await timetableService.subjects();
    if (!result.success)
        return res.status(400).json(result);
    return res.json(result);
});
router.get('/semesters', async (_req, res) => {
    const result = await timetableService.semesters();
    if (!result.success)
        return res.status(400).json(result);
    return res.json(result);
});
export default router;
//# sourceMappingURL=timetable.routes.js.map