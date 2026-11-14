import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import { requireSuperAdmin } from '../../middlewares/super-admin';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/async-handler';
import { ok } from '../../utils/response';
import {
  adminOrderParamsSchema,
  adminOrdersQuerySchema,
  auditLogsQuerySchema,
  createPermissionSchema,
  emailLogParamsSchema,
  emailLogsQuerySchema,
  permissionIdParamsSchema,
  roleIdParamsSchema,
  updatePermissionSchema,
  updateRoleSchema,
} from './admin.schemas';
import { adminService } from './admin.service';

export const adminRouter = Router();
adminRouter.use(authenticate, requireSuperAdmin);

adminRouter.get(
  '/orders',
  authorize('order.view_all'),
  validate({ query: adminOrdersQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await adminService.listOrders(
      adminOrdersQuerySchema.parse(req.query),
    );
    ok(res, result);
  }),
);

adminRouter.get(
  '/orders/:id',
  authorize('order.view_all'),
  validate({ params: adminOrderParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = adminOrderParamsSchema.parse(req.params);
    const result = await adminService.getOrder(id);
    ok(res, result);
  }),
);

adminRouter.get(
  '/dashboard',
  authorize('report.view_all'),
  asyncHandler(async (_req, res) => {
    const result = await adminService.dashboard();
    ok(res, result);
  }),
);

adminRouter.get(
  '/email-logs',
  validate({ query: emailLogsQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await adminService.listEmailLogs(
      emailLogsQuerySchema.parse(req.query),
    );
    ok(res, result);
  }),
);

adminRouter.post(
  '/email-logs/:emailLogId/resend',
  validate({ params: emailLogParamsSchema }),
  asyncHandler(async (req, res) => {
    const { emailLogId } = emailLogParamsSchema.parse(req.params);
    const result = await adminService.resendEmailLog(emailLogId);
    ok(
      res,
      result,
      result.sent
        ? 'Email berhasil dikirim ulang'
        : 'Email belum berhasil dikirim ulang',
      result.sent ? 200 : 202,
    );
  }),
);

adminRouter.get(
  '/audit-logs',
  authorize('audit_log.view'),
  validate({ query: auditLogsQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await adminService.listAuditLogs(
      auditLogsQuerySchema.parse(req.query),
    );
    ok(res, result);
  }),
);

adminRouter.get(
  '/roles',
  authorize('role.manage'),
  asyncHandler(async (_req, res) => {
    const result = await adminService.listRoles();
    ok(res, result);
  }),
);

adminRouter.get(
  '/roles/:roleId',
  authorize('role.manage'),
  validate({ params: roleIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { roleId } = roleIdParamsSchema.parse(req.params);
    const result = await adminService.getRole(roleId);
    ok(res, result);
  }),
);

adminRouter.patch(
  '/roles/:roleId',
  authorize('role.manage'),
  validate({ params: roleIdParamsSchema, body: updateRoleSchema }),
  asyncHandler(async (req, res) => {
    const { roleId } = roleIdParamsSchema.parse(req.params);
    const result = await adminService.updateRole(roleId, req.body);
    ok(res, result, 'Role berhasil diperbarui');
  }),
);

adminRouter.get(
  '/permissions',
  authorize('permission.manage'),
  asyncHandler(async (_req, res) => {
    const result = await adminService.listPermissions();
    ok(res, result);
  }),
);

adminRouter.post(
  '/permissions',
  authorize('permission.manage'),
  validate({ body: createPermissionSchema }),
  asyncHandler(async (req, res) => {
    const result = await adminService.createPermission(req.body);
    ok(res, result, 'Permission berhasil dibuat', 201);
  }),
);

adminRouter.get(
  '/permissions/:permissionId',
  authorize('permission.manage'),
  validate({ params: permissionIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { permissionId } = permissionIdParamsSchema.parse(req.params);
    const result = await adminService.getPermission(permissionId);
    ok(res, result);
  }),
);

adminRouter.patch(
  '/permissions/:permissionId',
  authorize('permission.manage'),
  validate({
    params: permissionIdParamsSchema,
    body: updatePermissionSchema,
  }),
  asyncHandler(async (req, res) => {
    const { permissionId } = permissionIdParamsSchema.parse(req.params);
    const result = await adminService.updatePermission(
      permissionId,
      req.body,
    );
    ok(res, result, 'Permission berhasil diperbarui');
  }),
);

adminRouter.delete(
  '/permissions/:permissionId',
  authorize('permission.manage'),
  validate({ params: permissionIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { permissionId } = permissionIdParamsSchema.parse(req.params);
    await adminService.deletePermission(permissionId);
    ok(res, null, 'Permission berhasil dihapus');
  }),
);
