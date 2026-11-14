import { EventStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/app-error';
import type { PublicEventsQuery } from './catalog.schemas';

type PublicEventRecord = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  posterUrl: string | null;
  venueName: string;
  venueAddress: string | null;
  city: string;
  startAt: Date;
  endAt: Date | null;
  categories: Array<{
    id: string;
    name: string;
    description: string | null;
    price: number;
    maxPerOrder: number;
    saleStartAt: Date | null;
    saleEndAt: Date | null;
    quota: number;
    sold: number;
    reserved: number;
  }>;
};

export type TicketSaleState = 'UPCOMING' | 'ON_SALE' | 'SOLD_OUT' | 'CLOSED';

export const getTicketSaleState = (
  category: PublicEventRecord['categories'][number],
  now: Date,
): TicketSaleState => {
  if (category.saleStartAt && now < category.saleStartAt) return 'UPCOMING';
  if (category.saleEndAt && now >= category.saleEndAt) return 'CLOSED';
  if (category.quota - category.sold - category.reserved <= 0) return 'SOLD_OUT';
  return 'ON_SALE';
};

export const formatPublicEvent = (
  event: PublicEventRecord,
  now = new Date(),
) => ({
  id: event.id,
  title: event.title,
  slug: event.slug,
  description: event.description,
  posterUrl: event.posterUrl,
  venueName: event.venueName,
  venueAddress: event.venueAddress,
  city: event.city,
  startAt: event.startAt,
  endAt: event.endAt,
  categories: event.categories.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
    price: category.price,
    maxPerOrder: category.maxPerOrder,
    saleStartAt: category.saleStartAt,
    saleEndAt: category.saleEndAt,
    available: category.quota - category.sold - category.reserved,
    saleState: getTicketSaleState(category, now),
  })),
});

export const catalogService = {
  async list(query: PublicEventsQuery) {
    const where: Prisma.EventWhereInput = {
      status: EventStatus.PUBLISHED,
      deletedAt: null,
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.city
        ? { city: { contains: query.city, mode: 'insensitive' } }
        : {}),
      ...(query.from || query.to
        ? {
            startAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          posterUrl: true,
          venueName: true,
          venueAddress: true,
          city: true,
          startAt: true,
          endAt: true,
        },
        orderBy: { startAt: 'asc' },
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      items: events,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  },

  async getBySlug(slug: string) {
    const event = await prisma.event.findFirst({
      where: {
        slug,
        status: EventStatus.PUBLISHED,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        posterUrl: true,
        venueName: true,
        venueAddress: true,
        city: true,
        startAt: true,
        endAt: true,
        categories: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            maxPerOrder: true,
            saleStartAt: true,
            saleEndAt: true,
            quota: true,
            sold: true,
            reserved: true,
          },
          orderBy: { price: 'asc' },
        },
      },
    });

    if (!event) {
      throw new AppError('EVENT_NOT_FOUND', 'Event tidak ditemukan', 404);
    }

    return formatPublicEvent(event);
  },
};
