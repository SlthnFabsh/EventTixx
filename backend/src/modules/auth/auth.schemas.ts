import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(100),
  email: z.string().trim().email('Format email tidak valid').toLowerCase(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+]{8,20}$/, 'Nomor telepon tidak valid')
    .optional(),
  password: z.string().min(8, 'Password minimal 8 karakter').max(100),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Format email tidak valid').toLowerCase(),
  password: z.string().min(1, 'Password wajib diisi'),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1).max(2048),
});

export const refreshSchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    refreshToken: z.string().min(1, 'Refresh token diperlukan').optional(),
  }),
);

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+]{8,20}$/, 'Nomor telepon tidak valid')
      .optional()
      .nullable(),
    oldPassword: z.string().optional(),
    newPassword: z.string().min(8, 'Password baru minimal 8 karakter').optional(),
  })
  .refine(
    (data) => {
      if (data.newPassword && !data.oldPassword) return false;
      return true;
    },
    {
      message: 'oldPassword wajib disertakan bila ingin mengganti password',
      path: ['oldPassword'],
    },
  );

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
