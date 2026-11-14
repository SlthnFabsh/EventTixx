import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';
import { ok } from '../../utils/response';
import { authService } from './auth.service';
import type { LoginInput, RegisterInput, UpdateMeInput } from './auth.schemas';

const REFRESH_COOKIE = 'refreshToken';

const getCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: (env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
});

const extractRefreshToken = (req: Request): string | undefined => {
  return (
    (req.cookies?.[REFRESH_COOKIE] as string | undefined) ??
    (req.body?.refreshToken as string | undefined)
  );
};

export const authController = {
  async register(req: Request, res: Response) {
    const input = req.body as RegisterInput;
    const result = await authService.register(input);

    res.cookie(REFRESH_COOKIE, result.refreshToken, getCookieOptions());
    ok(res, result, 'Registrasi berhasil', 201);
  },

  async verifyEmail(req: Request, res: Response) {
    const result = await authService.verifyEmail(req.body.token);
    ok(res, result, 'Email berhasil diverifikasi');
  },

  async resendVerificationEmail(req: Request, res: Response) {
    const result = await authService.resendVerificationEmail(req.user!.id);
    ok(
      res,
      result,
      result.sent
        ? 'Email verifikasi berhasil dikirim'
        : 'Email verifikasi belum berhasil dikirim',
    );
  },

  async login(req: Request, res: Response) {
    const input = req.body as LoginInput;
    const result = await authService.login(input);

    res.cookie(REFRESH_COOKIE, result.refreshToken, getCookieOptions());
    ok(res, result, 'Login berhasil');
  },

  async refresh(req: Request, res: Response) {
    const token = extractRefreshToken(req);
    if (!token) {
      throw new AppError('TOKEN_REQUIRED', 'Refresh token diperlukan', 400);
    }

    const result = await authService.refresh(token);
    res.cookie(REFRESH_COOKIE, result.refreshToken, getCookieOptions());
    ok(res, result, 'Token berhasil diperbarui');
  },

  async logout(req: Request, res: Response) {
    const token = extractRefreshToken(req);
    await authService.logout(token);

    res.clearCookie(REFRESH_COOKIE, {
      ...getCookieOptions(),
      maxAge: undefined,
    });
    ok(res, null, 'Logout berhasil');
  },

  async getMe(req: Request, res: Response) {
    const userId = req.user!.id;
    const result = await authService.getMe(userId);
    ok(res, result);
  },

  async updateMe(req: Request, res: Response) {
    const userId = req.user!.id;
    const input = req.body as UpdateMeInput;
    const result = await authService.updateMe(userId, input);
    ok(res, result, 'Profil berhasil diperbarui');
  },
};
