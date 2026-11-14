import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { optionalAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { ok } from '../../utils/response';
import {
  orderAccessQuerySchema,
  orderAccessSchema,
  orderCodeParamsSchema,
} from '../orders/orders.schemas';
import { ticketsService } from './tickets.service';
import { ticketTokenQuerySchema } from './tickets.schemas';

export const ticketsRouter = Router();
export const orderTicketsRouter = Router();

ticketsRouter.get(
  '/by-token',
  validate({ query: ticketTokenQuerySchema }),
  asyncHandler(async (req, res) => {
    const { token } = ticketTokenQuerySchema.parse(req.query);
    const result = await ticketsService.getByAccessToken(token);
    ok(res, result, 'Tiket berhasil diambil');
  }),
);

orderTicketsRouter.post(
  '/:orderCode/resend-email',
  optionalAuth,
  validate({
    params: orderCodeParamsSchema,
    body: orderAccessSchema,
    query: orderAccessQuerySchema,
  }),
  asyncHandler(async (req, res) => {
    const { orderCode } = orderCodeParamsSchema.parse(req.params);
    const accessToken =
      req.body.accessToken ??
      (typeof req.query.token === 'string' ? req.query.token : undefined);
    const result = await ticketsService.resendEmail(
      req.user,
      orderCode,
      accessToken,
    );
    ok(
      res,
      result,
      result.sent
        ? 'Email tiket berhasil dikirim'
        : 'Email tiket belum berhasil dikirim',
      result.sent ? 200 : 202,
    );
  }),
);
