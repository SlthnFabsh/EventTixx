import { OrderStatus } from '@prisma/client';
import { sendTicketEmail } from '../../lib/mailer';
import { prisma } from '../../lib/prisma';
import type { AuthenticatedUser } from '../../types/auth';
import { AppError } from '../../utils/app-error';
import { assertOrderAccess } from '../orders/order-access';

export const ticketsService = {
  async getByAccessToken(token: string) {
    const order = await prisma.order.findUnique({
      where: { accessToken: token },
      include: {
        event: { select: { title: true, venueName: true, startAt: true } },
        tickets: {
          include: { ticketCategory: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!order || order.status !== OrderStatus.PAID) {
      throw new AppError('TICKETS_NOT_FOUND', 'Tiket tidak ditemukan', 404);
    }

    return {
      orderCode: order.orderCode,
      event: order.event,
      tickets: order.tickets.map((ticket) => ({
        ticketCode: ticket.ticketCode,
        qrToken: ticket.qrToken,
        status: ticket.status,
        category: ticket.ticketCategory.name,
      })),
    };
  },

  async resendEmail(
    actor: AuthenticatedUser | undefined,
    orderCode: string,
    accessToken?: string,
  ) {
    const order = await prisma.order.findUnique({
      where: { orderCode },
      select: {
        id: true,
        userId: true,
        accessToken: true,
        status: true,
      },
    });
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Order tidak ditemukan', 404);
    }
    assertOrderAccess(order, actor, accessToken);
    if (order.status !== OrderStatus.PAID) {
      throw new AppError(
        'ORDER_NOT_PAID',
        'Email tiket hanya tersedia untuk order yang telah dibayar',
        409,
      );
    }

    return sendTicketEmail(order.id);
  },
};
