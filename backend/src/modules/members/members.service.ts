import { prisma } from '../../lib/prisma';
import type { AuthenticatedUser } from '../../types/auth';

type Pagination = { page: number; limit: number };

const pagination = ({ page, limit }: Pagination) => ({
  skip: (page - 1) * limit,
  take: limit,
});

const pageResult = <T>(
  items: T[],
  total: number,
  { page, limit }: Pagination,
) => ({
  items,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  },
});

export const membersService = {
  async listOrders(actor: AuthenticatedUser, paging: Pagination) {
    const where = { userId: actor.id };
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        ...pagination(paging),
        orderBy: { createdAt: 'desc' },
        include: {
          event: { select: { title: true, slug: true, startAt: true } },
          items: {
            include: { ticketCategory: { select: { name: true } } },
          },
          _count: { select: { tickets: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    return pageResult(
      orders.map((order) => ({
        orderCode: order.orderCode,
        status: order.status,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        expiresAt: order.expiresAt,
        event: order.event,
        items: order.items.map((item) => ({
          category: item.ticketCategory.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        })),
        ticketCount: order._count.tickets,
      })),
      total,
      paging,
    );
  },

  async getOrder(actor: AuthenticatedUser, orderCode: string) {
    const order = await prisma.order.findFirst({
      where: { userId: actor.id, orderCode },
      include: {
        event: {
          select: { title: true, slug: true, venueName: true, startAt: true },
        },
        items: {
          include: { ticketCategory: { select: { name: true } } },
        },
        payments: {
          select: {
            status: true,
            paymentType: true,
            grossAmount: true,
            paidAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        tickets: {
          select: {
            ticketCode: true,
            qrToken: true,
            status: true,
            usedAt: true,
            ticketCategory: { select: { name: true } },
          },
        },
      },
    });

    if (!order) return null;
    return {
      orderCode: order.orderCode,
      status: order.status,
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      pointsUsed: order.pointsUsed,
      pointsEarned: order.pointsEarned,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      expiresAt: order.expiresAt,
      event: order.event,
      items: order.items.map((item) => ({
        category: item.ticketCategory.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
      })),
      payments: order.payments,
      tickets: order.tickets.map((ticket) => ({
        ticketCode: ticket.ticketCode,
        qrToken: ticket.qrToken,
        status: ticket.status,
        usedAt: ticket.usedAt,
        category: ticket.ticketCategory.name,
      })),
    };
  },

  async listTickets(actor: AuthenticatedUser, paging: Pagination) {
    const where = { order: { userId: actor.id } };
    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        ...pagination(paging),
        orderBy: { createdAt: 'desc' },
        include: {
          event: { select: { title: true, venueName: true, startAt: true } },
          order: { select: { orderCode: true } },
          ticketCategory: { select: { name: true } },
        },
      }),
      prisma.ticket.count({ where }),
    ]);

    return pageResult(
      tickets.map((ticket) => ({
        ticketCode: ticket.ticketCode,
        qrToken: ticket.qrToken,
        status: ticket.status,
        usedAt: ticket.usedAt,
        createdAt: ticket.createdAt,
        orderCode: ticket.order.orderCode,
        category: ticket.ticketCategory.name,
        event: ticket.event,
      })),
      total,
      paging,
    );
  },

  async getPoints(actor: AuthenticatedUser, paging: Pagination) {
    const [user, transactions, total] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: actor.id },
        select: { pointBalance: true },
      }),
      prisma.pointTransaction.findMany({
        where: { userId: actor.id },
        ...pagination(paging),
        orderBy: { createdAt: 'desc' },
        include: { order: { select: { orderCode: true } } },
      }),
      prisma.pointTransaction.count({ where: { userId: actor.id } }),
    ]);

    return {
      balance: user.pointBalance,
      ledger: pageResult(
        transactions.map((transaction) => ({
          type: transaction.type,
          points: transaction.points,
          balanceAfter: transaction.balanceAfter,
          note: transaction.note,
          createdAt: transaction.createdAt,
          orderCode: transaction.order?.orderCode ?? null,
        })),
        total,
        paging,
      ),
    };
  },
};
