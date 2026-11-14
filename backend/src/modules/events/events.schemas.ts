import { EventStatus } from '@prisma/client';
import { z } from 'zod';

const eventStatusSchema = z.enum([
  EventStatus.DRAFT,
  EventStatus.PUBLISHED,
  EventStatus.ONGOING,
  EventStatus.FINISHED,
  EventStatus.CANCELLED,
]);

const eventFields = {
  title: z.string().trim().min(3).max(200),
  description: z.string().max(10_000).nullable().optional(),
  posterUrl: z.string().url().nullable().optional(),
  venueName: z.string().trim().min(2).max(200),
  venueAddress: z.string().trim().max(500).nullable().optional(),
  city: z.string().trim().min(2).max(100),
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullable().optional(),
};

const validateEventDates = (
  data: { startAt: Date; endAt?: Date | null },
  ctx: z.RefinementCtx,
) => {
  if (data.endAt && data.endAt <= data.startAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['endAt'],
      message: 'Waktu selesai harus setelah waktu mulai',
    });
  }
};

export const createEventSchema = z
  .object(eventFields)
  .superRefine(validateEventDates);

export const updateEventSchema = z
  .object({
    ...eventFields,
    status: eventStatusSchema,
  })
  .partial()
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Minimal satu field harus diubah' });
    }

    if (data.startAt && data.endAt && data.endAt <= data.startAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'Waktu selesai harus setelah waktu mulai',
      });
    }
  });

const categoryFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2_000).nullable().optional(),
  price: z.number().int().min(0),
  quota: z.number().int().min(0),
  maxPerOrder: z.number().int().min(1).max(100).default(5),
  saleStartAt: z.coerce.date().nullable().optional(),
  saleEndAt: z.coerce.date().nullable().optional(),
};

const validateSaleWindow = (
  data: { saleStartAt?: Date | null; saleEndAt?: Date | null },
  ctx: z.RefinementCtx,
) => {
  if (
    data.saleStartAt &&
    data.saleEndAt &&
    data.saleEndAt <= data.saleStartAt
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['saleEndAt'],
      message: 'Waktu akhir penjualan harus setelah waktu mulai',
    });
  }
};

export const createCategorySchema = z
  .object(categoryFields)
  .superRefine(validateSaleWindow);

export const updateCategorySchema = z
  .object({
    ...categoryFields,
    isActive: z.boolean(),
  })
  .partial()
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Minimal satu field harus diubah' });
    }
    validateSaleWindow(data, ctx);
  });

export const assignStaffSchema = z.object({
  userId: z.string().uuid(),
});

export const eventIdParamsSchema = z.object({
  eventId: z.string().uuid(),
});

export const eventCategoryParamsSchema = z.object({
  eventId: z.string().uuid(),
  categoryId: z.string().uuid(),
});

export const eventStaffParamsSchema = z.object({
  eventId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
