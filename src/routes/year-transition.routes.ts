import { Router } from 'express';
import { z } from 'zod';
import { yearTransitionService } from '../services/year-transition.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/overview', roleMiddleware(['Admin']), async (_req: any, res) => {
  try {
    const result = await yearTransitionService.overview();
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/preview', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const fromYearId = Number(req.query.fromYearId);
    const toYearId = Number(req.query.toYearId);
    if (!fromYearId || !toYearId) {
      return res.status(400).json({ success: false, error: 'Thiếu fromYearId / toYearId' });
    }
    const result = await yearTransitionService.previewTransition(fromYearId, toYearId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/classes', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const yearId = Number(req.query.yearId);
    if (!yearId) return res.status(400).json({ success: false, error: 'Thiếu yearId' });
    const result = await yearTransitionService.ensureClasses(yearId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/semesters', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = z.object({
      yearId: z.coerce.number(),
      hk1Start: z.string().nullable().optional(),
      hk1End: z.string().nullable().optional(),
      hk2Start: z.string().nullable().optional(),
      hk2End: z.string().nullable().optional(),
    }).parse(req.body);
    const result = await yearTransitionService.createSemesters(body.yearId, {
      hk1Start: body.hk1Start,
      hk1End: body.hk1End,
      hk2Start: body.hk2Start,
      hk2End: body.hk2End,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

router.post('/apply', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = z.object({
      fromYearId: z.coerce.number(),
      toYearId: z.coerce.number(),
      decisions: z.array(z.object({
        student_id: z.coerce.number(),
        status: z.string(),
        class_id: z.coerce.number().nullable().optional(),
        grade_level: z.coerce.number().nullable().optional(),
      })).optional().default([]),
      hk1Start: z.string().nullable().optional(),
      hk1End: z.string().nullable().optional(),
      hk2Start: z.string().nullable().optional(),
      hk2End: z.string().nullable().optional(),
    }).parse(req.body);
    const result = await yearTransitionService.applyTransition(
      body.fromYearId,
      body.toYearId,
      body.decisions,
      {
        hk1Start: body.hk1Start,
        hk1End: body.hk1End,
        hk2Start: body.hk2Start,
        hk2End: body.hk2End,
      }
    );
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

router.post('/revert', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const { fromYearId, toYearId } = z.object({
      fromYearId: z.coerce.number(),
      toYearId: z.coerce.number(),
    }).parse(req.body);
    const result = await yearTransitionService.revertTransition(fromYearId, toYearId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/clear', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const { yearId } = z.object({ yearId: z.coerce.number() }).parse(req.body);
    const result = await yearTransitionService.clearYear(yearId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/activate', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const { yearId } = z.object({ yearId: z.coerce.number() }).parse(req.body);
    const result = await yearTransitionService.activateYear(yearId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
