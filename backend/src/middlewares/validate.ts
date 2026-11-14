import type { RequestHandler } from 'express';
import { z } from 'zod';

export interface RequestValidationSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/**
 * Validasi input request memakai Zod.
 * Hasil parse ditulis kembali ke req.body / req.params / req.query.
 */
export const validate = (schemas: RequestValidationSchemas): RequestHandler => {
  return (req, _res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      if (schemas.params) {
        const parsedParams = schemas.params.parse(req.params);
        (req as unknown as { params: unknown }).params = parsedParams;
      }

      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', {
          value: parsedQuery,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
