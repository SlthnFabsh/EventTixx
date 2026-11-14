import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/app-error';

const EMAIL_VERIFICATION_AUDIENCE = 'eventtixx-email-verification';
const EMAIL_VERIFICATION_TYPE = 'email_verification';

export const createEmailVerificationToken = (user: {
  id: string;
  email: string;
}): string =>
  jwt.sign(
    { tokenType: EMAIL_VERIFICATION_TYPE, email: user.email },
    env.JWT_REFRESH_SECRET,
    {
      subject: user.id,
      audience: EMAIL_VERIFICATION_AUDIENCE,
      expiresIn: '24h',
    },
  );

export const readEmailVerificationToken = (
  token: string,
): { userId: string; email: string } => {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      audience: EMAIL_VERIFICATION_AUDIENCE,
    });
  } catch (error) {
    const code =
      error instanceof jwt.TokenExpiredError
        ? 'EMAIL_VERIFICATION_EXPIRED'
        : 'EMAIL_VERIFICATION_INVALID';
    throw new AppError(
      code,
      'Tautan verifikasi email tidak valid atau telah kedaluwarsa',
      400,
    );
  }

  if (
    typeof payload === 'string' ||
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    payload.tokenType !== EMAIL_VERIFICATION_TYPE
  ) {
    throw new AppError(
      'EMAIL_VERIFICATION_INVALID',
      'Tautan verifikasi email tidak valid',
      400,
    );
  }
  return { userId: payload.sub, email: payload.email };
};
