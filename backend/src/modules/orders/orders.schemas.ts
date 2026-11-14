import { z } from 'zod';

const phoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+62|62|0)8[0-9]{7,11}$/, 'Nomor telepon Indonesia tidak valid');

const orderItemsSchema = z
  .array(
    z.object({
      ticketCategoryId: z.string().uuid(),
      quantity: z.number().int().min(1).max(100),
    }),
  )
  .min(1)
  .max(10)
  .superRefine((items, ctx) => {
    const categoryIds = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (categoryIds.has(item.ticketCategoryId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'ticketCategoryId'],
          message: 'Kategori tiket tidak boleh diduplikasi',
        });
      }
      categoryIds.add(item.ticketCategoryId);
    }
  });

const orderFields = {
  eventId: z.string().uuid(),
  items: orderItemsSchema,
  voucherCode: z.string().trim().min(1).max(64).optional(),
  pointsToUse: z.number().int().min(0).default(0),
};

const memberBuyerSchema = z
  .object({
    email: z.string().trim().email().toLowerCase().optional(),
    phone: phoneSchema.optional(),
  })
  .optional();

export const memberOrderSchema = z.object({
  ...orderFields,
  buyer: memberBuyerSchema,
});

export const guestOrderSchema = z.object({
  ...orderFields,
  buyer: z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().toLowerCase(),
    phone: phoneSchema,
  }),
});

export type CreateOrderInput =
  | z.infer<typeof memberOrderSchema>
  | z.infer<typeof guestOrderSchema>;
