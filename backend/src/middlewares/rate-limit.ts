import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { fail } from '../utils/response';

const rateLimitHandler = (_req: Request, res: Response): void => {
  fail(res, 'RATE_LIMITED', 'Terlalu banyak permintaan. Silakan coba lagi nanti.', 429);
};

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: rateLimitHandler,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: rateLimitHandler,
});
