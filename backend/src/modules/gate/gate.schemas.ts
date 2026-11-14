import { z } from 'zod';

export const gateEventParamsSchema = z.object({
  eventId: z.string().uuid(),
});

export const scanTicketSchema = z.object({
  eventId: z.string().uuid(),
  qrToken: z.string().trim().min(1).max(256),
  deviceInfo: z.string().trim().max(200).optional(),
});

export const scanManualSchema = z.object({
  eventId: z.string().uuid(),
  ticketCode: z
    .string()
    .trim()
    .regex(/^ETX-[A-Z0-9]{8}$/),
  deviceInfo: z.string().trim().max(200).optional(),
});
