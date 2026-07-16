import { error } from '../utils/response';
export function errorMiddleware(err, req, res, next) {
    console.error('Error:', err);
    res.status(500).json(error(err.message || 'Internal server error', 'INTERNAL_ERROR'));
}
//# sourceMappingURL=error.middleware.js.map