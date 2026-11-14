import {
  EmailStatus,
  OrderStatus,
  Prisma,
  TicketStatus,
} from '@prisma/client';
import { createEmailVerificationToken } from '../../lib/email-verification';
import { sendTicketEmail, sendVerificationEmail } from '../../lib/mailer';
import { invalidateRbacCache } from '../../lib/rbac';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/app-error';
import type {
  AdminOrdersQuery,
  AuditLogsQuery,
  CreatePermissionInput,
  EmailLogsQuery,
  UpdatePermissionInput,
  UpdateRoleInput,
} from './admin.schemas';

const pageResult = <T>(items: T[], total: number, page: number, limit: number) => ({
  items,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  },
});

const dateFilter = <T extends 'Order' | 'AuditLog' = 'Order'>(
  from?: Date,
  to?: Date,
): Prisma.DateTimeFilter<T> | undefined => {
  if (!from && !to) return undefined;
  const end = to ? new Date(to) : undefined;
  if (end) end.setUTCHours(23, 59, 59, 999);
  return {
    ...(from ? { gte: from } : {}),
    ...(end ? { lte: end } : {}),
  };
};

type DailyTrend = {
  date: Date;
  revenue: bigint | number;
  orderCount: number;
};

export const adminService = {
  async listOrders(input: AdminOrdersQuery) {
    const where: Prisma.OrderWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.eventId ? { eventId: input.eventId } : {}),
      ...(input.from || input.to
        ? { createdAt: dateFilter(input.from, input.to) }
        : {}),
      ...(input.paymentType
        ? {
            payments: {
              some: {
                paymentType: {
                  contains: input.paymentType,
                  mode: 'insensitive',
                },
              },
            },
          }
        : {}),
      ...(input.q
        ? {
            OR: [
              { orderCode: { contains: input.q, mode: 'insensitive' } },
              { buyerEmail: { contains: input.q, mode: 'insensitive' } },
              { buyerPhone: { contains: input.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderCode: true,
          buyerName: true,
          buyerEmail: true,
          buyerPhone: true,
          totalAmount: true,
          status: true,
          createdAt: true,
          paidAt: true,
          event: { select: { id: true, title: true } },
          payments: {
            select: { paymentType: true, status: true, grossAmount: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      prisma.order.count({ where }),
    ]);
    return pageResult(orders, total, input.page, input.limit);
  },

  async getOrder(id: string) {
    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        orderCode: true,
        buyerName: true,
        buyerEmail: true,
        buyerPhone: true,
        subtotal: true,
        discountAmount: true,
        pointsUsed: true,
        pointsEarned: true,
        totalAmount: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        paidAt: true,
        event: {
          select: { id: true, title: true, venueName: true, startAt: true },
        },
        user: { select: { id: true, name: true, email: true } },
        items: {
          include: { ticketCategory: { select: { name: true } } },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
        tickets: {
          select: {
            ticketCode: true,
            status: true,
            holderName: true,
            usedAt: true,
            createdAt: true,
            ticketCategory: { select: { name: true } },
          },
        },
        emailLogs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Order tidak ditemukan', 404);
    }
    return order;
  },

  async dashboard() {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - 29);

    const [revenue, statusGroups, ticketsSold, topEventGroups, daily] =
      await Promise.all([
        prisma.order.aggregate({
          where: { status: OrderStatus.PAID },
          _sum: { totalAmount: true },
        }),
        prisma.order.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        prisma.ticket.count({
          where: { status: { in: [TicketStatus.ACTIVE, TicketStatus.USED] } },
        }),
        prisma.ticket.groupBy({
          by: ['eventId'],
          where: { status: { in: [TicketStatus.ACTIVE, TicketStatus.USED] } },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 5,
        }),
        prisma.$queryRaw<DailyTrend[]>`
          SELECT DATE_TRUNC('day', "paidAt")::date AS "date",
            SUM("totalAmount")::bigint AS "revenue",
            COUNT(*)::int AS "orderCount"
          FROM "orders"
          WHERE "status" = ${OrderStatus.PAID}::"OrderStatus"
            AND "paidAt" >= ${start}
          GROUP BY 1
          ORDER BY 1
        `,
      ]);

    const orderCounts = Object.fromEntries(
      Object.values(OrderStatus).map((status) => [status, 0]),
    ) as Record<OrderStatus, number>;
    for (const group of statusGroups) {
      orderCounts[group.status] = group._count._all;
    }

    const eventIds = topEventGroups.map((group) => group.eventId);
    const events = await prisma.event.findMany({
      where: { id: { in: eventIds } },
      select: { id: true, title: true },
    });
    const eventTitles = new Map(events.map((event) => [event.id, event.title]));
    const topEvents = topEventGroups.map((group) => ({
      eventId: group.eventId,
      title: eventTitles.get(group.eventId) ?? 'Event tidak ditemukan',
      ticketsSold: group._count.id,
    }));

    const trendByDate = new Map(
      daily.map((row) => [
        row.date.toISOString().slice(0, 10),
        { revenue: Number(row.revenue), orders: row.orderCount },
      ]),
    );
    const revenueTrend = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      const values = trendByDate.get(key);
      return {
        date: key,
        revenue: values?.revenue ?? 0,
        orders: values?.orders ?? 0,
      };
    });

    return {
      totalRevenue: revenue._sum.totalAmount ?? 0,
      orderCounts,
      ticketsSold,
      topEvents,
      revenueTrend,
    };
  },

  async listEmailLogs(input: EmailLogsQuery) {
    const where: Prisma.EmailLogWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.q
        ? {
            OR: [
              { toEmail: { contains: input.q, mode: 'insensitive' } },
              { subject: { contains: input.q, mode: 'insensitive' } },
              {
                order: {
                  is: {
                    orderCode: { contains: input.q, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [logs, total] = await Promise.all([
      prisma.emailLog.findMany({
        where,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: { createdAt: 'desc' },
        include: { order: { select: { orderCode: true } } },
      }),
      prisma.emailLog.count({ where }),
    ]);
    return pageResult(logs, total, input.page, input.limit);
  },

  async resendEmailLog(emailLogId: string) {
    const log = await prisma.emailLog.findUnique({
      where: { id: emailLogId },
    });
    if (!log) {
      throw new AppError('EMAIL_LOG_NOT_FOUND', 'Email log tidak ditemukan', 404);
    }

    if (log.type === 'TICKET' && log.orderId) {
      return sendTicketEmail(log.orderId);
    }
    if (log.type === 'VERIFY_EMAIL') {
      const user = await prisma.user.findUnique({
        where: { email: log.toEmail },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerifiedAt: true,
        },
      });
      if (!user || user.emailVerifiedAt) {
        throw new AppError(
          'EMAIL_RESEND_NOT_AVAILABLE',
          'Email verifikasi tidak tersedia untuk dikirim ulang',
          409,
        );
      }
      return sendVerificationEmail(
        user,
        createEmailVerificationToken(user),
      );
    }
    throw new AppError(
      'EMAIL_RESEND_NOT_SUPPORTED',
      'Jenis email ini tidak mendukung pengiriman ulang',
      409,
    );
  },

  async listAuditLogs(input: AuditLogsQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(input.action
        ? { action: { contains: input.action, mode: 'insensitive' } }
        : {}),
      ...(input.entity
        ? { entity: { contains: input.entity, mode: 'insensitive' } }
        : {}),
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.from || input.to
        ? { createdAt: dateFilter<'AuditLog'>(input.from, input.to) }
        : {}),
    };
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return pageResult(logs, total, input.page, input.limit);
  },

  async listRoles() {
    return prisma.role.findMany({
      orderBy: { id: 'asc' },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
  },

  async getRole(roleId: number) {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
    if (!role) {
      throw new AppError('ROLE_NOT_FOUND', 'Role tidak ditemukan', 404);
    }
    return role;
  },

  async updateRole(roleId: number, input: UpdateRoleInput) {
    const result = await prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id: roleId } });
      if (!role) {
        throw new AppError('ROLE_NOT_FOUND', 'Role tidak ditemukan', 404);
      }

      if (input.permissionCodes !== undefined) {
        const codes = [...new Set(input.permissionCodes)];
        const permissions = await tx.permission.findMany({
          where: { code: { in: codes } },
          select: { id: true },
        });
        if (permissions.length !== codes.length) {
          throw new AppError(
            'PERMISSION_NOT_FOUND',
            'Satu atau beberapa permission tidak ditemukan',
            404,
          );
        }
        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map((permission) => ({
              roleId,
              permissionId: permission.id,
            })),
          });
        }
      }

      const include = {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      } as const;
      const updated =
        input.description === undefined
          ? await tx.role.findUniqueOrThrow({
              where: { id: roleId },
              include,
            })
          : await tx.role.update({
              where: { id: roleId },
              data: { description: input.description },
              include,
            });
      return updated;
    });
    invalidateRbacCache();
    return result;
  },

  async listPermissions() {
    return prisma.permission.findMany({
      orderBy: { code: 'asc' },
      include: {
        roles: { select: { role: { select: { id: true, name: true } } } },
      },
    });
  },

  async getPermission(permissionId: number) {
    const permission = await prisma.permission.findUnique({
      where: { id: permissionId },
      include: {
        roles: { select: { role: { select: { id: true, name: true } } } },
      },
    });
    if (!permission) {
      throw new AppError(
        'PERMISSION_NOT_FOUND',
        'Permission tidak ditemukan',
        404,
      );
    }
    return permission;
  },

  async createPermission(input: CreatePermissionInput) {
    const permission = await prisma.permission.create({ data: input });
    invalidateRbacCache();
    return permission;
  },

  async updatePermission(
    permissionId: number,
    input: UpdatePermissionInput,
  ) {
    const permission = await prisma.permission.update({
      where: { id: permissionId },
      data: input,
    });
    invalidateRbacCache();
    return permission;
  },

  async deletePermission(permissionId: number) {
    await prisma.permission.delete({ where: { id: permissionId } });
    invalidateRbacCache();
  },
};
