import { Router } from 'express';
import { authenticate, authorize, optionalAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/async-handler';
import { ok } from '../../utils/response';
import {
  createVoucherSchema,
  updateVoucherSchema,
  validateVoucherSchema,
  voucherIdParamsSchema,
  voucherListQuerySchema,
} from './vouchers.schemas';
import { vouchersService } from './vouchers.service';

export const vouchersRouter = Router();
export const voucherManagementRouter = Router();

vouchersRouter.post(
  '/validate',
  optionalAuth,
  validate({ body: validateVoucherSchema }),
  asyncHandler(async (req, res) => {
    const result = await vouchersService.validate(req.user, req.body);
    ok(res, result, 'Voucher valid');
  }),
);

voucherManagementRouter.use(authenticate);

voucherManagementRouter.get(
  '/',
  authorize('voucher.manage'),
  validate({ query: voucherListQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = voucherListQuerySchema.parse(req.query);
    const result = await vouchersService.list(req.user!, query);
    ok(res, result);
  }),
);

voucherManagementRouter.post(
  '/',
  authorize('voucher.manage'),
  validate({ body: createVoucherSchema }),
  asyncHandler(async (req, res) => {
    const voucher = await vouchersService.create(req.user!, req.body);
    ok(res, voucher, 'Voucher berhasil dibuat', 201);
  }),
);

voucherManagementRouter.get(
  '/:voucherId',
  authorize('voucher.manage'),
  validate({ params: voucherIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { voucherId } = voucherIdParamsSchema.parse(req.params);
    const voucher = await vouchersService.get(req.user!, voucherId);
    ok(res, voucher);
  }),
);

voucherManagementRouter.patch(
  '/:voucherId',
  authorize('voucher.manage'),
  validate({
    params: voucherIdParamsSchema,
    body: updateVoucherSchema,
  }),
  asyncHandler(async (req, res) => {
    const { voucherId } = voucherIdParamsSchema.parse(req.params);
    const voucher = await vouchersService.update(
      req.user!,
      voucherId,
      req.body,
    );
    ok(res, voucher, 'Voucher berhasil diperbarui');
  }),
);

voucherManagementRouter.delete(
  '/:voucherId',
  authorize('voucher.manage'),
  validate({ params: voucherIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { voucherId } = voucherIdParamsSchema.parse(req.params);
    const voucher = await vouchersService.deactivate(req.user!, voucherId);
    ok(res, voucher, 'Voucher dinonaktifkan');
  }),
);
