import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import {
  getEffectivePaymentStatus,
  getPaymentAction,
  resolveMidtransOutcome,
  verifyMidtransSignature,
} from '../src/modules/payments/payments.logic';
import { midtransNotificationSchema } from '../src/modules/payments/payments.schemas';

const serverKey = 'midtrans-test-server-key';

const createNotification = (
  transactionStatus: string,
  fraudStatus?: string,
) => {
  const data = {
    order_id: 'ETX-261114-ABC123-1',
    status_code: '200',
    gross_amount: '125000.00',
    transaction_status: transactionStatus,
    ...(fraudStatus ? { fraud_status: fraudStatus } : {}),
  };
  const signature = crypto
    .createHash('sha512')
    .update(
      data.order_id + data.status_code + data.gross_amount + serverKey,
    )
    .digest('hex');
  return midtransNotificationSchema.parse({
    ...data,
    signature_key: signature,
  });
};

test('Midtrans signature accepts only the signed notification contents', () => {
  const notification = createNotification('settlement');
  assert.equal(verifyMidtransSignature(notification, serverKey), true);

  assert.equal(
    verifyMidtransSignature(
      { ...notification, status_code: '201' },
      serverKey,
    ),
    false,
  );
});

test('Midtrans status mapping waits for accepted capture and handles failures', () => {
  assert.deepEqual(resolveMidtransOutcome(createNotification('settlement')), {
    paymentStatus: PaymentStatus.SETTLEMENT,
    orderStatus: OrderStatus.PAID,
    settled: true,
  });
  assert.deepEqual(
    resolveMidtransOutcome(createNotification('capture', 'challenge')),
    { paymentStatus: PaymentStatus.PENDING, settled: false },
  );
  assert.deepEqual(resolveMidtransOutcome(createNotification('deny')), {
    paymentStatus: PaymentStatus.DENIED,
    orderStatus: OrderStatus.FAILED,
    settled: false,
  });
});

test('settlement is not applied twice or to an expired order', () => {
  const settled = resolveMidtransOutcome(createNotification('settlement'));
  assert.equal(
    getPaymentAction(OrderStatus.PENDING, settled),
    'COMPLETE',
  );
  assert.equal(getPaymentAction(OrderStatus.PAID, settled), 'RECORD_ONLY');
  assert.equal(
    getPaymentAction(OrderStatus.EXPIRED, settled),
    'RECORD_ONLY',
  );
  assert.equal(
    getEffectivePaymentStatus(PaymentStatus.SETTLEMENT, PaymentStatus.PENDING),
    PaymentStatus.SETTLEMENT,
  );
  assert.equal(
    getEffectivePaymentStatus(PaymentStatus.FAILED, PaymentStatus.SETTLEMENT),
    PaymentStatus.SETTLEMENT,
  );
  assert.equal(
    getEffectivePaymentStatus(PaymentStatus.FAILED, PaymentStatus.PENDING),
    PaymentStatus.FAILED,
  );
});
