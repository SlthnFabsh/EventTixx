import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { hasPermission } from '../lib/rbac';
import { AppError } from '../utils/app-error';
import '../types/auth';

const extractBearerToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
};

const resolveUserFromToken = async (token: string) => {
  const payload = verifyAccessToken(token);

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      roleId: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      pointBalance: true,
      role: { select: { name: true } },
    },
  });

  if (!user) {
    throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 401);
  }

  if (user.status === 'SUSPENDED') {
    throw new AppError(
      'ACCOUNT_SUSPENDED',
      'Akun Anda telah ditangguhkan. Silakan hubungi admin.',
      403,
    );
  }

  return {
    id: user.id,
    roleId: user.roleId,
    role: user.role.name,
    email: user.email,
    name: user.name,
    phone: user.phone,
    status: user.status,
    pointBalance: user.pointBalance,
  };
};

/**
 * Wajib login: jika tidak ada token / token invalid / akun suspend -> throw 401/403.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new AppError('UNAUTHORIZED', 'Header otorisasi diperlukan', 401);
    }

    req.user = await resolveUserFromToken(token);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Otorisasi opsional: jika ada token valid, pasang req.user (member).
 * Jika tidak ada token, req.user tetap undefined (guest) tanpa melempar error.
 */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      req.user = undefined;
      return next();
    }

    try {
      req.user = await resolveUserFromToken(token);
    } catch (error) {
      if (error instanceof AppError && error.code === 'TOKEN_EXPIRED') {
        req.user = undefined;
        next();
        return;
      }

      next(error);
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Otorisasi berbasis permission code (dari seed role_permissions).
 */
export const authorize = (permissionCode: string): RequestHandler => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('UNAUTHORIZED', 'Silakan login terlebih dahulu', 401);
      }

      const allowed = await hasPermission(req.user.roleId, permissionCode);
      if (!allowed) {
        throw new AppError(
          'FORBIDDEN',
          `Anda tidak memiliki izin: ${permissionCode}`,
          403,
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
