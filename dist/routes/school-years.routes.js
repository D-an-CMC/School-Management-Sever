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
});
router.get('/', roleMiddleware(['Admin', 'GiaoVien']), async (req, res) => {
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
    }
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});
router.get('/all', roleMiddleware(['Admin', 'GiaoVien']), async (_req, res) => {
    try {
        const { data, error } = await supabase.from('school_years').select('*').order('start_date', { ascending: false });
        if (error)
            return res.status(400).json({ success: false, error: error.message });
        return res.json({ success: true, data });
    }
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});
router.post('/', roleMiddleware(['Admin']), async (req, res) => {
    try {
        const body = bodySchema.parse(req.body);
        const { data, error } = await supabase.from('school_years').insert({
            year_name: body.year_name,
            start_date: body.start_date,
            end_date: body.end_date,
        }).select().single();
        if (error)
            return res.status(400).json({ success: false, error: error.message });
        return res.json({ success: true, data });
    }
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});
router.put('/:id', roleMiddleware(['Admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const body = bodySchema.parse(req.body);
        const { data, error } = await supabase.from('school_years').update({
            year_name: body.year_name,
            start_date: body.start_date,
            end_date: body.end_date,
        }).eq('school_year_id', id).select().single();
        if (error)
            return res.status(400).json({ success: false, error: error.message });
        return res.json({ success: true, data });
    }
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});
router.delete('/:id', roleMiddleware(['Admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('school_years').delete().eq('school_year_id', id);
        if (error)
            return res.status(400).json({ success: false, error: error.message });
        return res.json({ success: true });
    }
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});
export default router;
//# sourceMappingURL=school-years.routes.js.map