import {
  EventStatus,
  Prisma,
  ScanResult,
  TicketStatus,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { AuthenticatedUser } from '../../types/auth';
import { AppError } from '../../utils/app-error';

const activeEventStatuses: EventStatus[] = [
  EventStatus.PUBLISHED,
  EventStatus.ONGOING,
];

type EventStaffReader = {
  eventStaff: Prisma.TransactionClient['eventStaff'];
};
type TicketScanWriter = {
  ticketScan: Prisma.TransactionClient['ticketScan'];
};

const assertEventAssignment = async (
  tx: EventStaffReader,
  eventId: string,
  userId: string,
  requireActive: boolean,
): Promise<void> => {
  const assignment = await tx.eventStaff.findUnique({
    where: { eventId_userId: { eventId, userId } },
    include: { event: { select: { status: true } } },
  });
  if (!assignment) {
    throw new AppError(
      'EVENT_NOT_ASSIGNED',
      'Event tidak ditugaskan kepada Gate Officer ini',
      403,
    );
  }
  if (
    requireActive &&
    !activeEventStatuses.includes(assignment.event.status)
  ) {
    throw new AppError(
      'GATE_EVENT_NOT_ACTIVE',
      'Event tidak sedang dibuka untuk scan tiket',
      409,
    );
  }
};

type ScanInput = {
  eventId: string;
  payload: string;
  deviceInfo?: string;
  lookup: { qrToken: string } | { ticketCode: string };
};

const writeScan = (
  tx: TicketScanWriter,
  input: {
    ticketId?: string;
    eventId: string;
    scannedById: string;
    result: ScanResult;
    scannedPayload: string;
    deviceInfo?: string;
  },
) =>
  tx.ticketScan.create({
    data: {
      ticketId: input.ticketId,
      eventId: input.eventId,
      scannedById: input.scannedById,
      result: input.result,
      scannedPayload: input.scannedPayload,
      deviceInfo: input.deviceInfo,
    },
  });

const serializeScan = (
  ticket: {
    ticketCode: string;
    status: TicketStatus;
    holderName: string | null;
    usedAt: Date | null;
    ticketCategory: { name: string };
    order: { buyerName: string };
    scans: Array<{ scannedBy: { name: string } }>;
  },
  result: ScanResult,
  usedAt?: Date | null,
) => ({
  result,
  ticketCode: ticket.ticketCode,
  categoryName: ticket.ticketCategory.name,
  holderName: ticket.holderName ?? ticket.order.buyerName,
  ...(result === ScanResult.ALREADY_USED
    ? {
        usedAt: usedAt ?? ticket.usedAt,
        previousOfficer: ticket.scans[0]?.scannedBy.name ?? null,
      }
    : {}),
});

export const gateService = {
  async listEvents(actor: AuthenticatedUser) {
    const assignments = await prisma.eventStaff.findMany({
      where: {
        userId: actor.id,
        event: { status: { in: activeEventStatuses } },
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            venueName: true,
            startAt: true,
            endAt: true,
            status: true,
          },
        },
      },
      orderBy: { event: { startAt: 'asc' } },
    });
    return assignments.map(({ event }) => event);
  },

  async scan(
    actor: AuthenticatedUser,
    input: ScanInput,
  ) {
    return prisma.$transaction(async (tx) => {
      await assertEventAssignment(tx, input.eventId, actor.id, true);

      const ticket = await tx.ticket.findUnique({
        where: input.lookup,
        include: {
          ticketCategory: { select: { name: true } },
          order: { select: { buyerName: true } },
          scans: {
            where: { result: ScanResult.VALID },
            orderBy: { scannedAt: 'asc' },
            take: 1,
            include: { scannedBy: { select: { name: true } } },
          },
        },
      });

      if (!ticket) {
        await writeScan(tx, {
          eventId: input.eventId,
          scannedById: actor.id,
          result: ScanResult.INVALID,
          scannedPayload: input.payload,
          deviceInfo: input.deviceInfo,
        });
        return { result: ScanResult.INVALID };
      }

      if (ticket.eventId !== input.eventId) {
        await writeScan(tx, {
          ticketId: ticket.id,
          eventId: input.eventId,
          scannedById: actor.id,
          result: ScanResult.WRONG_EVENT,
          scannedPayload: input.payload,
          deviceInfo: input.deviceInfo,
        });
        return { result: ScanResult.WRONG_EVENT };
      }

      if (ticket.status === TicketStatus.CANCELLED) {
        await writeScan(tx, {
          ticketId: ticket.id,
          eventId: input.eventId,
          scannedById: actor.id,
          result: ScanResult.CANCELLED,
          scannedPayload: input.payload,
          deviceInfo: input.deviceInfo,
        });
        return serializeScan(ticket, ScanResult.CANCELLED);
      }

      const now = new Date();
      const updated = await tx.ticket.updateMany({
        where: { id: ticket.id, status: TicketStatus.ACTIVE },
        data: { status: TicketStatus.USED, usedAt: now },
      });
      if (updated.count === 1) {
        await writeScan(tx, {
          ticketId: ticket.id,
          eventId: input.eventId,
          scannedById: actor.id,
          result: ScanResult.VALID,
          scannedPayload: input.payload,
          deviceInfo: input.deviceInfo,
        });
        return serializeScan(
          { ...ticket, status: TicketStatus.USED, usedAt: now },
          ScanResult.VALID,
        );
      }

      const currentTicket = await tx.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        include: {
          ticketCategory: { select: { name: true } },
          order: { select: { buyerName: true } },
          scans: {
            where: { result: ScanResult.VALID },
            orderBy: { scannedAt: 'asc' },
            take: 1,
            include: { scannedBy: { select: { name: true } } },
          },
        },
      });
      const result =
        currentTicket.status === TicketStatus.CANCELLED
          ? ScanResult.CANCELLED
          : currentTicket.status === TicketStatus.USED
            ? ScanResult.ALREADY_USED
            : null;
      if (!result) {
        throw new AppError(
          'TICKET_STATE_INCONSISTENT',
          'Status tiket berubah secara tidak terduga',
          500,
        );
      }

      await writeScan(tx, {
        ticketId: currentTicket.id,
        eventId: input.eventId,
        scannedById: actor.id,
        result,
        scannedPayload: input.payload,
        deviceInfo: input.deviceInfo,
      });
      return serializeScan(currentTicket, result);
    });
  },

  async getEventStats(actor: AuthenticatedUser, eventId: string) {
    await assertEventAssignment(prisma, eventId, actor.id, false);
    const [totalTickets, checkedIn] = await Promise.all([
      prisma.ticket.count({
        where: {
          eventId,
          status: { in: [TicketStatus.ACTIVE, TicketStatus.USED] },
        },
      }),
      prisma.ticket.count({
        where: { eventId, status: TicketStatus.USED },
      }),
    ]);
    return {
      totalTickets,
      checkedIn,
      remaining: totalTickets - checkedIn,
    };
  },
};
