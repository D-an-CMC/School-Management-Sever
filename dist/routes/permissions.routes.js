import { Router } from 'express';
import { permissionService } from '../services/permission.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
const router = Router();
router.use(authMiddleware);
router.get('/roles', roleMiddleware(['Admin']), async (_req, res) => {
    const result = await permissionService.findAllRoles();
    if (!result.success)
        return res.status(400).json(result);
    return res.json(result);
});
router.get('/roles/:id/permissions', roleMiddleware(['Admin']), async (req, res) => {
    const result = await permissionService.findPermissionsByRole(Number(req.params.id));
    if (!result.success)
        return res.status(400).json(result);
    return res.json(result);
});
router.put('/roles/:id/permissions', roleMiddleware(['Admin']), async (req, res) => {
    const { permissionIds } = req.body;
    const result = await permissionService.updatePermissions(Number(req.params.id), permissionIds || []);
    if (!result.success)
        return res.status(400).json(result);
    return res.json(result);
});
router.get('/permissions', roleMiddleware(['Admin']), async (_req, res) => {
    const result = await permissionService.findAllPermissions();
    if (!result.success)
        return res.status(400).json(result);
    return res.json(result);
});
export default router;
//# sourceMappingURL=permissions.routes.js.map