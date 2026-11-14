import {
  EmailStatus,
  OrderStatus,
} from '@prisma/client';
import { z } from 'zod';

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

const dateRange = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

export const adminOrdersQuerySchema = z
  .object({
    ...pagination,
    ...dateRange,
    status: z.nativeEnum(OrderStatus).optional(),
    eventId: z.string().uuid().optional(),
    paymentType: z.string().trim().min(1).max(64).optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'Tanggal mulai harus sebelum atau sama dengan tanggal akhir',
    path: ['to'],
  });

export const adminOrderParamsSchema = z.object({
  id: z.string().uuid(),
});

export const emailLogParamsSchema = z.object({
  emailLogId: z.string().uuid(),
});

export const emailLogsQuerySchema = z.object({
  ...pagination,
  status: z.nativeEnum(EmailStatus).optional(),
  type: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export const auditLogsQuerySchema = z
  .object({
    ...pagination,
    action: z.string().trim().min(1).max(100).optional(),
    entity: z.string().trim().min(1).max(100).optional(),
    actorId: z.string().uuid().optional(),
    ...dateRange,
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'Tanggal mulai harus sebelum atau sama dengan tanggal akhir',
    path: ['to'],
  });

export const roleIdParamsSchema = z.object({
  roleId: z.coerce.number().int().positive(),
});

export const updateRoleSchema = z
  .object({
    description: z.string().trim().max(500).nullable().optional(),
    permissionCodes: z.array(z.string().min(1).max(64)).max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Minimal satu field harus diubah',
  })
  .refine(
    (value) =>
      !value.permissionCodes ||
      new Set(value.permissionCodes).size === value.permissionCodes.length,
    {
      message: 'Permission tidak boleh duplikat',
      path: ['permissionCodes'],
    },
  );

export const permissionIdParamsSchema = z.object({
  permissionId: z.coerce.number().int().positive(),
});

export const createPermissionSchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9._-]{1,63}$/),
  description: z.string().trim().max(500).nullable().optional(),
});

export const updatePermissionSchema = createPermissionSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Minimal satu field harus diubah',
  });

export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;
export type EmailLogsQuery = z.infer<typeof emailLogsQuerySchema>;
export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type CreatePermissionInput = z.infer<typeof createPermissionSchema>;
export type UpdatePermissionInput = z.infer<typeof updatePermissionSchema>;
