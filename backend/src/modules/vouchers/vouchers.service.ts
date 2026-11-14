import {
  DiscountType,
  EventStatus,
  Prisma,
  RoleName,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { AuthenticatedUser } from '../../types/auth';
import { AppError } from '../../utils/app-error';
import { computeVoucherDiscount } from '../orders/orders.service';
import type {
  CreateVoucherInput,
  UpdateVoucherInput,
  ValidateVoucherInput,
} from './vouchers.schemas';

type VoucherRecord = Prisma.VoucherGetPayload<{}>;
const MAX_ORDER_AMOUNT = 2_147_483_647;

const ownershipFilter = (actor: AuthenticatedUser): Prisma.VoucherWhereInput =>
  actor.role === RoleName.SUPER_ADMIN ? {} : { createdById: actor.id };

const assertEventAccess = async (
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  eventId: string,
): Promise<void> => {
  const event = await tx.event.findFirst({
    where: {
      id: eventId,
      deletedAt: null,
      ...(actor.role === RoleName.SUPER_ADMIN
        ? {}
        : { createdById: actor.id }),
    },
    select: { id: true },
  });
  if (!event) {
    throw new AppError(
      'EVENT_NOT_FOUND',
      'Event tidak ditemukan atau tidak dapat dikelola',
      404,
    );
  }
};

const assertManagerVoucherScope = (
  actor: AuthenticatedUser,
  eventId: string | null | undefined,
): void => {
  if (actor.role === RoleName.EVENT_MANAGER && !eventId) {
    throw new AppError(
      'EVENT_REQUIRED',
      'Event Manager harus mengaitkan voucher dengan event miliknya',
      400,
    );
  }
};

const assertVoucherOwner: (
  actor: AuthenticatedUser,
  voucher: VoucherRecord | null,
) => asserts voucher is VoucherRecord = (actor, voucher) => {
  if (!voucher || (actor.role !== RoleName.SUPER_ADMIN && voucher.createdById !== actor.id)) {
    throw new AppError('VOUCHER_NOT_FOUND', 'Voucher tidak ditemukan', 404);
  }
};

const validateDiscountPair = (
  discountType: DiscountType,
  discountValue: number,
): void => {
  if (
    discountValue < 1 ||
    (discountType === DiscountType.PERCENT && discountValue > 100)
  ) {
    throw new AppError(
      'INVALID_VOUCHER_DISCOUNT',
      'Nilai diskon voucher tidak valid',
      400,
    );
  }
};

const auditVoucher = (
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  voucherId: string,
  code: string,
) =>
  tx.auditLog.create({
    data: {
      actorId,
      action,
      entity: 'voucher',
      entityId: voucherId,
      metadata: { code },
    },
  });

export const vouchersService = {
  async list(
    actor: AuthenticatedUser,
    input: { page: number; limit: number; eventId?: string; isActive?: boolean },
  ) {
    const where: Prisma.VoucherWhereInput = {
      ...ownershipFilter(actor),
      ...(input.eventId ? { eventId: input.eventId } : {}),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    };
    const [items, total] = await Promise.all([
      prisma.voucher.findMany({
        where,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.voucher.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  },

  async get(actor: AuthenticatedUser, voucherId: string) {
    const voucher = await prisma.voucher.findFirst({
      where: { id: voucherId, ...ownershipFilter(actor) },
    });
    if (!voucher) {
      throw new AppError('VOUCHER_NOT_FOUND', 'Voucher tidak ditemukan', 404);
    }
    return voucher;
  },

  async create(actor: AuthenticatedUser, input: CreateVoucherInput) {
    const code = input.code.toUpperCase();
    assertManagerVoucherScope(actor, input.eventId);
    validateDiscountPair(input.discountType, input.discountValue);
    if (
      input.maxDiscount !== undefined &&
      input.maxDiscount !== null &&
      input.maxDiscount < 0
    ) {
      throw new AppError(
        'INVALID_VOUCHER_DISCOUNT',
        'Batas diskon voucher tidak valid',
        400,
      );
    }

    return prisma.$transaction(async (tx) => {
      if (input.eventId) await assertEventAccess(tx, actor, input.eventId);
      const voucher = await tx.voucher.create({
        data: {
          ...input,
          code,
          eventId: input.eventId ?? null,
          createdById: actor.id,
        },
      });
      await auditVoucher(tx, actor.id, 'VOUCHER_CREATED', voucher.id, code);
      return voucher;
    });
  },

  async update(
    actor: AuthenticatedUser,
    voucherId: string,
    input: UpdateVoucherInput,
  ) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.voucher.findFirst({
        where: { id: voucherId, ...ownershipFilter(actor) },
      });
      assertVoucherOwner(actor, current);

      const eventId =
        input.eventId === undefined ? current.eventId : input.eventId;
      assertManagerVoucherScope(actor, eventId);
      if (eventId) await assertEventAccess(tx, actor, eventId);

      const startAt = input.startAt ?? current.startAt;
      const endAt = input.endAt ?? current.endAt;
      if (endAt <= startAt) {
        throw new AppError(
          'INVALID_VOUCHER_DATES',
          'Waktu akhir harus setelah waktu mulai',
          400,
        );
      }

      const discountType = input.discountType ?? current.discountType;
      const discountValue = input.discountValue ?? current.discountValue;
      validateDiscountPair(discountType, discountValue);

      if (
        input.maxDiscount !== undefined &&
        input.maxDiscount !== null &&
        input.maxDiscount < 0
      ) {
        throw new AppError(
          'INVALID_VOUCHER_DISCOUNT',
          'Batas diskon voucher tidak valid',
          400,
        );
      }
      const quota = input.quota === undefined ? current.quota : input.quota;
      if (quota !== null && quota < current.used) {
        throw new AppError(
          'VOUCHER_QUOTA_BELOW_USED',
          'Kuota voucher tidak boleh lebih kecil dari pemakaian saat ini',
          409,
        );
      }

      const data: Prisma.VoucherUpdateInput = {
        ...input,
        ...(input.code !== undefined ? { code: input.code.toUpperCase() } : {}),
        ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
      };
      const updated = await tx.voucher.update({
        where: { id: voucherId },
        data,
      });
      await auditVoucher(
        tx,
        actor.id,
        'VOUCHER_UPDATED',
        updated.id,
        updated.code,
      );
      return updated;
    });
  },

  async deactivate(actor: AuthenticatedUser, voucherId: string) {
    return prisma.$transaction(async (tx) => {
      const voucher = await tx.voucher.findFirst({
        where: { id: voucherId, ...ownershipFilter(actor) },
      });
      assertVoucherOwner(actor, voucher);
      const updated = await tx.voucher.update({
        where: { id: voucherId },
        data: { isActive: false },
      });
      await auditVoucher(
        tx,
        actor.id,
        'VOUCHER_DEACTIVATED',
        voucher.id,
        voucher.code,
      );
      return updated;
    });
  },

  async validate(actor: AuthenticatedUser | undefined, input: ValidateVoucherInput) {
    const event = await prisma.event.findFirst({
      where: {
        id: input.eventId,
        status: EventStatus.PUBLISHED,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!event) {
      throw new AppError('EVENT_NOT_AVAILABLE', 'Event tidak tersedia', 409);
    }

    const categoryIds = input.items.map((item) => item.ticketCategoryId);
    if (new Set(categoryIds).size !== categoryIds.length) {
      throw new AppError(
        'DUPLICATE_CATEGORY',
        'Kategori tiket tidak boleh diduplikasi',
        400,
      );
    }

    const now = new Date();
    const categories = await prisma.ticketCategory.findMany({
      where: {
        id: { in: categoryIds },
        eventId: input.eventId,
        isActive: true,
      },
    });
    if (categories.length !== input.items.length) {
      throw new AppError(
        'TICKET_CATEGORY_NOT_AVAILABLE',
        'Kategori tiket tidak tersedia untuk event ini',
        409,
      );
    }

    let subtotal = 0;
    for (const item of input.items) {
      const category = categories.find(
        (candidate) => candidate.id === item.ticketCategoryId,
      );
      if (
        !category ||
        item.quantity > category.maxPerOrder ||
        category.sold + category.reserved + item.quantity > category.quota ||
        (category.saleStartAt && now < category.saleStartAt) ||
        (category.saleEndAt && now >= category.saleEndAt)
      ) {
        throw new AppError(
          'TICKET_CATEGORY_NOT_AVAILABLE',
          'Kategori tiket tidak tersedia atau jumlahnya tidak mencukupi',
          409,
        );
      }
      subtotal += category.price * item.quantity;
      if (!Number.isSafeInteger(subtotal) || subtotal > MAX_ORDER_AMOUNT) {
        throw new AppError(
          'ORDER_AMOUNT_TOO_LARGE',
          'Total order melebihi batas yang didukung',
          400,
        );
      }
    }

    const voucher = await prisma.voucher.findUnique({
      where: { code: input.voucherCode.toUpperCase() },
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
    if (voucher.memberOnly && actor?.role !== RoleName.CUSTOMER) {
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

    const discountAmount = computeVoucherDiscount(voucher, subtotal);
    return {
      voucherCode: voucher.code,
      subtotal,
      discountAmount,
      totalAfterDiscount: subtotal - discountAmount,
    };
  },
};
