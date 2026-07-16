export function roleMiddleware(allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
        }
        const userRole = req.user.role;
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
        }
        next();
    };
}
//# sourceMappingURL=role.middleware.js.map