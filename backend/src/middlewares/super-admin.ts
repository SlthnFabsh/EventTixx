import type { RequestHandler } from 'express';
import { RoleName } from '@prisma/client';
import { AppError } from '../utils/app-error';

export const requireSuperAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== RoleName.SUPER_ADMIN) {
    next(
      new AppError(
        'FORBIDDEN',
        'Endpoint ini hanya tersedia untuk Super Admin',
        403,
      ),
    );
    return;
  }
  next();
};
