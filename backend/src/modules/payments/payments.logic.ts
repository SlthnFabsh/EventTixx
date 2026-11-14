import { OrderStatus, PaymentStatus } from '@prisma/client';
import crypto from 'node:crypto';
import type { MidtransTransactionStatus } from 'midtrans-client';
import type { MidtransNotification } from './payments.schemas';

export type PaymentOutcome = {
  paymentStatus: PaymentStatus;
  orderStatus?: OrderStatus;
  settled: boolean;
};

export type PaymentAction = 'COMPLETE' | 'RELEASE' | 'RECORD_ONLY';

export const verifyMidtransSignature = (
  notification: MidtransNotification,
  serverKey: string,
): boolean => {
  const expected = crypto
    .createHash('sha512')
    .update(
      notification.order_id +
        notification.status_code +
        String(notification.gross_amount) +
        serverKey,
    )
    .digest();
  const received = Buffer.from(notification.signature_key, 'hex');

  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(expected, received)
  );
};

export const resolveMidtransOutcome = (
  notification: MidtransNotification | MidtransTransactionStatus,
): PaymentOutcome => {
  switch (notification.transaction_status) {
    case 'settlement':
      return {
        paymentStatus: PaymentStatus.SETTLEMENT,
        orderStatus: OrderStatus.PAID,
        settled: true,
      };
    case 'capture':
      if (notification.fraud_status === 'accept') {
        return {
          paymentStatus: PaymentStatus.SETTLEMENT,
          orderStatus: OrderStatus.PAID,
          settled: true,
        };
      }
      return {
        paymentStatus: PaymentStatus.PENDING,
        settled: false,
      };
    case 'pending':
      return { paymentStatus: PaymentStatus.PENDING, settled: false };
    case 'deny':
      return {
        paymentStatus: PaymentStatus.DENIED,
        orderStatus: OrderStatus.FAILED,
        settled: false,
      };
    case 'failure':
      return {
        paymentStatus: PaymentStatus.FAILED,
        orderStatus: OrderStatus.FAILED,
        settled: false,
      };
    case 'cancel':
      return {
        paymentStatus: PaymentStatus.CANCELLED,
        orderStatus: OrderStatus.CANCELLED,
        settled: false,
      };
    case 'expire':
      return {
        paymentStatus: PaymentStatus.EXPIRED,
        orderStatus: OrderStatus.EXPIRED,
        settled: false,
      };
    default:
      return { paymentStatus: PaymentStatus.PENDING, settled: false };
  }
};

export const getPaymentAction = (
  orderStatus: OrderStatus,
  outcome: PaymentOutcome,
): PaymentAction => {
  if (orderStatus !== OrderStatus.PENDING || !outcome.orderStatus) {
    return 'RECORD_ONLY';
  }
  return outcome.settled ? 'COMPLETE' : 'RELEASE';
};

export const getEffectivePaymentStatus = (
  current: PaymentStatus,
  incoming: PaymentStatus,
): PaymentStatus => {
  if (current === PaymentStatus.SETTLEMENT) return current;
  if (incoming === PaymentStatus.SETTLEMENT) return incoming;
  if (current !== PaymentStatus.PENDING) return current;
  return incoming;
};
