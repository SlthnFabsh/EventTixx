import { Router } from 'express';
import bcrypt from 'bcrypt';
import { RoleName, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate, authorize } from '../../middlewares/auth';
import { requireSuperAdmin } from '../../middlewares/super-admin';
import { validate } from '../../middlewares/validate';
import { AppError } from '../../utils/app-error';
import { asyncHandler } from '../../utils/async-handler';
import { ok } from '../../utils/response';

export const createStaffSchema = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(100),
  email: z.string().trim().email('Format email tidak valid').toLowerCase(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+]{8,20}$/, 'Nomor telepon tidak valid')
    .optional(),
  password: z.string().min(8, 'Password minimal 8 karakter').max(100),
  role: z.enum([RoleName.EVENT_MANAGER, RoleName.GATE_OFFICER], {
    message: 'Role staff harus EVENT_MANAGER atau GATE_OFFICER',
  }),
});

const listUsersQuerySchema = z.object({
  role: z
    .enum([
      RoleName.SUPER_ADMIN,
      RoleName.EVENT_MANAGER,
      RoleName.GATE_OFFICER,
      RoleName.CUSTOMER,
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const userIdParamsSchema = z.object({
  userId: z.string().uuid(),
});

const updateAdminUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().email().toLowerCase().optional(),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+]{8,20}$/)
      .nullable()
      .optional(),
    password: z.string().min(8).max(100).optional(),
    role: z.nativeEnum(RoleName).optional(),
    status: z.nativeEnum(UserStatus).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Minimal satu field harus diubah',
});

export const adminUsersRouter = Router();

adminUsersRouter.use(authenticate, requireSuperAdmin);

// Super Admin membuat akun staff (EVENT_MANAGER / GATE_OFFICER)
adminUsersRouter.post(
  '/',
  authorize('user.manage'),
  validate({ body: createStaffSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createStaffSchema>;

    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw new AppError('EMAIL_TAKEN', 'Email sudah digunakan', 409);
    }

    const role = await prisma.role.findUnique({
      where: { name: input.role },
    });
    if (!role) {
      throw new AppError('SERVER_ERROR', `Role ${input.role} belum terdaftar`, 500);
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        passwordHash,
        roleId: role.id,
        emailVerifiedAt: new Date(), // Staff yang dibuat admin langsung terverifikasi
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        pointBalance: true,
        emailVerifiedAt: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
      },
    });

    ok(
      res,
      {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role.name,
        roleId: user.role.id,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
      },
      'Akun staff berhasil dibuat',
      201,
    );
  }),
);

// List user untuk keperluan admin/verifikasi
adminUsersRouter.get(
  '/',
  authorize('user.manage'),
  validate({ query: listUsersQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = listUsersQuerySchema.parse(req.query);
    const where = query.role ? { role: { name: query.role } } : undefined;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          pointBalance: true,
          emailVerifiedAt: true,
          createdAt: true,
          role: { select: { id: true, name: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    ok(
      res,
      {
        items: users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          role: u.role.name,
          roleId: u.role.id,
          status: u.status,
          pointBalance: u.pointBalance,
          emailVerifiedAt: u.emailVerifiedAt,
          createdAt: u.createdAt,
        })),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      },
    );
  }),
);

adminUsersRouter.get(
  '/:userId',
  authorize('user.manage'),
  validate({ params: userIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = userIdParamsSchema.parse(req.params);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        pointBalance: true,
        emailVerifiedAt: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
      },
    });
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 404);
    }
    ok(res, { ...user, role: user.role.name });
  }),
);

adminUsersRouter.patch(
  '/:userId',
  authorize('user.manage'),
  validate({ params: userIdParamsSchema, body: updateAdminUserSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = userIdParamsSchema.parse(req.params);
    const input = updateAdminUserSchema.parse(req.body);
    if (
      userId === req.user!.id &&
      ((input.status && input.status !== UserStatus.ACTIVE) ||
        (input.role && input.role !== RoleName.SUPER_ADMIN))
    ) {
      throw new AppError(
        'CANNOT_CHANGE_OWN_ADMIN_ACCESS',
        'Super Admin tidak dapat menonaktifkan atau menurunkan role akunnya sendiri',
        409,
      );
    }

    const role = input.role
      ? await prisma.role.findUnique({ where: { name: input.role } })
      : null;
    if (input.role && !role) {
      throw new AppError('ROLE_NOT_FOUND', 'Role tidak ditemukan', 404);
    }
    const passwordHash = input.password
      ? await bcrypt.hash(input.password, 12)
      : undefined;
    const user = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!current) {
        throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 404);
      }

      const emailChanged =
        input.email !== undefined && input.email !== current.email;
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(emailChanged ? { emailVerifiedAt: null } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(passwordHash ? { passwordHash } : {}),
          ...(role ? { roleId: role.id } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          pointBalance: true,
          emailVerifiedAt: true,
          createdAt: true,
          role: { select: { id: true, name: true } },
        },
      });
      if (
        emailChanged ||
        passwordHash ||
        input.status !== undefined ||
        input.role !== undefined
      ) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return updated;
    });
    ok(res, { ...user, role: user.role.name }, 'User berhasil diperbarui');
  }),
);

adminUsersRouter.delete(
  '/:userId',
  authorize('user.manage'),
  validate({ params: userIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = userIdParamsSchema.parse(req.params);
    if (userId === req.user!.id) {
      throw new AppError(
        'CANNOT_SUSPEND_SELF',
        'Super Admin tidak dapat menonaktifkan akunnya sendiri',
        409,
      );
    }
    await prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.SUSPENDED },
    });
    ok(res, null, 'User dinonaktifkan');
  }),
);
