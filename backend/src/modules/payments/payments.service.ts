import crypto from 'node:crypto';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import midtransClient, {
  type MidtransTransactionStatus,
} from 'midtrans-client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import type { AuthenticatedUser } from '../../types/auth';
import { AppError } from '../../utils/app-error';
import {
  completeOrderPayment,
  releaseOrderResources,
} from '../orders/orders.service';
import {
  getEffectivePaymentStatus,
  getPaymentAction,
  resolveMidtransOutcome,
  verifyMidtransSignature,
} from './payments.logic';
import type { MidtransNotification } from './payments.schemas';

const isValidAccessToken = (expected: string, actual?: string): boolean => {
  if (!actual) return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
};

const assertOrderAccess = (
  order: { userId: string | null; accessToken: string },
  actor: AuthenticatedUser | undefined,
  accessToken?: string,
): void => {
  if (
    actor?.id === order.userId ||
    isValidAccessToken(order.accessToken, accessToken)
  ) {
    return;
  }
  throw new AppError(
    'ORDER_ACCESS_DENIED',
    'Anda tidak memiliki akses ke order ini',
    403,
  );
};

const createSnapClient = (): midtransClient.Snap => {
  if (!env.MIDTRANS_SERVER_KEY || !env.MIDTRANS_CLIENT_KEY) {
    throw new AppError(
      'PAYMENT_NOT_CONFIGURED',
      'Kredensial Midtrans belum dikonfigurasi',
      503,
    );
  }

  return new midtransClient.Snap({
    isProduction: env.MIDTRANS_IS_PRODUCTION,
    serverKey: env.MIDTRANS_SERVER_KEY,
    clientKey: env.MIDTRANS_CLIENT_KEY,
  });
};

const notificationAsJson = (
  notification: MidtransNotification | MidtransTransactionStatus,
): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(notification)) as Prisma.InputJsonValue;

export const paymentsService = {
  async createSnapTransaction(
    actor: AuthenticatedUser | undefined,
    orderCode: string,
    accessToken?: string,
  ) {
    const snap = createSnapClient();
    const prepared = await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "orders"
        WHERE "orderCode" = ${orderCode}
        FOR UPDATE
      `;
      if (!locked) {
        throw new AppError('ORDER_NOT_FOUND', 'Order tidak ditemukan', 404);
      }

      const order = await tx.order.findUniqueOrThrow({
        where: { id: locked.id },
        include: {
          items: {
            include: { ticketCategory: { select: { name: true } } },
          },
        },
      });
      assertOrderAccess(order, actor, accessToken);

      const now = new Date();
      if (order.status !== OrderStatus.PENDING || order.expiresAt <= now) {
        throw new AppError(
          'ORDER_NOT_PAYABLE',
          'Order tidak lagi menunggu pembayaran atau sudah kedaluwarsa',
          409,
        );
      }

      const existing = await tx.payment.findFirst({
        where: { orderId: order.id, status: PaymentStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });
      if (existing?.snapToken && existing.redirectUrl) {
        return { order, payment: existing, isExisting: true };
      }
      if (existing) {
        throw new AppError(
          'PAYMENT_IN_PROGRESS',
          'Transaksi pembayaran sedang diproses',
          409,
        );
      }

      const attempt =
        (await tx.payment.count({ where: { orderId: order.id } })) + 1;
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          midtransOrderId: `${order.orderCode}-${attempt}`,
          grossAmount: order.totalAmount,
        },
      });

      return { order, payment, isExisting: false };
    });

    if (prepared.isExisting) {
      return {
        midtransOrderId: prepared.payment.midtransOrderId,
        snapToken: prepared.payment.snapToken,
        redirectUrl: prepared.payment.redirectUrl,
      };
    }

    const minutesLeft = Math.max(
      1,
      Math.ceil((prepared.order.expiresAt.getTime() - Date.now()) / 60_000),
    );

    try {
      const transaction = await snap.createTransaction({
        transaction_details: {
          order_id: prepared.payment.midtransOrderId,
          gross_amount: prepared.order.totalAmount,
        },
        customer_details: {
          first_name: prepared.order.buyerName,
          email: prepared.order.buyerEmail,
          phone: prepared.order.buyerPhone,
        },
        item_details: [
          {
            id: prepared.order.orderCode,
            price: prepared.order.totalAmount,
            quantity: 1,
            name: `EventTixx ${prepared.order.orderCode}`.slice(0, 50),
          },
        ],
        expiry: { unit: 'minutes', duration: minutesLeft },
        callbacks: {
          finish: `${env.APP_URL}/orders/${encodeURIComponent(prepared.order.orderCode)}?token=${encodeURIComponent(prepared.order.accessToken)}`,
        },
      });

      if (
        typeof transaction.token !== 'string' ||
        typeof transaction.redirect_url !== 'string'
      ) {
        throw new Error('Midtrans response missing Snap token or redirect URL');
      }

      const payment = await prisma.payment.update({
        where: { id: prepared.payment.id },
        data: {
          snapToken: transaction.token,
          redirectUrl: transaction.redirect_url,
        },
      });
      return {
        midtransOrderId: payment.midtransOrderId,
        snapToken: payment.snapToken,
        redirectUrl: payment.redirectUrl,
      };
    } catch (error) {
      await prisma.payment.updateMany({
        where: {
          id: prepared.payment.id,
          status: PaymentStatus.PENDING,
          snapToken: null,
        },
        data: { status: PaymentStatus.FAILED },
      });
      console.error(
        `Midtrans transaction creation failed for ${prepared.order.orderCode}:`,
        error instanceof Error ? error.name : 'Unknown error',
      );
      if (error instanceof AppError) throw error;
      throw new AppError(
        'MIDTRANS_UNAVAILABLE',
        'Tidak dapat membuat transaksi pembayaran saat ini',
        502,
      );
    }
  },

  async handleWebhook(notification: MidtransNotification) {
    if (!env.MIDTRANS_SERVER_KEY) {
      throw new AppError(
        'PAYMENT_NOT_CONFIGURED',
        'Kredensial Midtrans belum dikonfigurasi',
        503,
      );
    }
    if (
      !verifyMidtransSignature(notification, env.MIDTRANS_SERVER_KEY)
    ) {
      throw new AppError(
        'MIDTRANS_SIGNATURE_INVALID',
        'Signature notifikasi Midtrans tidak valid',
        403,
      );
    }
    try {
      return await this.handleMidtransStatus(notification);
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === 'PAYMENT_NOT_FOUND' ||
          error.code === 'PAYMENT_AMOUNT_MISMATCH')
      ) {
        if (error.code === 'PAYMENT_AMOUNT_MISMATCH') {
          const payment = await prisma.payment.findUnique({
            where: { midtransOrderId: notification.order_id },
            select: { id: true },
          });
          if (payment) {
            await prisma.payment.update({
              where: { id: payment.id },
              data: { rawNotification: notificationAsJson(notification) },
            });
          }
        }
        await prisma.auditLog.create({
          data: {
            action: 'MIDTRANS_NOTIFICATION_REQUIRES_RECONCILIATION',
            entity: 'payment',
            metadata: {
              orderId: notification.order_id,
              grossAmount: String(notification.gross_amount),
              reason: error.code,
              notification: notificationAsJson(notification),
            },
          },
        });
        console.error(
          `Signed Midtrans notification requires reconciliation for ${notification.order_id}: ${error.code}`,
        );
        return { accepted: true, reconciliationRequired: true };
      }
      throw error;
    }
  },

  async handleMidtransStatus(
    notification: MidtransNotification | MidtransTransactionStatus,
  ) {
    const payment = await prisma.payment.findUnique({
      where: { midtransOrderId: notification.order_id },
    });
    if (!payment) {
      throw new AppError(
        'PAYMENT_NOT_FOUND',
        'Transaksi pembayaran tidak ditemukan',
        404,
      );
    }

    const amount = Number(notification.gross_amount);
    if (!Number.isSafeInteger(amount) || amount !== payment.grossAmount) {
      throw new AppError(
        'PAYMENT_AMOUNT_MISMATCH',
        'Jumlah pembayaran tidak sesuai dengan order',
        400,
      );
    }

    const outcome = resolveMidtransOutcome(notification);
    const rawNotification = notificationAsJson(notification);

    return prisma.$transaction(async (tx) => {
      const currentPayment = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      const [lockedOrder] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "orders"
        WHERE "id" = ${payment.orderId}::uuid
        FOR UPDATE
      `;
      if (!lockedOrder) {
        throw new AppError('ORDER_NOT_FOUND', 'Order tidak ditemukan', 404);
      }

      const order = await tx.order.findUniqueOrThrow({
        where: { id: payment.orderId },
        include: {
          items: true,
          voucherRedemption: true,
        },
      });
      const now = new Date();
      const paymentStatus = getEffectivePaymentStatus(
        currentPayment.status,
        outcome.paymentStatus,
      );
      const action = getPaymentAction(order.status, outcome);
      const paidAt = outcome.settled
        ? currentPayment.paidAt ?? now
        : undefined;

      if (
        outcome.settled &&
        action === 'RECORD_ONLY' &&
        order.status !== OrderStatus.PAID &&
        currentPayment.status !== PaymentStatus.SETTLEMENT
      ) {
        await tx.auditLog.create({
          data: {
            action: 'LATE_PAYMENT_REQUIRES_RECONCILIATION',
            entity: 'order',
            entityId: order.id,
            metadata: {
              orderCode: order.orderCode,
              midtransOrderId: notification.order_id,
              orderStatus: order.status,
            },
          },
        });
      }

      if (action !== 'RECORD_ONLY' && outcome.orderStatus) {
        const changed = await tx.order.updateMany({
          where: { id: order.id, status: OrderStatus.PENDING },
          data: {
            status: outcome.orderStatus,
            ...(outcome.settled ? { paidAt: now } : {}),
          },
        });

        if (changed.count === 1) {
          if (outcome.settled) {
            await completeOrderPayment(tx, {
              ...order,
              totalAmount: order.totalAmount,
            });
          } else {
            await releaseOrderResources(tx, order);
          }
        }
      } else if (order.status === OrderStatus.PAID && outcome.settled) {
        if (currentPayment.status !== PaymentStatus.SETTLEMENT) {
          await tx.auditLog.create({
            data: {
              action: 'DUPLICATE_SETTLEMENT_REQUIRES_RECONCILIATION',
              entity: 'order',
              entityId: order.id,
              metadata: {
                orderCode: order.orderCode,
                midtransOrderId: notification.order_id,
              },
            },
          });
        }
      }

      await tx.payment.update({
        where: { id: currentPayment.id },
        data: {
          status: paymentStatus,
          ...(notification.payment_type
            ? { paymentType: notification.payment_type }
            : {}),
          ...(notification.transaction_id
            ? { transactionId: notification.transaction_id }
            : {}),
          ...(notification.fraud_status
            ? { fraudStatus: notification.fraud_status }
            : {}),
          rawNotification,
          ...(paidAt ? { paidAt } : {}),
        },
      });

      return {
        orderCode: order.orderCode,
        orderStatus: outcome.settled && order.status === OrderStatus.PENDING
          ? OrderStatus.PAID
          : outcome.orderStatus && order.status === OrderStatus.PENDING
            ? outcome.orderStatus
            : order.status,
        paymentStatus,
      };
    });
  },

  async syncOrderStatus(
    actor: AuthenticatedUser | undefined,
    orderCode: string,
    accessToken?: string,
  ) {
    const order = await prisma.order.findUnique({
      where: { orderCode },
      include: {
        payments: {
          where: { status: PaymentStatus.PENDING },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Order tidak ditemukan', 404);
    }
    assertOrderAccess(order, actor, accessToken);

    const payment = order.payments[0];
    if (!payment) {
      return { orderCode, orderStatus: order.status };
    }

    const snap = createSnapClient();
    const response = await snap.transaction.status(payment.midtransOrderId);
    if (response.order_id !== payment.midtransOrderId) {
      throw new AppError(
        'MIDTRANS_ORDER_MISMATCH',
        'Order ID dari Midtrans tidak sesuai',
        502,
      );
    }

    return this.handleMidtransStatus(response);
  },
};
