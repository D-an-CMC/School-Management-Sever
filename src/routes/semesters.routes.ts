import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { supabase } from '../config/supabase';

const router = Router();
router.use(authMiddleware);

const querySchema = z.object({
  school_year_id: z.coerce.number().optional(),
});

const bodySchema = z.object({
  school_year_id: z.coerce.number(),
  semester_name: z.string().min(1),
  term_order: z.coerce.number().int().min(1).max(2).optional(),
  is_active: z.boolean().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

// List semesters, optionally filtered by a school year.
router.get('/', async (req: any, res) => {
  try {
    const q = querySchema.parse(req.query);
    let dbQuery = supabase
      .from('semesters')
      .select('*, school_year:school_years(*)')
      .order('term_order', { ascending: true });

    if (q.school_year_id) {
      dbQuery = dbQuery.eq('school_year_id', q.school_year_id);
    }

    const { data, error } = await dbQuery;
    if (error) return res.status(400).json({ success: false, error: error.message });
    return res.json({ success: true, data: data ?? [] });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Return the single active semester of the current school year (or null).
router.get('/current', async (_req: any, res) => {
  try {
    const { data: currentYear } = await supabase
      .from('school_years')
      .select('school_year_id')
      .eq('is_current', true)
      .maybeSingle();

    if (!currentYear) {
      return res.json({ success: true, data: null });
    }

    const { data: active } = await supabase
      .from('semesters')
      .select('*, school_year:school_years(*)')
      .eq('school_year_id', currentYear.school_year_id)
      .eq('is_active', true)
      .maybeSingle();

    return res.json({ success: true, data: active ?? null });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const body = bodySchema.parse(req.body);
    const { data: year } = await supabase
      .from('school_years')
      .select('school_year_id')
      .eq('school_year_id', body.school_year_id)
      .maybeSingle();
    if (!year) return res.status(404).json({ success: false, error: 'Không tìm thấy năm học' });

    const payload: Record<string, unknown> = {
      school_year_id: body.school_year_id,
      semester_name: body.semester_name,
    };
    if (body.term_order != null) payload.term_order = body.term_order;
    if (body.start_date) payload.start_date = body.start_date;
    if (body.end_date) payload.end_date = body.end_date;
    if (body.is_active) {
      await supabase.from('semesters').update({ is_active: false }).eq('school_year_id', body.school_year_id).neq('is_active', false);
      payload.is_active = true;
    }

    const { data, error } = await supabase.from('semesters').insert(payload).select('*, school_year:school_years(*)').single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Mark a semester as the active one (resets others in the same school year).
router.post('/:id/set-active', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const semesterId = Number(req.params.id);
    const { data: sem } = await supabase
      .from('semesters')
      .select('school_year_id')
      .eq('semester_id', semesterId)
      .maybeSingle();
    if (!sem) return res.status(404).json({ success: false, error: 'Không tìm thấy học kỳ' });

    await supabase.from('semesters').update({ is_active: false }).eq('school_year_id', sem.school_year_id).neq('is_active', false);
    const { data, error } = await supabase
      .from('semesters')
      .update({ is_active: true })
      .eq('semester_id', semesterId)
      .select('*, school_year:school_years(*)')
      .single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/:id', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const semesterId = Number(req.params.id);
    const body = bodySchema.partial().parse(req.body);
    const payload: Record<string, unknown> = {};
    if (body.semester_name != null) payload.semester_name = body.semester_name;
    if (body.term_order != null) payload.term_order = body.term_order;
    if (body.start_date != null) payload.start_date = body.start_date;
    if (body.end_date != null) payload.end_date = body.end_date;
    if (body.is_active === true) {
      await supabase.from('semesters').update({ is_active: false }).eq('school_year_id', body.school_year_id ?? 0);
      payload.is_active = true;
    } else if (body.is_active === false) {
      payload.is_active = false;
    }

    const { data, error } = await supabase.from('semesters').update(payload).eq('semester_id', semesterId).select('*, school_year:school_years(*)').single();
    if (error) return res.status(400).json({ success: false, error: error.message });
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id', roleMiddleware(['Admin']), async (req: any, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('semesters').delete().eq('semester_id', id);
    if (error) return res.status(400).json({ success: false, error: error.message });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;