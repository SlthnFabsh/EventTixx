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
| **4** | Event & Kategori Tiket | ✅ Selesai | CRUD event/kategori, owner guard, slug unik, state machine, staff assignment, audit log |
| **5** | Katalog Publik | ✅ Selesai | Listing/filter/paginasi event terbit, detail kategori dan status penjualan |
| **6** | Checkout & Reservasi Stok | ⚠️ Implementasi; DoD DB tertunda | Order guest/member, reserve atomik, voucher/poin, cron expiry |
| **7** | Midtrans Sandbox + Webhook | ⚠️ Backend selesai; integrasi tertunda | Snap API, webhook signature, sync, settlement idempotent |
| **8** | Tiket, QR & Email Otomatis | ⚠️ Backend selesai; integrasi tertunda | Tiket saat settlement, QR token, email retry, akses tiket |
| **9** | Fitur Member | ⚠️ Backend selesai; integrasi tertunda | Riwayat member, poin, voucher, verifikasi email dan klaim order |
| **10** | Gate Officer: API Scan | ⚠️ Backend selesai; integrasi DB tertunda | Scan QR/manual atomik, hasil scan dan statistik |
| 11–14 | Modul Lanjutan | ⏸️ Belum | Sesuai urutan `docs/GUIDE.md` |

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

### FASE 4 — Event & Kategori Tiket
- **Yang dibuat:**
  - `backend/src/modules/events/events.routes.ts`, `events.service.ts`, dan `events.schemas.ts`.
  - `/api/v1/manage/events`: list/detail event, create, update, dan soft delete.
  - Event Manager hanya dapat mengakses event dengan `createdById` miliknya; Super Admin dapat mengakses semua event.
  - Slug dibuat dari judul dan diberi suffix angka saat bentrok; perubahan status mengikuti state machine.
  - Publish mensyaratkan kategori aktif; event dengan order `PAID` tidak dapat di-soft-delete.
  - CRUD kategori tiket memvalidasi `price`, `maxPerOrder`, dan `quota >= sold + reserved`. DELETE menonaktifkan kategori (`isActive=false`) agar histori order tetap terjaga.
  - Assign/unassign Gate Officer memvalidasi role `GATE_OFFICER`.
  - Aksi create/update/delete event dan kategori dicatat di `audit_logs`.
- **Bukti DoD:**
  - `npm test` meloloskan tes owner guard/IDOR dan batas kuota terhadap tiket terjual + ter-reserve.
  - `npm run typecheck` lolos.
  - Tes integrasi terhadap database belum dijalankan.

### FASE 5 — Katalog Publik
- **Yang dibuat:**
  - `GET /api/v1/events`: hanya event `PUBLISHED` dan belum dihapus, dengan filter `q`, `city`, rentang tanggal, pagination, dan urutan `startAt`.
  - `GET /api/v1/events/:slug`: detail event dengan kategori aktif, jumlah tersedia (`quota - sold - reserved`), dan `saleState`.
  - Response memilih field publik eksplisit; tidak menyertakan `createdBy`, staff, atau penghitung internal `sold`/`reserved`.
- **Bukti DoD:**
  - `npm test` meloloskan tes status penjualan dan bentuk response publik.
  - `npm run typecheck` lolos.
  - Tes integrasi endpoint terhadap database belum dijalankan.

### FASE 6 — Checkout & Reservasi Stok
- **Yang dibuat:**
  - `POST /api/v1/orders` menerima checkout Guest maupun Member; harga diambil dari kategori di database.
  - Order dibuat `PENDING` dengan expiry 15 menit; stok di-reserve dalam satu transaksi menggunakan row lock dan `UPDATE` bersyarat.
  - Dukungan voucher umum/member-only, batas kuota voucher, dan redeem poin Member dengan batas 50% subtotal.
  - `backend/src/jobs/expire-orders.ts` menjalankan expiry tiap menit, melepas stok, mengembalikan poin, dan mengembalikan kuota voucher secara idempoten.
  - Order dengan total Rp0 ditolak sementara (`ZERO_TOTAL_UNSUPPORTED`); pemenuhan order gratis menunggu alur PAID/tiket pada fase berikutnya.
- **Bukti yang tersedia:**
  - `npm test` meloloskan validasi Guest/Member, item duplikat, perhitungan diskon, serta tes Fase 4–5.
  - `npm run typecheck` lolos.
  - Uji konkurensi PostgreSQL dan expiry terhadap database belum dijalankan; Fase 6 tetap perlu verifikasi DoD integrasi.

### FASE 7 — Midtrans Sandbox + Webhook
- **Yang dibuat:**
  - `POST /api/v1/orders/:orderCode/pay` membuat atau menggunakan ulang transaksi Snap; akses order memakai bearer token atau `accessToken`.
  - `POST /api/v1/payments/midtrans/notification` memverifikasi signature SHA-512 dengan perbandingan constant-time sebelum memproses notifikasi.
  - `POST /api/v1/orders/:orderCode/sync` mengambil status Midtrans dan meneruskannya ke `handleMidtransStatus`, service yang sama dengan webhook.
  - Settlement mengubah order dan reservasi stok dalam satu transaksi; poin member hanya diberikan pada transisi pertama ke `PAID`.
  - Notifikasi duplikat tidak menggandakan stok/poin. Pembayaran settled setelah order terminal dicatat untuk rekonsiliasi/refund manual; order tidak diaktifkan kembali.
- **Bukti yang tersedia:**
  - `npm test` meloloskan tes signature, mapping status, status settlement yang monoton, dan aksi idempoten.
  - `npm run typecheck` lolos.
  - Database/PostgreSQL dan Midtrans Sandbox belum diuji; kredensial `.env` tidak dibaca.
  - UI Snap belum terhubung karena frontend saat ini masih berupa starter Vite dan belum memiliki alur checkout/status order.

### FASE 8 — Tiket, QR & Email Otomatis
- **Yang dibuat:**
  - Saat transisi order ke `PAID`, tiket per kuantitas dibuat di transaksi yang sama; tiap tiket mendapat kode yang mudah dibaca dan `qrToken` acak tanpa data pribadi.
  - Email tiket berisi ringkasan event/order, kode tiket, QR inline + PNG attachment, dan tautan tiket online.
  - Email dikirim setelah transaksi pembayaran commit; maksimal tiga percobaan dicatat satu per satu di `email_logs`, tanpa membatalkan pembayaran.
  - `POST /api/v1/orders/:orderCode/resend-email` memakai otorisasi pemilik order atau `accessToken`.
  - `GET /api/v1/tickets/by-token?token=` memberi tiket dan QR token untuk halaman tiket.
- **Bukti yang tersedia:**
  - `npm test` meloloskan tes escaping HTML email dan validasi akses tiket; total 12 tes lulus.
  - `npm run typecheck` lolos.
  - Database/PostgreSQL dan SMTP belum diuji; frontend masih belum memiliki halaman tiket/QR.

### FASE 9 — Fitur Member
- **Yang dibuat:**
  - Endpoint member paginated untuk order, detail order, tiket, dan ledger poin.
  - `POST /api/v1/vouchers/validate` menghitung harga dari database dan tidak membuat order atau memesan stok.
  - CRUD voucher di `/api/v1/manage/vouchers`; Event Manager dibatasi ke voucher/event miliknya, Super Admin dapat mengelola semua. DELETE menonaktifkan voucher dan perubahan dicatat di audit log.
  - Registrasi mengirim tautan verifikasi email. `POST /api/v1/auth/verify-email` menandai alamat terverifikasi dan mengklaim order guest dengan email yang sama; akun belum terverifikasi tidak mengklaim order.
  - Poin `EARN` memeriksa ledger untuk mencegah pemberian ganda per order.
- **Bukti yang tersedia:**
  - `npm test` meloloskan 14 tes unit/schema.
  - `npm run typecheck` lolos.
  - Database/PostgreSQL dan SMTP belum diuji; UI member belum dibuat.

### FASE 10 — Gate Officer: API Scan
- **Yang dibuat:**
  - `GET /api/v1/gate/events` membatasi daftar ke event `PUBLISHED/ONGOING` yang ditugaskan kepada officer.
  - `POST /api/v1/gate/scan` dan `/scan-manual` memeriksa assignment, mencatat semua hasil, dan memakai conditional `updateMany` untuk mencegah tiket dipakai dua kali.
  - Hasil `ALREADY_USED` menyertakan waktu check-in dan nama petugas pertama; statistik event menghitung tiket aktif/terpakai.
  - Endpoint scan memiliki rate limit longgar terpisah dari limiter API umum.
- **Bukti yang tersedia:**
  - `npm test` meloloskan tes trim QR dan validasi kode tiket; total 16 tes lulus.
  - `npm run typecheck` lolos.
  - Uji konkurensi scan terhadap PostgreSQL belum dijalankan.

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
| `GET` | `/api/v1/manage/events` | Bearer + `event.create` | List event yang dapat dikelola |
| `POST` | `/api/v1/manage/events` | Bearer + `event.create` | Buat event draft |
| `GET/PATCH/DELETE` | `/api/v1/manage/events/:eventId` | Bearer + `event.update` / `event.delete` | Detail, update, atau soft delete event |
| `GET/POST` | `/api/v1/manage/events/:eventId/categories` | Bearer + `ticket_category.manage` | List atau buat kategori |
| `PATCH/DELETE` | `/api/v1/manage/events/:eventId/categories/:categoryId` | Bearer + `ticket_category.manage` | Update atau nonaktifkan kategori |
| `POST` | `/api/v1/manage/events/:eventId/staff` | Bearer + `event.update` | Assign Gate Officer |
| `DELETE` | `/api/v1/manage/events/:eventId/staff/:userId` | Bearer + `event.update` | Unassign Gate Officer |
| `GET` | `/api/v1/events` | Publik | Cari/filter/paginasi event terbit |
| `GET` | `/api/v1/events/:slug` | Publik | Detail event dan kategori aktif |
| `POST` | `/api/v1/orders` | Publik / Bearer opsional | Buat order Guest atau Member dan reserve stok |
| `POST` | `/api/v1/orders/:orderCode/pay` | Pemilik order / `accessToken` | Buat atau ambil ulang transaksi Snap |
| `POST` | `/api/v1/orders/:orderCode/sync` | Pemilik order / `accessToken` | Sinkronkan status pembayaran ke Midtrans |
| `POST` | `/api/v1/orders/:orderCode/resend-email` | Pemilik order / `accessToken` | Kirim ulang email tiket |
| `POST` | `/api/v1/payments/midtrans/notification` | Signature Midtrans | Proses webhook pembayaran |
| `GET` | `/api/v1/tickets/by-token?token=` | Token akses order | Ambil tiket dan QR token |
| `GET` | `/api/v1/me/orders` | Customer | Riwayat order paginated |
| `GET` | `/api/v1/me/orders/:code` | Customer | Detail order milik sendiri |
| `GET` | `/api/v1/me/tickets` | Customer | Tiket dan QR milik sendiri |
| `GET` | `/api/v1/me/points` | Customer | Saldo dan ledger poin paginated |
| `POST` | `/api/v1/vouchers/validate` | Publik / Customer | Hitung diskon voucher tanpa membuat order |
| `GET/POST` | `/api/v1/manage/vouchers` | Bearer + `voucher.manage` | List atau membuat voucher |
| `GET/PATCH/DELETE` | `/api/v1/manage/vouchers/:voucherId` | Bearer + `voucher.manage` | Detail, update, atau nonaktifkan voucher |
| `POST` | `/api/v1/auth/verify-email` | Token verifikasi | Verifikasi email dan klaim order guest |
| `POST` | `/api/v1/auth/resend-verification` | Bearer token | Kirim ulang tautan verifikasi |
| `GET` | `/api/v1/gate/events` | Bearer + `ticket.scan` | Event yang ditugaskan |
| `POST` | `/api/v1/gate/scan` | Bearer + `ticket.scan` | Scan QR token |
| `POST` | `/api/v1/gate/scan-manual` | Bearer + `ticket.scan` | Validasi kode tiket manual |
| `GET` | `/api/v1/gate/events/:eventId/stats` | Bearer + `ticket.scan` | Statistik check-in event |

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

## 9. Langkah Persis Berikutnya: FASE 11

Ikuti **`docs/GUIDE.md` FASE 11 — Super Admin: Monitoring**.

### Target Pengerjaan
1. Tambahkan monitoring read-only untuk order dan dashboard revenue/statistik.
2. Batasi semua endpoint monitoring ke Super Admin.
3. Implementasikan admin roles/permissions dan invalidasi cache RBAC.
4. Tambahkan daftar audit log/email log dan resend email admin.
