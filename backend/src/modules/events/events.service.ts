import {
  EventStatus,
  OrderStatus,
  Prisma,
  RoleName,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { AuthenticatedUser } from '../../types/auth';
import { AppError } from '../../utils/app-error';
import type {
  CreateCategoryInput,
  CreateEventInput,
  UpdateCategoryInput,
  UpdateEventInput,
} from './events.schemas';

const isSuperAdmin = (actor: AuthenticatedUser): boolean =>
  actor.role === RoleName.SUPER_ADMIN;

const ownerFilter = (actor: AuthenticatedUser) =>
  isSuperAdmin(actor) ? {} : { createdById: actor.id };

const findManagedEvent = async (
  actor: AuthenticatedUser,
  eventId: string,
) => {
  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      deletedAt: null,
      ...ownerFilter(actor),
    },
  });

  if (!event) {
    throw new AppError('EVENT_NOT_FOUND', 'Event tidak ditemukan', 404);
  }

  return event;
};

const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'event';

const findAvailableSlug = async (
  events: Prisma.TransactionClient['event'],
  base: string,
  startSuffix = 1,
  excludeId?: string,
): Promise<{ slug: string; suffix: number }> => {
  for (let suffix = startSuffix; suffix < startSuffix + 100; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    const existing = await events.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing || existing.id === excludeId) return { slug, suffix };
  }

  throw new AppError('SLUG_CONFLICT', 'Tidak dapat membuat slug unik', 409);
};

const isUniqueConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const createAuditLog = (
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  metadata?: Prisma.InputJsonObject,
) =>
  tx.auditLog.create({
    data: {
      actorId,
      action,
      entity,
      entityId,
      metadata,
    },
  });

const assertDateRange = (startAt: Date, endAt: Date | null): void => {
  if (endAt && endAt <= startAt) {
    throw new AppError(
      'INVALID_EVENT_DATES',
      'Waktu selesai harus setelah waktu mulai',
      400,
    );
  }
};

const assertSaleWindow = (
  saleStartAt: Date | null,
  saleEndAt: Date | null,
): void => {
  if (saleStartAt && saleEndAt && saleEndAt <= saleStartAt) {
    throw new AppError(
      'INVALID_SALE_WINDOW',
      'Waktu akhir penjualan harus setelah waktu mulai',
      400,
    );
  }
};

const assertTransition = (
  current: EventStatus,
  next: EventStatus | undefined,
): void => {
  if (!next || next === current) return;

  const allowed: Record<EventStatus, EventStatus[]> = {
    [EventStatus.DRAFT]: [EventStatus.PUBLISHED, EventStatus.CANCELLED],
    [EventStatus.PUBLISHED]: [EventStatus.ONGOING, EventStatus.CANCELLED],
    [EventStatus.ONGOING]: [EventStatus.FINISHED, EventStatus.CANCELLED],
    [EventStatus.FINISHED]: [],
    [EventStatus.CANCELLED]: [],
  };

  if (!allowed[current].includes(next)) {
    throw new AppError(
      'INVALID_EVENT_TRANSITION',
      `Transisi status ${current} ke ${next} tidak diizinkan`,
      409,
    );
  }
};

const assertEventIsManageableInTransaction = async (
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  eventId: string,
): Promise<void> => {
  const event = await tx.event.findFirst({
    where: {
      id: eventId,
      deletedAt: null,
      ...ownerFilter(actor),
    },
    select: { id: true },
  });
  if (!event) {
    throw new AppError('EVENT_NOT_FOUND', 'Event tidak ditemukan', 404);
  }
};

export const eventsService = {
  async list(actor: AuthenticatedUser) {
    return prisma.event.findMany({
      where: {
        deletedAt: null,
        ...ownerFilter(actor),
      },
      orderBy: [{ startAt: 'asc' }, { createdAt: 'desc' }],
    });
  },

  async get(actor: AuthenticatedUser, eventId: string) {
    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        deletedAt: null,
        ...ownerFilter(actor),
      },
      include: {
        categories: { orderBy: { createdAt: 'asc' } },
        staff: {
          include: {
            user: {
              select: { id: true, name: true, email: true, status: true },
            },
          },
        },
      },
    });

    if (!event) {
      throw new AppError('EVENT_NOT_FOUND', 'Event tidak ditemukan', 404);
    }

    return event;
  },

  async create(actor: AuthenticatedUser, input: CreateEventInput) {
    assertDateRange(input.startAt, input.endAt ?? null);
    const base = slugify(input.title);
    let nextSuffix = 1;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = await findAvailableSlug(
        prisma.event,
        base,
        nextSuffix,
      );

      try {
        return await prisma.$transaction(async (tx) => {
          const event = await tx.event.create({
            data: {
              ...input,
              slug: candidate.slug,
              createdById: actor.id,
              status: EventStatus.DRAFT,
            },
          });
          await createAuditLog(
            tx,
            actor.id,
            'EVENT_CREATED',
            'event',
            event.id,
            { title: event.title, slug: event.slug },
          );
          return event;
        });
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        nextSuffix = candidate.suffix + 1;
      }
    }

    throw new AppError('SLUG_CONFLICT', 'Tidak dapat membuat slug unik', 409);
  },

  async update(
    actor: AuthenticatedUser,
    eventId: string,
    input: UpdateEventInput,
  ) {
    const current = await findManagedEvent(actor, eventId);
    const nextStartAt = input.startAt ?? current.startAt;
    const nextEndAt =
      input.endAt === undefined ? current.endAt : input.endAt;
    assertDateRange(nextStartAt, nextEndAt);
    assertTransition(current.status, input.status);

    const titleChanged =
      input.title !== undefined && input.title !== current.title;
    const base =
      titleChanged && input.title ? slugify(input.title) : undefined;
    let nextSuffix = 1;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = base
        ? await findAvailableSlug(
            prisma.event,
            base,
            nextSuffix,
            eventId,
          )
        : { slug: current.slug, suffix: 1 };

      try {
        return await prisma.$transaction(async (tx) => {
          await assertEventIsManageableInTransaction(tx, actor, eventId);

          if (input.status === EventStatus.PUBLISHED) {
            const activeCategories = await tx.ticketCategory.count({
              where: { eventId, isActive: true },
            });
            if (activeCategories === 0) {
              throw new AppError(
                'ACTIVE_CATEGORY_REQUIRED',
                'Tambahkan minimal satu kategori tiket aktif sebelum publish',
                400,
              );
            }
          }

          const data: Prisma.EventUpdateManyMutationInput = {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.posterUrl !== undefined
              ? { posterUrl: input.posterUrl }
              : {}),
            ...(input.venueName !== undefined
              ? { venueName: input.venueName }
              : {}),
            ...(input.venueAddress !== undefined
              ? { venueAddress: input.venueAddress }
              : {}),
            ...(input.city !== undefined ? { city: input.city } : {}),
            ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
            ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(titleChanged ? { slug: candidate.slug } : {}),
          };

          const result = await tx.event.updateMany({
            where: {
              id: eventId,
              deletedAt: null,
              status: current.status,
              ...ownerFilter(actor),
            },
            data,
          });
          if (result.count !== 1) {
            throw new AppError(
              'EVENT_CHANGED',
              'Event berubah bersamaan. Muat ulang lalu coba lagi.',
              409,
            );
          }

          const event = await tx.event.findUnique({ where: { id: eventId } });
          if (!event) {
            throw new AppError('EVENT_NOT_FOUND', 'Event tidak ditemukan', 404);
          }

          await createAuditLog(
            tx,
            actor.id,
            'EVENT_UPDATED',
            'event',
            event.id,
            { fields: Object.keys(input) },
          );
          return event;
        });
      } catch (error) {
        if (!base || !isUniqueConflict(error)) throw error;
        nextSuffix = candidate.suffix + 1;
      }
    }

    throw new AppError('SLUG_CONFLICT', 'Tidak dapat membuat slug unik', 409);
  },

  async remove(actor: AuthenticatedUser, eventId: string) {
    const current = await findManagedEvent(actor, eventId);

    await prisma.$transaction(async (tx) => {
      await assertEventIsManageableInTransaction(tx, actor, eventId);
      const paidOrders = await tx.order.count({
        where: { eventId, status: OrderStatus.PAID },
      });
      if (paidOrders > 0) {
        throw new AppError(
          'EVENT_HAS_PAID_ORDERS',
          'Event dengan order PAID tidak dapat dihapus',
          409,
        );
      }

      const result = await tx.event.updateMany({
        where: {
          id: eventId,
          deletedAt: null,
          status: current.status,
          ...ownerFilter(actor),
        },
        data: { deletedAt: new Date() },
      });
      if (result.count !== 1) {
        throw new AppError(
          'EVENT_CHANGED',
          'Event berubah bersamaan. Muat ulang lalu coba lagi.',
          409,
        );
      }

      await createAuditLog(
        tx,
        actor.id,
        'EVENT_DELETED',
        'event',
        eventId,
        { title: current.title },
      );
    });
  },

  async listCategories(actor: AuthenticatedUser, eventId: string) {
    await findManagedEvent(actor, eventId);
    return prisma.ticketCategory.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
    });
  },

  async createCategory(
    actor: AuthenticatedUser,
    eventId: string,
    input: CreateCategoryInput,
  ) {
    await findManagedEvent(actor, eventId);

    return prisma.$transaction(async (tx) => {
      await assertEventIsManageableInTransaction(tx, actor, eventId);
      const category = await tx.ticketCategory.create({
        data: { ...input, eventId },
      });
      await createAuditLog(
        tx,
        actor.id,
        'TICKET_CATEGORY_CREATED',
        'ticket_category',
        category.id,
        { eventId, name: category.name },
      );
      return category;
    });
  },

  async updateCategory(
    actor: AuthenticatedUser,
    eventId: string,
    categoryId: string,
    input: UpdateCategoryInput,
  ) {
    await findManagedEvent(actor, eventId);

    return prisma.$transaction(async (tx) => {
      await assertEventIsManageableInTransaction(tx, actor, eventId);
      const current = await tx.ticketCategory.findFirst({
        where: { id: categoryId, eventId },
      });
      if (!current) {
        throw new AppError(
          'TICKET_CATEGORY_NOT_FOUND',
          'Kategori tiket tidak ditemukan',
          404,
        );
      }

      const quota = input.quota ?? current.quota;
      if (quota < current.sold + current.reserved) {
        throw new AppError(
          'QUOTA_BELOW_ALLOCATED',
          'Kuota tidak boleh lebih kecil dari tiket terjual dan ter-reserve',
          400,
        );
      }

      const saleStartAt =
        input.saleStartAt === undefined
          ? current.saleStartAt
          : input.saleStartAt;
      const saleEndAt =
        input.saleEndAt === undefined ? current.saleEndAt : input.saleEndAt;
      assertSaleWindow(saleStartAt, saleEndAt);

      const category = await tx.ticketCategory.update({
        where: { id: categoryId },
        data: input,
      });
      await createAuditLog(
        tx,
        actor.id,
        'TICKET_CATEGORY_UPDATED',
        'ticket_category',
        category.id,
        { eventId, fields: Object.keys(input) },
      );
      return category;
    });
  },

  async deactivateCategory(
    actor: AuthenticatedUser,
    eventId: string,
    categoryId: string,
  ) {
    await findManagedEvent(actor, eventId);

    await prisma.$transaction(async (tx) => {
      await assertEventIsManageableInTransaction(tx, actor, eventId);
      const current = await tx.ticketCategory.findFirst({
        where: { id: categoryId, eventId },
      });
      if (!current) {
        throw new AppError(
          'TICKET_CATEGORY_NOT_FOUND',
          'Kategori tiket tidak ditemukan',
          404,
        );
      }

      if (current.isActive) {
        await tx.ticketCategory.update({
          where: { id: categoryId },
          data: { isActive: false },
        });
        await createAuditLog(
          tx,
          actor.id,
          'TICKET_CATEGORY_DEACTIVATED',
          'ticket_category',
          categoryId,
          { eventId, name: current.name },
        );
      }
    });
  },

  async assignGateOfficer(
    actor: AuthenticatedUser,
    eventId: string,
    userId: string,
  ) {
    return prisma.$transaction(async (tx) => {
      await assertEventIsManageableInTransaction(tx, actor, eventId);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: { select: { name: true } } },
      });
      if (!user) {
        throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 404);
      }
      if (user.role.name !== RoleName.GATE_OFFICER) {
        throw new AppError(
          'INVALID_STAFF_ROLE',
          'User yang ditugaskan harus memiliki role GATE_OFFICER',
          400,
        );
      }

      return tx.eventStaff.upsert({
        where: { eventId_userId: { eventId, userId } },
        update: {},
        create: { eventId, userId },
      });
    });
  },

  async unassignGateOfficer(
    actor: AuthenticatedUser,
    eventId: string,
    userId: string,
  ) {
    await prisma.$transaction(async (tx) => {
      await assertEventIsManageableInTransaction(tx, actor, eventId);
      const result = await tx.eventStaff.deleteMany({
        where: { eventId, userId },
      });
      if (result.count === 0) {
        throw new AppError(
          'EVENT_STAFF_NOT_FOUND',
          'Penugasan gate officer tidak ditemukan',
          404,
        );
      }
    });
  },
};
