import { Router, type RequestHandler } from 'express';
import { optionalAuth } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/async-handler';
import { ok } from '../../utils/response';
import { guestOrderSchema, memberOrderSchema } from './orders.schemas';
import { ordersService } from './orders.service';

const validateOrder: RequestHandler = (req, _res, next) => {
  try {
    const schema = req.user ? memberOrderSchema : guestOrderSchema;
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    next(error);
  }
};

export const ordersRouter = Router();

ordersRouter.post(
  '/',
  optionalAuth,
  validateOrder,
  asyncHandler(async (req, res) => {
    const order = await ordersService.create(req.user, req.body);
    ok(res, order, 'Order berhasil dibuat', 201);
  }),
);
