import { RoleName } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import { authenticate } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/async-handler';
import { AppError } from '../../utils/app-error';
import { ok } from '../../utils/response';
import {
  memberOrderParamsSchema,
  paginationQuerySchema,
} from './members.schemas';
import { membersService } from './members.service';

const requireCustomer: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== RoleName.CUSTOMER) {
    next(
      new AppError(
        'CUSTOMER_ACCOUNT_REQUIRED',
        'Fitur ini hanya tersedia untuk akun Customer',
        403,
      ),
    );
    return;
  }
  next();
};

export const membersRouter = Router();
membersRouter.use(authenticate, requireCustomer);

membersRouter.get(
  '/orders',
  validate({ query: paginationQuerySchema }),
  asyncHandler(async (req, res) => {
    const paging = paginationQuerySchema.parse(req.query);
    const result = await membersService.listOrders(req.user!, paging);
    ok(res, result);
  }),
);

membersRouter.get(
  '/orders/:code',
  validate({ params: memberOrderParamsSchema }),
  asyncHandler(async (req, res) => {
    const { code } = memberOrderParamsSchema.parse(req.params);
    const order = await membersService.getOrder(req.user!, code);
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Order tidak ditemukan', 404);
    }
    ok(res, order);
  }),
);

membersRouter.get(
  '/tickets',
  validate({ query: paginationQuerySchema }),
  asyncHandler(async (req, res) => {
    const paging = paginationQuerySchema.parse(req.query);
    const result = await membersService.listTickets(req.user!, paging);
    ok(res, result);
  }),
);

membersRouter.get(
  '/points',
  validate({ query: paginationQuerySchema }),
  asyncHandler(async (req, res) => {
    const paging = paginationQuerySchema.parse(req.query);
    const result = await membersService.getPoints(req.user!, paging);
    ok(res, result);
  }),
);
