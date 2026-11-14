import { z } from 'zod';

export const midtransNotificationSchema = z
  .object({
    order_id: z.string().min(1),
    status_code: z.string().min(1),
    gross_amount: z.union([
      z.string().regex(/^\d+(?:\.\d{1,2})?$/),
      z.number().finite().nonnegative(),
    ]),
    signature_key: z.string().regex(/^[a-fA-F0-9]{128}$/),
    transaction_status: z.string().min(1),
    fraud_status: z.string().optional(),
    payment_type: z.string().optional(),
    transaction_id: z.string().optional(),
  })
  .passthrough();

export type MidtransNotification = z.infer<
  typeof midtransNotificationSchema
>;
