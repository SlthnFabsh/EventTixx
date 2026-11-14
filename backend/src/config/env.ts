import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.string().url(),
  API_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET minimal 16 karakter'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET minimal 16 karakter'),
  QR_SECRET: z.string().min(16, 'QR_SECRET minimal 16 karakter'),

  // Midtrans — wajib diisi saat Fase 7.
  MIDTRANS_IS_PRODUCTION: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  MIDTRANS_SERVER_KEY: z.string().optional(),
  MIDTRANS_CLIENT_KEY: z.string().optional(),

  // SMTP — wajib diisi saat Fase 8.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('EventTixx <no-reply@eventtixx.com>'),

  CORS_ORIGINS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Konfigurasi environment tidak valid:');
  for (const issue of parsed.error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    console.error(`  - ${path}: ${issue.message}`);
  }
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  API_URL: raw.API_URL ?? `http://localhost:${raw.PORT}`,
};

export type Env = typeof env;
