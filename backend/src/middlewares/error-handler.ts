import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { AppError } from '../utils/app-error';
import { fail } from '../utils/response';

const formatZodIssues = (error: ZodError) =>
  error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }));

const handleError = (error: unknown, req: Request, res: Response): void => {
  if (error instanceof AppError) {
    if (error.httpStatus >= 500) {
      console.error(`[${error.code}] ${req.method} ${req.originalUrl}:`, error.message);
    }
    fail(res, error.code, error.message, error.httpStatus, error.details);
    return;
  }

  if (error instanceof ZodError) {
    fail(res, 'VALIDATION_ERROR', 'Input tidak valid', 400, formatZodIssues(error));
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const details = env.NODE_ENV === 'production' ? undefined : error.meta;

    if (error.code === 'P2002') {
      fail(res, 'CONFLICT', 'Data dengan nilai unik tersebut sudah ada', 409, details);
      return;
    }

    if (error.code === 'P2025') {
      fail(res, 'NOT_FOUND', 'Data tidak ditemukan', 404);
      return;
    }

    if (error.code === 'P2003') {
      fail(res, 'FOREIGN_KEY_CONFLICT', 'Data masih direferensikan oleh data lain', 409);
      return;
    }

    console.error(`[PRISMA_${error.code}] ${req.method} ${req.originalUrl}:`, error.message);
    fail(res, 'DATABASE_ERROR', 'Terjadi kesalahan pada database', 500);
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    fail(res, 'INVALID_JSON', 'Body JSON tidak valid', 400);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`[UNHANDLED] ${req.method} ${req.originalUrl}:`, error);

  fail(
    res,
    'INTERNAL_SERVER_ERROR',
    env.NODE_ENV === 'production' ? 'Terjadi kesalahan pada server' : message,
    500,
  );
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  handleError(error, req, res);
};

export const notFoundHandler: RequestHandler = (req, res) => {
  fail(
    res,
    'NOT_FOUND',
    `Route ${req.method} ${req.originalUrl} tidak ditemukan`,
    404,
  );
};
