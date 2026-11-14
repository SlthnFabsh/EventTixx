import { Router } from 'express';
import { authenticate } from '../../middlewares/auth';
import { authLimiter } from '../../middlewares/rate-limit';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/async-handler';
import { authController } from './auth.controller';
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  updateMeSchema,
} from './auth.schemas';

export const authRouter = Router();

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(authController.register),
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login),
);

authRouter.post(
  '/refresh',
  validate({ body: refreshSchema }),
  asyncHandler(authController.refresh),
);

authRouter.post('/logout', asyncHandler(authController.logout));

authRouter.get('/me', authenticate, asyncHandler(authController.getMe));

authRouter.patch(
  '/me',
  authenticate,
  validate({ body: updateMeSchema }),
  asyncHandler(authController.updateMe),
);
