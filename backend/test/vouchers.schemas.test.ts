import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiscountType } from '@prisma/client';
import {
  createVoucherSchema,
  validateVoucherSchema,
} from '../src/modules/vouchers/vouchers.schemas';

const eventId = '00000000-0000-4000-8000-000000000001';
const categoryId = '00000000-0000-4000-8000-000000000002';

test('voucher creation rejects invalid percentage and time ranges', () => {
  const validVoucher = {
    code: 'SAVE10',
    discountType: DiscountType.PERCENT,
    discountValue: 10,
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-02-01T00:00:00.000Z',
  };
  assert.throws(() =>
    createVoucherSchema.parse({ ...validVoucher, discountValue: 101 }),
  );
  assert.throws(() =>
    createVoucherSchema.parse({
      ...validVoucher,
      endAt: '2025-12-01T00:00:00.000Z',
    }),
  );
  assert.doesNotThrow(() => createVoucherSchema.parse(validVoucher));
});

test('voucher validation rejects duplicate ticket categories', () => {
  assert.throws(() =>
    validateVoucherSchema.parse({
      eventId,
      voucherCode: 'SAVE10',
      items: [
        { ticketCategoryId: categoryId, quantity: 1 },
        { ticketCategoryId: categoryId, quantity: 2 },
      ],
    }),
  );
});
