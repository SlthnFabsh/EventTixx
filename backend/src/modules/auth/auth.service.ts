import bcrypt from 'bcrypt';
import { RoleName } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  generateRefreshToken,
  hashToken,
  signAccessToken,
} from '../../lib/jwt';
import { getRolePermissions } from '../../lib/rbac';
import { AppError } from '../../utils/app-error';
import type { LoginInput, RegisterInput, UpdateMeInput } from './auth.schemas';

const formatUser = (user: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  pointBalance: number;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  role: { id: number; name: RoleName };
}) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role.name,
  roleId: user.role.id,
  status: user.status,
  pointBalance: user.pointBalance,
  emailVerifiedAt: user.emailVerifiedAt,
  createdAt: user.createdAt,
});

export const authService = {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw new AppError('EMAIL_TAKEN', 'Email sudah terdaftar', 409);
    }

    const customerRole = await prisma.role.findUnique({
      where: { name: RoleName.CUSTOMER },
    });
    if (!customerRole) {
      throw new AppError('SERVER_ERROR', 'Role CUSTOMER belum ter-seed', 500);
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        passwordHash,
        roleId: customerRole.id,
      },
      include: { role: true },
    });

    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role.name,
      email: user.email,
    });
    const { token: refreshToken, tokenHash, expiresAt } = generateRefreshToken();

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const permissions = await getRolePermissions(user.roleId);

    return {
      user: formatUser(user),
      permissions,
      accessToken,
      refreshToken,
    };
  },

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { role: true },
    });

    if (!user) {
      throw new AppError('INVALID_CREDENTIALS', 'Email atau password salah', 401);
    }

    if (user.status === 'SUSPENDED') {
      throw new AppError(
        'ACCOUNT_SUSPENDED',
        'Akun Anda ditangguhkan. Silakan hubungi admin.',
        403,
      );
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      throw new AppError('INVALID_CREDENTIALS', 'Email atau password salah', 401);
    }

    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role.name,
      email: user.email,
    });
    const { token: refreshToken, tokenHash, expiresAt } = generateRefreshToken();

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const permissions = await getRolePermissions(user.roleId);

    return {
      user: formatUser(user),
      permissions,
      accessToken,
      refreshToken,
    };
  },

  async refresh(rawToken: string) {
    const tokenHash = hashToken(rawToken);

    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { role: true } } },
    });

    const now = new Date();
    if (!record || record.revokedAt !== null || record.expiresAt <= now) {
      throw new AppError('TOKEN_INVALID', 'Refresh token tidak valid atau telah kedaluwarsa', 401);
    }

    if (record.user.status === 'SUSPENDED') {
      throw new AppError('ACCOUNT_SUSPENDED', 'Akun telah ditangguhkan', 403);
    }

    const { token: nextRefreshToken, tokenHash: nextHash, expiresAt: nextExpiresAt } =
      generateRefreshToken();

    await prisma.$transaction(async (tx) => {
      const rotatedAt = new Date();
      const revoked = await tx.refreshToken.updateMany({
        where: {
          id: record.id,
          revokedAt: null,
          expiresAt: { gt: rotatedAt },
        },
        data: { revokedAt: rotatedAt },
      });

      if (revoked.count !== 1) {
        throw new AppError(
          'TOKEN_INVALID',
          'Refresh token tidak valid atau telah kedaluwarsa',
          401,
        );
      }

      await tx.refreshToken.create({
        data: {
          userId: record.userId,
          tokenHash: nextHash,
          expiresAt: nextExpiresAt,
        },
      });
    });

    const nextAccessToken = signAccessToken({
      sub: record.user.id,
      role: record.user.role.name,
      email: record.user.email,
    });

    return {
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken,
      user: formatUser(record.user),
    };
  },

  async logout(rawToken?: string) {
    if (!rawToken) return;
    const tokenHash = hashToken(rawToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 404);
    }

    const permissions = await getRolePermissions(user.roleId);
    return {
      user: formatUser(user),
      permissions,
    };
  },

  async updateMe(userId: string, input: UpdateMeInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User tidak ditemukan', 404);
    }

    let passwordHash: string | undefined;

    if (input.newPassword) {
      const match = await bcrypt.compare(input.oldPassword ?? '', user.passwordHash);
      if (!match) {
        throw new AppError('PASSWORD_MISMATCH', 'Password lama tidak cocok', 400);
      }
      passwordHash = await bcrypt.hash(input.newPassword, 12);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
      include: { role: true },
    });

    return formatUser(updated);
  },
};
