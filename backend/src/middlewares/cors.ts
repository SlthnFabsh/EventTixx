import cors from 'cors';
import { env } from '../config/env';
import { AppError } from '../utils/app-error';

const allowedOrigins = new Set(
  [
    env.APP_URL,
    ...(env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()) ?? []),
  ].filter(Boolean),
);

export const corsMiddleware = cors({
  credentials: true,
  origin(origin, callback) {
    // Request tanpa Origin (curl, Postman, mobile) tetap diizinkan.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new AppError('CORS_ORIGIN_DENIED', `Origin ${origin} tidak diizinkan`, 403));
  },
});
