import {
  DiscountType,
  EventStatus,
  OrderStatus,
  PointType,
  Prisma,
  RoleName,
  UserStatus,
} from '@prisma/client';
import { nanoid } from 'nanoid';
import {
  MAX_POINT_DISCOUNT_RATIO,
  ORDER_EXPIRY_MINUTES,
  POINT_EARN_PER_RUPIAH,
  POINT_VALUE_RUPIAH,
} from '../../config/constants';
import { prisma } from '../../lib/prisma';
import type { AuthenticatedUser } from '../../types/auth';
import { AppError } from '../../utils/app-error';
import type { CreateOrderInput } from './orders.schemas';

const MAX_ORDER_AMOUNT = 2_147_483_647;

type LockedEvent = {
  id: string;
  status: EventStatus;
  deletedAt: Date | null;
};

type LockedCategory = {
  id: string;
  name: string;
  price: number;
  maxPerOrder: number;
  saleStartAt: Date | null;
  saleEndAt: Date | null;
  quota: number;
  sold: number;
  reserved: number;
};

type OrderVoucher = {
  id: string;
  memberOnly: boolean;
  discountType: DiscountType;
  discountValue: number;
  maxDiscount: number | null;
  minPurchase: number;
  quota: number | null;
  used: number;
  eventId: string | null;
  startAt: Date;
  endAt: Date;
  isActive: boolean;
};

const isUniqueConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const createOrderCode = (now: Date): string => {
  const date = now.toISOString().slice(2, 10).replace(/-/g, '');
  return `ETX-${date}-${nanoid(6).toUpperCase()}`;
};

export const computeVoucherDiscount = (
  voucher: {
    discountType: DiscountType;
    discountValue: number;
    maxDiscount: number | null;
  },
  subtotal: number,
): number => {
  if (
    voucher.discountValue < 0 ||
    (voucher.discountType === DiscountType.PERCENT &&
      voucher.discountValue > 100) ||
    (voucher.maxDiscount !== null && voucher.maxDiscount < 0)
  ) {
    throw new AppError(
      'INVALID_VOUCHER_CONFIGURATION',
      'Konfigurasi voucher tidak valid',
      500,
    );
  }

  const rawDiscount =
    voucher.discountType === DiscountType.PERCENT
      ? Math.floor((subtotal * voucher.discountValue) / 100)
      : voucher.discountValue;
  const cappedDiscount =
    voucher.maxDiscount === null
      ? rawDiscount
      : Math.min(rawDiscount, voucher.maxDiscount);
  return Math.min(subtotal, Math.max(0, cappedDiscount));
};

const reserveCategoryStock = async (
  tx: Prisma.TransactionClient,
  eventId: string,
  categoryId: string,
  quantity: number,
  now: Date,
): Promise<void> => {
  const updated = await tx.$executeRaw`
    UPDATE "ticket_categories"
    SET "reserved" = "reserved" + ${quantity}
    WHERE "id" = ${categoryId}::uuid
      AND "eventId" = ${eventId}::uuid
      AND "isActive" = true
      AND ("saleStartAt" IS NULL OR "saleStartAt" <= ${now})
      AND ("saleEndAt" IS NULL OR "saleEndAt" > ${now})
      AND "sold" + "reserved" + ${quantity} <= "quota"
  `;

  if (updated !== 1) {
    throw new AppError(
      'INSUFFICIENT_STOCK',
      'Tiket tidak mencukupi atau periode penjualan telah ditutup',
      409,
    );
  }
};

const createOrderTransaction = async (
  actor: AuthenticatedUser | undefined,
  input: CreateOrderInput,
  orderCode: string,
  accessToken: string,
) =>
  prisma.$transaction(async (tx) => {
    const now = new Date();
    const [event] = await tx.$queryRaw<LockedEvent[]>`
      SELECT "id", "status", "deletedAt"
      FROM "events"
      WHERE "id" = ${input.eventId}::uuid
      FOR SHARE
    `;
    if (
      !event ||
      event.status !== EventStatus.PUBLISHED ||
      event.deletedAt !== null
    ) {
      throw new AppError('EVENT_NOT_AVAILABLE', 'Event tidak tersedia', 409);
    }

    const member = actor
      ? await tx.user.findUnique({
          where: { id: actor.id },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            pointBalance: true,
            role: { select: { name: true } },
          },
        })
      : null;

    if (actor && !member) {
      throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 401);
    }
    if (member?.status === UserStatus.SUSPENDED) {
      throw new AppError(
        'ACCOUNT_SUSPENDED',
        'Akun Anda telah ditangguhkan',
        403,
      );
    }
    if (!actor && input.pointsToUse > 0) {
      throw new AppError(
        'MEMBER_FEATURE_REQUIRED',
        'Poin hanya dapat digunakan oleh member',
        400,
      );
    }

    let buyerName: string;
    let buyerEmail: string;
    let buyerPhone: string | null;
    if (member) {
      buyerName = member.name;
      buyerEmail = input.buyer?.email ?? member.email;
      buyerPhone = input.buyer?.phone ?? member.phone;
    } else if (input.buyer && 'name' in input.buyer) {
      buyerName = input.buyer.name;
      buyerEmail = input.buyer.email;
      buyerPhone = input.buyer.phone;
    } else {
      throw new AppError(
        'BUYER_DETAILS_REQUIRED',
        'Nama, email, dan nomor telepon wajib diisi untuk guest',
        400,
      );
    }

    if (!buyerPhone) {
      throw new AppError(
        'BUYER_PHONE_REQUIRED',
        'Nomor telepon wajib diisi',
        400,
      );
    }

    const orderedItems = [...input.items].sort((left, right) =>
      left.ticketCategoryId.localeCompare(right.ticketCategoryId),
    );

    const orderItems: Array<{
      ticketCategoryId: string;
      quantity: number;
      unitPrice: number;
      subtotal: number;
    }> = [];
    let subtotal = 0;

    for (const item of orderedItems) {
      const [category] = await tx.$queryRaw<LockedCategory[]>`
        SELECT "id", "name", "price", "maxPerOrder", "saleStartAt",
          "saleEndAt", "quota", "sold", "reserved"
        FROM "ticket_categories"
        WHERE "id" = ${item.ticketCategoryId}::uuid
          AND "eventId" = ${input.eventId}::uuid
          AND "isActive" = true
        FOR UPDATE
      `;
      if (!category) {
        throw new AppError(
          'TICKET_CATEGORY_NOT_AVAILABLE',
          'Kategori tiket tidak tersedia untuk event ini',
          409,
        );
      }
      if (item.quantity > category.maxPerOrder) {
        throw new AppError(
          'MAX_PER_ORDER_EXCEEDED',
          `Maksimal ${category.maxPerOrder} tiket untuk kategori ${category.name}`,
          400,
        );
      }
      if (
        (category.saleStartAt && now < category.saleStartAt) ||
        (category.saleEndAt && now >= category.saleEndAt)
      ) {
        throw new AppError(
          'SALE_WINDOW_CLOSED',
          `Penjualan kategori ${category.name} belum dibuka atau sudah ditutup`,
          409,
        );
      }

      const lineSubtotal = category.price * item.quantity;
      subtotal += lineSubtotal;
      if (!Number.isSafeInteger(subtotal) || subtotal > MAX_ORDER_AMOUNT) {
        throw new AppError(
          'ORDER_AMOUNT_TOO_LARGE',
          'Total order melebihi batas yang didukung',
          400,
        );
      }
      orderItems.push({
        ticketCategoryId: category.id,
        quantity: item.quantity,
        unitPrice: category.price,
        subtotal: lineSubtotal,
      });
    }

    for (const item of orderedItems) {
      await reserveCategoryStock(
        tx,
        input.eventId,
        item.ticketCategoryId,
        item.quantity,
        now,
      );
    }

    let discountAmount = 0;
    let voucher: OrderVoucher | null = null;

    if (input.voucherCode) {
      voucher = await tx.voucher.findUnique({
        where: { code: input.voucherCode.toUpperCase() },
        select: {
          id: true,
          memberOnly: true,
          discountType: true,
          discountValue: true,
          maxDiscount: true,
          minPurchase: true,
          quota: true,
          used: true,
          eventId: true,
          startAt: true,
          endAt: true,
          isActive: true,
        },
      });

      if (
        !voucher ||
        !voucher.isActive ||
        now < voucher.startAt ||
        now >= voucher.endAt ||
        (voucher.quota !== null && voucher.used >= voucher.quota) ||
        (voucher.eventId !== null && voucher.eventId !== input.eventId)
      ) {
        throw new AppError(
          'VOUCHER_UNAVAILABLE',
          'Voucher tidak tersedia atau tidak berlaku untuk event ini',
          400,
        );
      }
      if (voucher.memberOnly && !member) {
        throw new AppError(
          'MEMBER_VOUCHER_REQUIRED',
          'Voucher ini hanya dapat digunakan oleh member',
          400,
        );
      }
      if (subtotal < voucher.minPurchase) {
        throw new AppError(
          'VOUCHER_MIN_PURCHASE_NOT_MET',
          'Subtotal belum memenuhi minimal pembelian voucher',
          400,
        );
      }

      discountAmount = computeVoucherDiscount(voucher, subtotal);
      const updated = await tx.$executeRaw`
        UPDATE "vouchers"
        SET "used" = "used" + 1
        WHERE "id" = ${voucher.id}::uuid
          AND "isActive" = true
          AND "startAt" <= ${now}
          AND "endAt" > ${now}
          AND ("quota" IS NULL OR "used" < "quota")
      `;
      if (updated !== 1) {
        throw new AppError(
          'VOUCHER_UNAVAILABLE',
          'Kuota voucher baru saja habis',
          409,
        );
      }
    }

    const pointsToUse = input.pointsToUse;
    if (pointsToUse > 0) {
      if (!member || member.role.name !== RoleName.CUSTOMER) {
        throw new AppError(
          'POINTS_NOT_AVAILABLE',
          'Poin hanya dapat digunakan oleh member CUSTOMER',
          403,
        );
      }
      if (pointsToUse > member.pointBalance) {
        throw new AppError('INSUFFICIENT_POINTS', 'Saldo poin tidak mencukupi', 400);
      }
      const maxPoints = Math.floor(
        (subtotal * MAX_POINT_DISCOUNT_RATIO) / POINT_VALUE_RUPIAH,
      );
      if (pointsToUse > maxPoints) {
        throw new AppError(
          'POINT_DISCOUNT_LIMIT_EXCEEDED',
          'Diskon poin maksimal 50% dari subtotal',
          400,
        );
      }
      if (pointsToUse * POINT_VALUE_RUPIAH > subtotal - discountAmount) {
        throw new AppError(
          'POINTS_EXCEED_REMAINING_TOTAL',
          'Poin melebihi sisa total setelah voucher',
          400,
        );
      }

      const debited = await tx.user.updateMany({
        where: { id: member.id, pointBalance: { gte: pointsToUse } },
        data: { pointBalance: { decrement: pointsToUse } },
      });
      if (debited.count !== 1) {
        throw new AppError('INSUFFICIENT_POINTS', 'Saldo poin tidak mencukupi', 400);
      }
    }

    const totalAmount = Math.max(
      0,
      subtotal - discountAmount - pointsToUse * POINT_VALUE_RUPIAH,
    );
    if (totalAmount === 0) {
      throw new AppError(
        'ZERO_TOTAL_UNSUPPORTED',
        'Order tanpa pembayaran belum didukung; sesuaikan voucher atau poin',
        400,
      );
    }

    const expiresAt = new Date(
      now.getTime() + ORDER_EXPIRY_MINUTES * 60 * 1000,
    );
    const order = await tx.order.create({
      data: {
        orderCode,
        accessToken,
        userId: member?.id ?? null,
        eventId: input.eventId,
        buyerName,
        buyerEmail,
        buyerPhone,
        subtotal,
        discountAmount,
        pointsUsed: pointsToUse,
        totalAmount,
        expiresAt,
      },
      select: {
        id: true,
        orderCode: true,
        accessToken: true,
        totalAmount: true,
        expiresAt: true,
      },
    });

    await tx.orderItem.createMany({
      data: orderItems.map((item) => ({ ...item, orderId: order.id })),
    });

    if (pointsToUse > 0 && member) {
      const updatedMember = await tx.user.findUniqueOrThrow({
        where: { id: member.id },
        select: { pointBalance: true },
      });
      await tx.pointTransaction.create({
        data: {
          userId: member.id,
          orderId: order.id,
          type: PointType.REDEEM,
          points: -pointsToUse,
          balanceAfter: updatedMember.pointBalance,
          note: `Penukaran poin untuk order ${order.orderCode}`,
        },
      });
    }

    if (voucher) {
      await tx.voucherRedemption.create({
        data: {
          voucherId: voucher.id,
          orderId: order.id,
          userId: member?.id ?? null,
        },
      });
    }

    return {
      orderCode: order.orderCode,
      accessToken: order.accessToken,
      subtotal,
      discountAmount,
      pointsUsed: pointsToUse,
      totalAmount: order.totalAmount,
      expiresAt: order.expiresAt,
    };
  });

export const ordersService = {
  async create(actor: AuthenticatedUser | undefined, input: CreateOrderInput) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const now = new Date();
        return await createOrderTransaction(
          actor,
          input,
          createOrderCode(now),
          nanoid(32),
        );
      } catch (error) {
        if (!isUniqueConflict(error) || attempt === 4) {
          if (isUniqueConflict(error)) {
            throw new AppError(
              'ORDER_CODE_CONFLICT',
              'Tidak dapat membuat kode order unik',
              409,
            );
          }
          throw error;
        }
      }
    }

    throw new AppError('ORDER_CODE_CONFLICT', 'Tidak dapat membuat kode order unik', 409);
  },
};

type PendingOrderResources = {
  id: string;
  orderCode: string;
  userId: string | null;
  pointsUsed: number;
  totalAmount?: number;
  items: Array<{ ticketCategoryId: string; quantity: number }>;
  voucherRedemption: { voucherId: string } | null;
};

export const releaseOrderResources = async (
  tx: Prisma.TransactionClient,
  order: PendingOrderResources,
): Promise<void> => {
  for (const item of order.items) {
    const released = await tx.ticketCategory.updateMany({
      where: {
        id: item.ticketCategoryId,
        reserved: { gte: item.quantity },
      },
      data: { reserved: { decrement: item.quantity } },
    });
    if (released.count !== 1) {
      throw new AppError(
        'RESERVATION_INCONSISTENT',
        `Reservasi stok untuk order ${order.orderCode} tidak konsisten`,
        500,
      );
    }
  }

  if (order.pointsUsed > 0 && order.userId) {
    const user = await tx.user.update({
      where: { id: order.userId },
      data: { pointBalance: { increment: order.pointsUsed } },
      select: { pointBalance: true },
    });
    await tx.pointTransaction.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        type: PointType.REFUND,
        points: order.pointsUsed,
        balanceAfter: user.pointBalance,
        note: `Pengembalian poin untuk order ${order.orderCode}`,
      },
    });
  }

  if (order.voucherRedemption) {
    await tx.voucherRedemption.delete({
      where: { orderId: order.id },
    });
    const voucher = await tx.voucher.updateMany({
      where: {
        id: order.voucherRedemption.voucherId,
        used: { gt: 0 },
      },
      data: { used: { decrement: 1 } },
    });
    if (voucher.count !== 1) {
      throw new AppError(
        'VOUCHER_USAGE_INCONSISTENT',
        `Pemakaian voucher untuk order ${order.orderCode} tidak konsisten`,
        500,
      );
    }
  }
};

export const completeOrderPayment = async (
  tx: Prisma.TransactionClient,
  order: PendingOrderResources & { totalAmount: number },
): Promise<void> => {
  for (const item of order.items) {
    const completed = await tx.ticketCategory.updateMany({
      where: {
        id: item.ticketCategoryId,
        reserved: { gte: item.quantity },
      },
      data: {
        reserved: { decrement: item.quantity },
        sold: { increment: item.quantity },
      },
    });
    if (completed.count !== 1) {
      throw new AppError(
        'RESERVATION_INCONSISTENT',
        `Reservasi stok untuk order ${order.orderCode} tidak konsisten`,
        500,
      );
    }
  }

  if (!order.userId) return;
  const member = await tx.user.findUnique({
    where: { id: order.userId },
    select: { role: { select: { name: true } } },
  });
  if (member?.role.name !== RoleName.CUSTOMER) return;

  const pointsEarned = Math.floor(
    order.totalAmount / POINT_EARN_PER_RUPIAH,
  );
  if (pointsEarned === 0) return;

  const user = await tx.user.update({
    where: { id: order.userId },
    data: { pointBalance: { increment: pointsEarned } },
    select: { pointBalance: true },
  });
  await tx.order.update({
    where: { id: order.id },
    data: { pointsEarned },
  });
  await tx.pointTransaction.create({
    data: {
      userId: order.userId,
      orderId: order.id,
      type: PointType.EARN,
      points: pointsEarned,
      balanceAfter: user.pointBalance,
      note: `Poin dari order ${order.orderCode}`,
    },
  });
};

export const expirePendingOrders = async (now = new Date()): Promise<number> => {
  const expiredCandidates = await prisma.order.findMany({
    where: { status: OrderStatus.PENDING, expiresAt: { lt: now } },
    select: { id: true },
    orderBy: { expiresAt: 'asc' },
    take: 100,
  });

  let expiredCount = 0;
  for (const candidate of expiredCandidates) {
    const expired = await prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({
        where: {
          id: candidate.id,
          status: OrderStatus.PENDING,
          expiresAt: { lt: now },
        },
        data: { status: OrderStatus.EXPIRED },
      });
      if (changed.count !== 1) return false;

      const order = await tx.order.findUniqueOrThrow({
        where: { id: candidate.id },
        include: {
          items: true,
          voucherRedemption: true,
        },
      });

      await releaseOrderResources(tx, order);

      return true;
    });

    if (expired) expiredCount += 1;
  }

  return expiredCount;
};
