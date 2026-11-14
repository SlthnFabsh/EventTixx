import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiscountType } from '@prisma/client';
import {
  guestOrderSchema,
  memberOrderSchema,
} from '../src/modules/orders/orders.schemas';
import { computeVoucherDiscount } from '../src/modules/orders/orders.service';

const eventId = '00000000-0000-4000-8000-000000000001';
const categoryId = '00000000-0000-4000-8000-000000000002';

test('guest checkout requires buyer details and defaults points to zero', () => {
  const input = {
    eventId,
    items: [{ ticketCategoryId: categoryId, quantity: 1 }],
    buyer: {
      name: 'Budi',
      email: 'budi@example.com',
      phone: '08123456789',
    },
  };

  assert.equal(guestOrderSchema.parse(input).pointsToUse, 0);
  assert.throws(() => guestOrderSchema.parse({ eventId, items: input.items }));
});

test('member checkout can omit buyer overrides and duplicate categories are rejected', () => {
  assert.equal(
    memberOrderSchema.parse({
      eventId,
      items: [{ ticketCategoryId: categoryId, quantity: 1 }],
    }).pointsToUse,
    0,
  );
  assert.throws(() =>
    memberOrderSchema.parse({
      eventId,
      items: [
        { ticketCategoryId: categoryId, quantity: 1 },
        { ticketCategoryId: categoryId, quantity: 1 },
      ],
    }),
  );
});

test('voucher discount uses server-side percentage and fixed caps', () => {
  assert.equal(
    computeVoucherDiscount(
      {
        discountType: DiscountType.PERCENT,
        discountValue: 10,
        maxDiscount: 50,
      },
      1_000,
    ),
    50,
  );
  assert.equal(
    computeVoucherDiscount(
      {
        discountType: DiscountType.FIXED,
        discountValue: 1_500,
        maxDiscount: null,
      },
      1_000,
    ),
    1_000,
  );
});
