import { DiscountType } from '@prisma/client';
import { z } from 'zod';

const voucherFields = {
  code: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/),
  description: z.string().trim().max(500).nullable().optional(),
  discountType: z.nativeEnum(DiscountType),
  discountValue: z.number().int().positive(),
  maxDiscount: z.number().int().nonnegative().nullable().optional(),
  minPurchase: z.number().int().nonnegative().default(0),
  quota: z.number().int().positive().nullable().optional(),
  memberOnly: z.boolean().default(false),
  eventId: z.string().uuid().nullable().optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  isActive: z.boolean().default(true),
};

const validateDiscount = (
  value: { discountType?: DiscountType; discountValue?: number },
  context: z.RefinementCtx,
) => {
  if (
    value.discountType === DiscountType.PERCENT &&
    value.discountValue !== undefined &&
    value.discountValue > 100
  ) {
    context.addIssue({
      code: 'custom',
      path: ['discountValue'],
      message: 'Diskon persentase maksimal 100',
    });
  }
};

export const createVoucherSchema = z
  .object(voucherFields)
  .superRefine((voucher, context) => {
    if (voucher.endAt <= voucher.startAt) {
      context.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'Waktu akhir harus setelah waktu mulai',
      });
    }
    validateDiscount(voucher, context);
  });

export const updateVoucherSchema = z
  .object(voucherFields)
  .partial()
  .superRefine((voucher, context) => validateDiscount(voucher, context));

export const voucherIdParamsSchema = z.object({
  voucherId: z.string().uuid(),
});

export const voucherListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  eventId: z.string().uuid().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const validateVoucherSchema = z
  .object({
    eventId: z.string().uuid(),
    voucherCode: z.string().trim().min(3).max(32),
    items: z
      .array(
        z.object({
          ticketCategoryId: z.string().uuid(),
          quantity: z.number().int().min(1).max(100),
        }),
      )
      .min(1)
      .max(10),
  })
  .superRefine((input, context) => {
    const categoryIds = new Set<string>();
    for (const [index, item] of input.items.entries()) {
      if (categoryIds.has(item.ticketCategoryId)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'ticketCategoryId'],
          message: 'Kategori tiket tidak boleh diduplikasi',
        });
      }
      categoryIds.add(item.ticketCategoryId);
    }
  });

export type CreateVoucherInput = z.infer<typeof createVoucherSchema>;
export type UpdateVoucherInput = z.infer<typeof updateVoucherSchema>;
export type ValidateVoucherInput = z.infer<typeof validateVoucherSchema>;
