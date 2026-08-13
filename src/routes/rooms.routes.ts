import { Router } from 'express';
import { z } from 'zod';
import { roomService } from '../services/room.service';
import { classService } from '../services/class.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = Router();
router.use(authMiddleware);

const roomBody = z.object({
  room_name: z.string().min(1),
  room_type: z.string().optional().nullable(),
});

const classRoomsBody = z.object({
  room_ids: z.array(z.coerce.number()).default([]),
});

const classFixedBody = z.object({
  fixed_room_id: z.coerce.number().nullable().optional(),
});

// GET /rooms — list all rooms
router.get('/', roleMiddleware(['Admin', 'GiaoVien']), async (_req: any, res) => {
  try {
    const result = await roomService.list();
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// GET /rooms/class/:classId — rooms assignable to a class + its fixed room
router.get('/class/:classId', roleMiddleware(['Admin', 'GiaoVien']), async (req: any, res) => {
  try {
    const result = await roomService.classRooms(Number(req.params.classId));
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// PUT /rooms/class/:classId — set assignable rooms for a class
router.put('/class/:classId', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = classRoomsBody.parse(req.body);
    const result = await roomService.saveClassRooms(Number(req.params.classId), body.room_ids);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// PUT /rooms/class/:classId/fixed — set the class's fixed (homeroom) room
router.put('/class/:classId/fixed', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = classFixedBody.parse(req.body);
    const result = await classService.update(Number(req.params.classId), { fixed_room_id: body.fixed_room_id ?? null });
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// POST /rooms — create a room
router.post('/', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = roomBody.parse(req.body);
    const result = await roomService.create(body as any);
    if (!result.success) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// PUT /rooms/:id — update a room
router.put('/:id', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = roomBody.partial().parse(req.body);
    const result = await roomService.update(Number(req.params.id), body as any);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

// DELETE /rooms/:id — delete a room
router.delete('/:id', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const result = await roomService.remove(Number(req.params.id));
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

export default router;
