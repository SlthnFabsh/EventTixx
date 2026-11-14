import { z } from 'zod';

export const publicEventsQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .superRefine((query, ctx) => {
    if (query.from && query.to && query.from > query.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Tanggal akhir tidak boleh sebelum tanggal mulai',
      });
    }
  });

export const publicEventParamsSchema = z.object({
  slug: z.string().min(1).max(250).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export type PublicEventsQuery = z.infer<typeof publicEventsQuerySchema>;
