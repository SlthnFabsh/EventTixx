import type { Response } from 'express';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const ok = <T>(
  res: Response,
  data: T,
  message = 'OK',
  status = 200,
): void => {
  const body: ApiSuccess<T> = { success: true, data, message };
  res.status(status).json(body);
};

export const fail = (
  res: Response,
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): void => {
  const body: ApiFailure = {
    success: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
  res.status(status).json(body);
};
