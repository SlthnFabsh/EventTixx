import { z } from 'zod';

export const ticketTokenQuerySchema = z.object({
  token: z.string().min(32).max(64),
});
