import { Router } from 'express';
import { z } from 'zod';
import { userService } from '../services/user.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/public/accounts', async (req: any, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('user_id, email, role_id, username')
      .order('user_id');
    if (error) throw error;
    const rows = (data as any[]) || [];
    const result = await Promise.all(rows.map(async (u) => {
      let roleName = 'student';
      if (u.role_id) {
        const { data: r } = await supabase
          .from('roles').select('role_name').eq('role_id', u.role_id).single();
        if (r?.role_name) roleName = r.role_name;
      }
      return { id: u.user_id, email: u.email, role: roleName, name: u.username || u.email };
    }));
    return res.json({ success: true, data: result });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.use(authMiddleware);

const paginationSchema = z.object({
  search: z.string().optional(),
  role: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(10),
}).passthrough();

router.get('/', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const params = paginationSchema.parse(req.query);
    const result = await userService.findMany({
      search: params.search,
      role: params.role,
      page: params.page,
      limit: params.limit,
    });
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

router.get('/:id', async (req: any, res) => {
  try {
    const result = await userService.findById(Number(req.params.id));
    if (!result.success) return res.status(404).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  username: z.string().optional(),
  phone: z.string().optional(),
  role: z.string(),
  full_name: z.string().optional(),
  gender: z.string().optional(),
  date_of_birth: z.string().optional(),
  class_id: z.coerce.number().optional(),
  student_code: z.string().optional(),
  teacher_code: z.string().optional(),
  department: z.string().optional(),
}).passthrough();

router.post('/', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = createSchema.parse(req.body) as any;
    const result = await userService.createUser(body);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});

const updateSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().optional(),
  phone: z.string().optional(),
  is_active: z.boolean().optional(),
  role: z.string().optional(),
  full_name: z.string().optional(),
  gender: z.string().optional(),
  date_of_birth: z.string().optional(),
  class_id: z.coerce.number().optional(),
  student_code: z.string().optional(),
  teacher_code: z.string().optional(),
  department: z.string().optional(),
  password: z.string().min(6).optional(),
});

router.delete('/:id', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const userId = Number(req.params.id)
    if (isNaN(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID', code: 'INVALID_ID' })
    }
    if (req.user!.userId === userId) {
      return res.status(400).json({ success: false, error: 'Khong duoc xoa tai khoan cua chinh minh', code: 'CANNOT_DELETE_SELF' })
    }
    await supabase.from("students").delete().eq("user_id", userId)
    await supabase.from("teachers").delete().eq("user_id", userId)
    const { error: userError } = await supabase.from("users").delete().eq("user_id", userId)
    if (userError) {
      return res.status(400).json({ success: false, error: userError.message, code: 'DELETE_FAILED' })
    }
    return res.json({ success: true })
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'DELETE_ERROR' })
  }
});

router.put('/:id', authMiddleware, async (req: any, res) => {
  try {
    const patch = updateSchema.parse(req.body);
    const userId = Number(req.params.id);
    if (req.user!.userId !== userId && req.user!.role !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
    }
    const data: any = { ...patch };
    if (req.user!.userId !== userId) { delete data.role; }
    const result = await userService.updateUser(userId, data);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
  }
});



export default router;
