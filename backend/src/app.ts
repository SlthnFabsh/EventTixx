import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { corsMiddleware } from './middlewares/cors';
import { errorHandler, notFoundHandler } from './middlewares/error-handler';
import { apiLimiter } from './middlewares/rate-limit';
import { authRouter } from './modules/auth/auth.routes';
import { authController } from './modules/auth/auth.controller';
import { adminUsersRouter } from './modules/admin/users.routes';
import { authenticate } from './middlewares/auth';
import { validate } from './middlewares/validate';
import { updateMeSchema } from './modules/auth/auth.schemas';
import { AppError } from './utils/app-error';
import { asyncHandler } from './utils/async-handler';
import { ok } from './utils/response';
import { eventsManagementRouter } from './modules/events/events.routes';
import { publicEventsRouter } from './modules/events/catalog.routes';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(corsMiddleware);
app.use(
  morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    skip: () => env.NODE_ENV === 'test',
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// Rate limit umum pada seluruh prefix /api
app.use('/api', apiLimiter);

app.get('/', (_req, res) => {
  ok(res, { service: 'EventTixx API', version: 'v1' }, 'EventTixx API is running');
});

app.get(
  '/api/v1/health',
  asyncHandler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      ok(res, { db: 'up' });
    } catch (error) {
      console.error(
        'Health check failed:',
        error instanceof Error ? error.message : String(error),
      );
      throw new AppError('DB_DOWN', 'Database connection failed', 503);
    }
  }),
);

// Auth & Profil
app.use('/api/v1/auth', authRouter);

// Alias /api/v1/me sesuai GUIDE §3.1
app.get('/api/v1/me', authenticate, asyncHandler(authController.getMe));
app.patch(
  '/api/v1/me',
  authenticate,
  validate({ body: updateMeSchema }),
  asyncHandler(authController.updateMe),
);

// Admin staff management
app.use('/api/v1/admin/users', adminUsersRouter);
app.use('/api/v1/events', publicEventsRouter);
app.use('/api/v1/manage/events', eventsManagementRouter);

app.use(notFoundHandler);
app.use(errorHandler);
