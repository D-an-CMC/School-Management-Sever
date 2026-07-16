import { Request, Response, NextFunction } from 'express';
import { error } from '../utils/response';

export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error('Error:', err);
  res.status(500).json(error(err.message || 'Internal server error', 'INTERNAL_ERROR'));
}
