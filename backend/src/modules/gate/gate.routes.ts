import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import { scanLimiter } from '../../middlewares/rate-limit';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/async-handler';
import { ok } from '../../utils/response';
import {
  gateEventParamsSchema,
  scanManualSchema,
  scanTicketSchema,
} from './gate.schemas';
import { gateService } from './gate.service';

export const gateRouter = Router();
gateRouter.use(authenticate, authorize('ticket.scan'));

gateRouter.get(
  '/events',
  asyncHandler(async (req, res) => {
    const events = await gateService.listEvents(req.user!);
    ok(res, events);
  }),
);

gateRouter.post(
  '/scan',
  scanLimiter,
  validate({ body: scanTicketSchema }),
  asyncHandler(async (req, res) => {
    const result = await gateService.scan(req.user!, {
      eventId: req.body.eventId,
      payload: req.body.qrToken,
      lookup: { qrToken: req.body.qrToken },
      deviceInfo: req.body.deviceInfo,
    });
    ok(res, result, 'Hasil scan tiket');
  }),
);

gateRouter.post(
  '/scan-manual',
  scanLimiter,
  validate({ body: scanManualSchema }),
  asyncHandler(async (req, res) => {
    const result = await gateService.scan(req.user!, {
      eventId: req.body.eventId,
      payload: req.body.ticketCode,
      lookup: { ticketCode: req.body.ticketCode },
      deviceInfo: req.body.deviceInfo,
    });
    ok(res, result, 'Hasil scan tiket manual');
  }),
);

gateRouter.get(
  '/events/:eventId/stats',
  validate({ params: gateEventParamsSchema }),
  asyncHandler(async (req, res) => {
    const { eventId } = gateEventParamsSchema.parse(req.params);
    const stats = await gateService.getEventStats(req.user!, eventId);
    ok(res, stats);
  }),
);
