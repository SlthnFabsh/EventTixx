# PROGRESS PROYEK — EVENTTIXX

Dokumen serah terima status implementasi backend EventTixx untuk AI agent selanjutnya.
Update terakhir: November 2026.

---

## 1. Ringkasan Status Fase

| Fase | Nama | Status | Keterangan |
|---|---|:---:|---|
| **0** | Persiapan Akun & Tools | ⚠️ Parsial | DB Aiven aktif. Midtrans Sandbox & SMTP menyusul di Fase 7 & 8 |
| **1** | Database PostgreSQL + Prisma | ✅ Selesai | Schema ERD §5, 2 migration, CHECK constraints, seed 4 role, health check OK |
| **2** | Fondasi Backend | ✅ Selesai | Express TS, Zod env, rate limit, CORS, AppError, response standard |
| **3** | Auth & RBAC | ✅ Selesai | JWT 15m, Refresh token hash + rotasi, RBAC cache, /auth/*, /admin/users staff |
| **4** | Event & Kategori Tiket | ⏳ **BERIKUTNYA** | CRUD event & kategori, IDOR check, slug, state machine, assign gate officer |
| 5–14 | Modul Lanjutan | ⏸️ Belum | Sesuai urutan `docs/GUIDE.md` |

---

## 2. Rincian Fase Selesai & Bukti Definition of Done (DoD)

### FASE 1 — Database Aiven + Prisma
- **Yang dibuat:**
  - `backend/prisma/schema.prisma`: seluruh tabel dari `docs/ERD.md` §5 (roles, permissions, role_permissions, users, refresh_tokens, events, event_staff, ticket_categories, orders, order_items, payments, tickets, ticket_scans, point_transactions, vouchers, voucher_redemptions, email_logs, audit_logs).
  - Migration `20261114051708_init`: struktur tabel awal.
  - Migration `20261114051732_add_checks`: PostgreSQL CHECK constraints (`chk_stock`, `chk_order_amount`, `chk_points`).
  - `backend/src/lib/prisma.ts`: singleton PrismaClient dengan connection logging development.
  - `backend/prisma/seed.ts`:
    - 4 Role (`SUPER_ADMIN`, `EVENT_MANAGER`, `GATE_OFFICER`, `CUSTOMER`).
    - 19 Permission + mapping `role_permissions` sesuai PRD §3.
    - 4 Akun Seed: Super Admin, Event Manager, Gate Officer, Customer.
    - 2 Event demo (`Neon Horizon Music Festival 2027`, `Sunset Acoustic Night 2027`).
    - 3 Kategori tiket demo + 1 penugasan `event_staff`.
  - `backend/src/app.ts`: endpoint `GET /api/v1/health` menjalankan `SELECT 1` via Prisma.
- **Bukti DoD:**
  - `npx prisma migrate status` → `Database schema is up to date!`
  - `npx prisma db seed` → sukses tanpa error.
  - `GET /api/v1/health` → HTTP 200 `{"success":true,"data":{"db":"up"},"message":"OK"}`.
  - Constraint `chk_stock`, `chk_order_amount`, `chk_points` aktif di PostgreSQL `pg_constraint`.

### FASE 2 — Fondasi Backend
- **Yang dibuat:**
  - Dependency: `helmet`, `morgan`, `zod`, `jsonwebtoken`, `cookie-parser`, `express-rate-limit`, `node-cron`, `nodemailer`, `qrcode`, `midtrans-client`, `nanoid`.
  - `backend/src/config/env.ts`: parsing & validasi runtime environment via Zod. Gagal start bila ada variabel wajib yang kosong/salah.
  - `backend/src/config/constants.ts`: `ORDER_EXPIRY_MINUTES = 15`, `POINT_EARN_PER_RUPIAH = 10000`, `POINT_VALUE_RUPIAH = 100`, `MAX_POINT_DISCOUNT_RATIO = 0.5`.
  - `backend/src/utils/app-error.ts`: class `AppError(code, message, httpStatus, details)`.
  - `backend/src/utils/async-handler.ts`: wrapper async route handler Express.
  - `backend/src/utils/response.ts`: helper standar `ok(res, data, message, status)` dan `fail(res, code, message, status, details)`.
  - `backend/src/middlewares/validate.ts`: validator Zod untuk `body`, `query`, dan `params`.
  - `backend/src/middlewares/error-handler.ts`: penanganan terpusat untuk `AppError`, `ZodError`, `PrismaClientKnownRequestError` (P2002, P2025, P2003), invalid JSON syntax, serta 404 handler.
  - `backend/src/middlewares/cors.ts`: whitelist CORS berdasar `APP_URL` dan `CORS_ORIGINS`.
  - `backend/src/middlewares/rate-limit.ts`: `apiLimiter` (300 req / 15m) dan `authLimiter` (10 req / 15m per IP).
  - Pemisahan server: `backend/src/app.ts` (Express instance) dan `backend/src/server.ts` (listener + graceful shutdown SIGINT/SIGTERM).
- **Bukti DoD:**
  - Server berjalan normal di port 5000 (atau `env.PORT`).
  - Respons error JSON seragam: format `{ success: false, error: { code, message, details? } }`.
  - Origin di luar whitelist ditolak HTTP 403 `CORS_ORIGIN_DENIED`.
  - Env salah → server exit code 1 dengan pesan error per field.
  - `npm run typecheck` lolos tanpa error.

### FASE 3 — Auth & RBAC
- **Yang dibuat:**
  - `backend/src/lib/jwt.ts`:
    - Access token JWT masa aktif 15 menit (`sub`, `role`, `email`).
    - Refresh token acak 48-byte cryptographically secure, disimpan sebagai SHA-256 hash di tabel `refresh_tokens` (masa aktif 7 hari).
    - Rotasi refresh token: token lama di-revoke (`revokedAt = now()`), token baru diterbitkan.
  - `backend/src/lib/rbac.ts`: in-memory cache permission per `roleId` (TTL 5 menit + fungsi `invalidateRbacCache()`).
  - `backend/src/middlewares/auth.ts`:
    - `authenticate`: wajib login via `Authorization: Bearer <token>`, pasang `req.user`. Tolak 401 jika tanpa token / token expired, tolak 403 jika akun `SUSPENDED`.
    - `optionalAuth`: pasang `req.user` jika token valid; abaikan jika tanpa token / token expired (untuk guest checkout Fase 6).
    - `authorize(permissionCode)`: cek izin via RBAC cache berdasarkan `req.user.roleId`. Tolak 403 `FORBIDDEN` bila tidak memiliki izin.
  - `backend/src/modules/auth/*`:
    - `POST /api/v1/auth/register`: registrasi role `CUSTOMER`.
    - `POST /api/v1/auth/login`: login, cek password bcrypt, cek status aktif, terbitkan access token + refresh token.
    - `POST /api/v1/auth/refresh`: rotasi token, tolak replay attack token yang sudah di-revoke.
    - `POST /api/v1/auth/logout`: revokasi refresh token di DB + clear cookie.
    - `GET /api/v1/auth/me` & `GET /api/v1/me`: ambil info profil & daftar kode permission user aktif.
    - `PATCH /api/v1/auth/me` & `PATCH /api/v1/me`: update nama, telepon, dan password (wajib password lama).
  - `backend/src/modules/admin/users.routes.ts`:
    - `POST /api/v1/admin/users`: Super Admin membuat akun staff (`EVENT_MANAGER` atau `GATE_OFFICER`). Guard: `authenticate` + `authorize('user.manage')`.
    - `GET /api/v1/admin/users`: Super Admin melihat daftar user.
- **Bukti DoD:**
  - Login 4 role seed berhasil (`SUPER_ADMIN`, `EVENT_MANAGER`, `GATE_OFFICER`, `CUSTOMER`).
  - Registrasi customer baru HTTP 201, duplicate email HTTP 409 `EMAIL_TAKEN`.
  - Refresh token rotation sukses, pemakaian ulang token lama ditolak HTTP 401 `TOKEN_INVALID`.
  - Akses endpoint `/admin/users`:
    - Tanpa token → HTTP 401 `UNAUTHORIZED`.
    - Akun Customer/Gate Officer → HTTP 403 `FORBIDDEN` (`user.manage`).
    - Akun Super Admin → HTTP 201 `Akun staff berhasil dibuat`.
  - Akun dengan status `SUSPENDED` ditolak saat login (HTTP 403 `ACCOUNT_SUSPENDED`).
  - `npm run typecheck` lolos tanpa error.

---

## 3. Daftar File Penting

```
backend/
├── prisma/
│   ├── migrations/
│   │   ├── 20261114051708_init/migration.sql
│   │   └── 20261114051732_add_checks/migration.sql
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── config/
│   │   ├── constants.ts
│   │   └── env.ts
│   ├── lib/
│   │   ├── jwt.ts
│   │   ├── prisma.ts
│   │   └── rbac.ts
│   ├── middlewares/
│   │   ├── auth.ts          # authenticate, optionalAuth, authorize
│   │   ├── cors.ts
│   │   ├── error-handler.ts # errorHandler, notFoundHandler
│   │   ├── rate-limit.ts    # apiLimiter, authLimiter
│   │   └── validate.ts      # validate({ body, query, params })
│   ├── modules/
│   │   ├── admin/
│   │   │   └── users.routes.ts
│   │   └── auth/
│   │       ├── auth.controller.ts
│   │       ├── auth.routes.ts
│   │       ├── auth.schemas.ts
│   │       └── auth.service.ts
│   ├── types/
│   │   └── auth.ts          # Express.Request augmentation: req.user
│   ├── utils/
│   │   ├── app-error.ts
│   │   ├── async-handler.ts
│   │   └── response.ts      # ok(), fail()
│   ├── app.ts
│   └── server.ts
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 4. Daftar Endpoint API Aktif Saat Ini

Prefix: `/api/v1`

| Method | Endpoint | Auth / Permission | Deskripsi |
|---|---|---|---|
| `GET` | `/` | Publik | Root service status |
| `GET` | `/api/v1/health` | Publik | DB health check (`SELECT 1`) |
| `POST` | `/api/v1/auth/register` | Publik (rate limit) | Register role `CUSTOMER` |
| `POST` | `/api/v1/auth/login` | Publik (rate limit) | Login semua role |
| `POST` | `/api/v1/auth/refresh` | Publik | Rotasi refresh token |
| `POST` | `/api/v1/auth/logout` | Publik / Auth | Revoke refresh token |
| `GET` | `/api/v1/auth/me` | Bearer token | Info user & list permissions |
| `PATCH` | `/api/v1/auth/me` | Bearer token | Update profil / ganti password |
| `GET` | `/api/v1/me` | Bearer token | Alias untuk `/api/v1/auth/me` |
| `PATCH` | `/api/v1/me` | Bearer token | Alias untuk `/api/v1/auth/me` |
| `POST` | `/api/v1/admin/users` | Bearer + `user.manage` | Buat akun `EVENT_MANAGER` / `GATE_OFFICER` |
| `GET` | `/api/v1/admin/users` | Bearer + `user.manage` | List users (bisa filter `?role=`) |

---

## 5. Keputusan Teknis & Alasannya

1. **Prisma v6 (6.19.3):**
   - Versi 6 digunakan karena Prisma 7/8 membawa breaking changes format konfigurasi (`prisma.config.ts`) dan status RC. Prisma 6 terbukti stabil dengan PostgreSQL Aiven dan sesuai seluruh dokumentasi panduan proyek.
2. **Dual-Mode Refresh Token (Cookie HttpOnly + JSON Body):**
   - Login & refresh mengirim token via `Set-Cookie` (HttpOnly, SameSite) sekaligus field JSON `refreshToken`.
   - **Alasan:** Frontend Web bisa memanfaatkan cookie HttpOnly untuk keamanan dari XSS, sedangkan Mobile (Expo React Native) dapat menyimpannya di `SecureStore` via response body.
3. **Hash Refresh Token Menggunakan SHA-256 (bukan bcrypt):**
   - Refresh token menggunakan random bytes 48-byte (entropi sangat tinggi).
   - **Alasan:** Lookup database `where: { tokenHash }` berkecepatan O(1). Bcrypt tidak bisa di-lookup langsung tanpa scanning table.
4. **RBAC Cache In-Memory (TTL 5 Menit):**
   - Hasil join `role_permissions` dimuat ke memory cache.
   - **Alasan:** Menghindari query DB berulang di setiap request yang melewati middleware `authorize()`. Cache otomatis dimuat ulang setelah 5 menit atau via fungsi `invalidateRbacCache()`.
5. **Port Adaptif (5000 / 4000):**
   - `.env` workspace menggunakan `PORT=5000`. Divalidasi via Zod dan diekspor ke `env.PORT` dengan fallback `4000`.
6. **Reassignment pada Validator Zod:**
   - Middleware `validate.ts` menimpa `req.body`, `req.query`, `req.params` dengan data hasil parsing Zod untuk memastikan coercion (mis. number, boolean, lowercase email) langsung tersedia di controller.

---

## 6. Penyimpangan / Penyesuaian dari Dokumen (`docs/`)

1. **Port Server:**
   - Di `docs/GUIDE.md` tertulis `PORT=4000`. Di environment lokal workspace sudah ada `.env` berisi `PORT=5000`. Nilai di `.env` lokal dipertahankan agar tidak bentrok dengan service lain.
2. **Endpoint Alias `/me`:**
   - Di `docs/GUIDE.md` §3.1 tertulis `GET/PATCH /me`, sedangkan konvensi modular mengelompokkannya di bawah `/auth/me`. Kedua route dibuka (`/api/v1/auth/me` dan `/api/v1/me`) agar kompatibel dengan pemanggil mana pun.
3. **Reset Password & Verifikasi Email (Fase 3 Langkah 6):**
   - Sesuai catatan di `docs/GUIDE.md` §3.1 ("*boleh dikerjakan setelah Fase 8 bila mailer belum siap*"), pengiriman email verifikasi dan reset password ditunda sampai Nodemailer siap di Fase 8. User register langsung aktif, dan staff buatan Super Admin langsung `emailVerifiedAt: now()`.
4. **File Lama `backend/src/config/database.js`:**
   - File lama peninggalan package `pg` dibiarkan ada agar tidak merusak ref tak terduga, tetapi **sama sekali tidak dipakai**. Seluruh akses database menggunakan singleton `backend/src/lib/prisma.ts`.

---

## 7. Bug & TODO yang Masih Terbuka

- [ ] **Reset Password & Verifikasi Email via SMTP:** Perlu dibuat endpoint `POST /auth/forgot-password` dan `POST /auth/verify-email` setelah Nodemailer diimplementasikan pada Fase 8.
- [ ] **Audit Log pada Pembuatan Staff:** Tabel `audit_logs` sudah ada di database, helper pencatatan audit log terpusat perlu disiapkan saat Fase 4/Fase 11.
- [ ] **Upload File Poster:** Saat ini field poster adalah URL string (`posterUrl`). Multer untuk local upload `/uploads` opsional di Fase 4.

---

## 8. Cara Menjalankan Proyek

### Prasyarat
- Node.js ≥ 20.x
- Database PostgreSQL Aiven aktif (URL diatur di `backend/.env`)

### Perintah Utama (di folder `backend/`)
```bash
cd backend

# 1. Install dependency
npm install

# 2. Validasi schema Prisma
npx prisma validate

# 3. Jalankan migrasi database (jika ada schema baru)
npx prisma migrate dev

# 4. Generate Prisma Client
npx prisma generate

# 5. Jalankan seed database
npx prisma db seed

# 6. Typecheck TypeScript
npm run typecheck

# 7. Jalankan development server (auto reload)
npm run dev

# 8. Buka Prisma Studio (GUI database)
npm run prisma:studio
```

---

## 9. Langkah Persis Berikutnya: FASE 4

Ikuti **`docs/GUIDE.md` FASE 4 — Event & Kategori Tiket (Event Manager)**.

### Target Pengerjaan
1. **CRUD Event (`/api/v1/manage/events`):**
   - Guard: `authenticate` + permission `event.create`, `event.update`, `event.delete`.
   - **IDOR Check Kritis:** Event Manager hanya boleh mengubah/menghapus event miliknya (`createdById === req.user.id`). Super Admin boleh mengelola seluruh event.
2. **Slug Otomatis:**
   - Generate slug unik dari judul (kebab-case, hilangkan karakter non-alfanumerik, tambahkan suffix angka bila terjadi tabrakan).
3. **State Machine Event:**
   - Transisi: `DRAFT -> PUBLISHED -> ONGOING -> FINISHED`.
   - Transisi ke `PUBLISHED` **wajib** memiliki minimal 1 kategori tiket aktif.
   - Status `CANCELLED` dapat dipicu kapan saja dari status aktif.
4. **CRUD Kategori Tiket (`/api/v1/manage/events/:eventId/categories`):**
   - Guard: permission `ticket_category.manage` + cek kepemilikan event.
   - Validasi: `quota >= sold + reserved`, `price >= 0`, `maxPerOrder >= 1`.
5. **Soft Delete Event:**
   - Set `deletedAt = new Date()`.
   - **Tolak penghapusan** bila terdapat order dengan status `PAID`.
6. **Assign / Unassign Gate Officer (`/api/v1/manage/events/:eventId/staff`):**
   - Menambahkan dan menghapus relasi di tabel `event_staff`.
   - Validasi bahwa user yang di-assign memiliki role `GATE_OFFICER`.
7. **Pencatatan Audit Log:**
   - Tulis entri di tabel `audit_logs` untuk aksi create, update, dan delete event/kategori tiket.
