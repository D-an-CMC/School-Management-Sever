import { Router } from 'express';
import { securityLogService } from '../services/security-log.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { success, error } from '../utils/response';

const router = Router();
router.use(authMiddleware);

// Restrict to Admin
router.use(roleMiddleware(['Admin', 'admin']));

router.get('/', async (req, res) => {
  try {
    const { search, action, status, role, page, limit } = req.query as any;
    const result = await securityLogService.getLogs({
      search: search ? String(search) : undefined,
      action: action ? String(action) : undefined,
      status: status ? String(status) : undefined,
      role: role ? String(role) : undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json(error(err.message, 'FETCH_SECURITY_LOGS_FAILED'));
  }
});

router.get('/stats', async (_req, res) => {
  try {
    const result = await securityLogService.getStats();
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json(error(err.message, 'FETCH_SECURITY_STATS_FAILED'));
  }
});

export default router;
