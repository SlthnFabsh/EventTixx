import { Router } from 'express';
import { optionalAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/async-handler';
import { ok } from '../../utils/response';
import {
  orderAccessQuerySchema,
  orderAccessSchema,
  orderCodeParamsSchema,
} from '../orders/orders.schemas';
import { midtransNotificationSchema } from './payments.schemas';
import { paymentsService } from './payments.service';

export const paymentsRouter = Router();
export const orderPaymentsRouter = Router();

paymentsRouter.post(
  '/midtrans/notification',
  validate({ body: midtransNotificationSchema }),
  asyncHandler(async (req, res) => {
    const result = await paymentsService.handleWebhook(req.body);
    ok(res, result, 'Notifikasi pembayaran diproses');
  }),
);

orderPaymentsRouter.post(
  '/:orderCode/pay',
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
    const result = await paymentsService.createSnapTransaction(
      req.user,
      orderCode,
      accessToken,
    );
    ok(res, result, 'Transaksi pembayaran berhasil dibuat');
  }),
);

orderPaymentsRouter.post(
  '/:orderCode/sync',
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
    const result = await paymentsService.syncOrderStatus(
      req.user,
      orderCode,
      accessToken,
    );
    ok(res, result, 'Status pembayaran disinkronkan');
  }),
);
