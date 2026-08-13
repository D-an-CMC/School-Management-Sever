import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { supabase } from '../config/supabase';

const router = Router();
router.use(authMiddleware);

const querySchema = z.object({
  classId: z.coerce.number().optional(),
  search: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(20),
});

const bodySchema = z.object({
  year_name: z.string().min(4),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  is_current: z.boolean().optional(),
});

router.get('/', roleMiddleware(['Admin', 'GiaoVien', 'HocSinh-PhuHuynh']), async (req: any, res) => {
  try {
    const q = querySchema.parse(req.query);
    let dbQuery = supabase.from('school_years').select('*', { count: 'exact' }).order('start_date', { ascending: false });

    if (q.classId) {
      const cls = await supabase.from('classes').select('school_year_id').eq('class_id', q.classId).single();
      if (cls.data?.school_year_id) {
        dbQuery = dbQuery.eq('school_year_id', cls.data.school_year_id);
      }
    }

    const { offset, limit } = { offset: (q.page - 1) * q.limit, limit: q.limit };
    const result = await dbQuery.range(offset, offset + q.limit);

    if (result.error) {
      return res.status(400).json({ success: false, error: result.error.message });
    }

    return res.json({
      success: true,
      data: result.data,
      total: result.count ?? 0,
      page: q.page,
      limit: q.limit,
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/all', roleMiddleware(['Admin', 'GiaoVien']), async (_req: any, res) => {
  try {
    const { data, error } = await supabase.from('school_years').select('*').order('start_date', { ascending: false });
    if (error) return res.status(400).json({ success: false, error: error.message });
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Return the single current school year (is_current = true), or null.
router.get('/current', async (_req: any, res) => {
  try {
    const { data, error } = await supabase
      .from('school_years')
      .select('*')
      .eq('is_current', true)
      .maybeSingle();
    if (error) return res.status(400).json({ success: false, error: error.message });
    return res.json({ success: true, data: data ?? null });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Mark a school year as the current one (resets all others to false).
router.post('/:id/set-current', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const yearId = Number(id);
    const { data: exists } = await supabase.from('school_years').select('school_year_id').eq('school_year_id', yearId).maybeSingle();
    if (!exists) return res.status(404).json({ success: false, error: 'Không tìm thấy năm học' });

    await supabase.from('school_years').update({ is_current: false }).neq('school_year_id', yearId);
    const { data, error } = await supabase.from('school_years').update({ is_current: true }).eq('school_year_id', yearId).select().single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = bodySchema.parse(req.body);
    const payload: any = {
      year_name: body.year_name,
      start_date: body.start_date,
      end_date: body.end_date,
    };
    if (body.is_current) {
      await supabase.from('school_years').update({ is_current: false }).not('is_current', 'is', null);
      payload.is_current = true;
    }
    const { data, error } = await supabase.from('school_years').insert(payload).select().single();

    if (error) return res.status(400).json({ success: false, error: error.message });
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/:id', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const body = bodySchema.parse(req.body);
    const payload: Record<string, unknown> = {
      year_name: body.year_name,
      start_date: body.start_date,
      end_date: body.end_date,
    };
    // If setting this year as current, first reset every other year.
if (body.is_current) {
      await supabase.from('school_years').update({ is_current: false }).neq('is_current', false);
      payload.is_current = true;
    }
    if (typeof body.is_current === 'boolean') {
      payload.is_current = body.is_current;
    }
    const { data, error } = await supabase.from('school_years').update(payload).eq('school_year_id', id).select().single();

    if (error) return res.status(400).json({ success: false, error: error.message });
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('school_years').delete().eq('school_year_id', id);
    if (error) return res.status(400).json({ success: false, error: error.message });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
