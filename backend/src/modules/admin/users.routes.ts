import { Router } from 'express';
import bcrypt from 'bcrypt';
import { RoleName } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate, authorize } from '../../middlewares/auth';
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
});

export const adminUsersRouter = Router();

adminUsersRouter.use(authenticate);

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
    const { role: roleQuery } = req.query as z.infer<typeof listUsersQuerySchema>;

    const users = await prisma.user.findMany({
      where: roleQuery ? { role: { name: roleQuery } } : undefined,
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
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    ok(
      res,
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role.name,
        roleId: u.role.id,
        status: u.status,
        emailVerifiedAt: u.emailVerifiedAt,
        createdAt: u.createdAt,
      })),
    );
  }),
);
