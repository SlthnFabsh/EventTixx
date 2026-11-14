import crypto from 'node:crypto';
import type { AuthenticatedUser } from '../../types/auth';
import { AppError } from '../../utils/app-error';

const isValidAccessToken = (expected: string, actual?: string): boolean => {
  if (!actual) return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
};

export const assertOrderAccess = (
  order: { userId: string | null; accessToken: string },
  actor: AuthenticatedUser | undefined,
  accessToken?: string,
): void => {
  if (
    actor?.id === order.userId ||
    isValidAccessToken(order.accessToken, accessToken)
  ) {
    return;
  }
  throw new AppError(
    'ORDER_ACCESS_DENIED',
    'Anda tidak memiliki akses ke order ini',
    403,
  );
};
