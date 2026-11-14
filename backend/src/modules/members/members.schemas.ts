import { z } from 'zod';

const paginationFields = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

export const paginationQuerySchema = z.object(paginationFields);

export const memberOrderParamsSchema = z.object({
  code: z.string().regex(/^ETX-\d{6}-[A-Z0-9_-]{6}$/),
});
