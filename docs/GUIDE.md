# GUIDE — Panduan Pengerjaan EventTixx (Langkah demi Langkah)

> Ikuti **berurutan**. Tiap fase punya: **Tujuan → Langkah → Definition of Done (DoD) → Prompt untuk AI Agent**.
> Kondisi awal: proyek FE (Vite TS), BE (Node+Express), Mobile (Expo) sudah ter-setup. **Database belum tersambung.**

Ringkasan fase:

| Fase | Isi |
|---|---|
| 0 | Persiapan akun & tools (Aiven, Midtrans, SMTP, ngrok) |
| 1 | **Sambungkan database Aiven PostgreSQL + Prisma** |
| 2 | Fondasi backend (config, error handler, middleware) |
| 3 | Auth & RBAC |
| 4 | Event & kategori tiket (Event Manager) |
| 5 | Katalog publik |
| 6 | Checkout & reservasi stok (Guest/Member) |
| 7 | Midtrans Sandbox + Webhook |
| 8 | Tiket, QR & Email otomatis |
| 9 | Fitur Member (riwayat, poin, voucher, klaim order guest) |
| 10 | Gate Officer: API scan |
| 11 | Super Admin: monitoring |
| 12 | Frontend Web |
| 13 | Mobile Expo |
| 14 | Testing, hardening, deploy |

---

## FASE 0 — Persiapan

**Checklist akun (dikerjakan manual oleh developer):**
1. **Aiven** — daftar di aiven.io (ada free tier PostgreSQL).
2. **Midtrans Sandbox** — daftar di dashboard sandbox Midtrans → menu *Settings → Access Keys* → catat **Server Key** & **Client Key** (prefix `SB-Mid-`).
3. **SMTP untuk email** (pilih salah satu):
   - Dev cepat: **Mailtrap** (inbox testing, email tidak benar-benar terkirim) atau
   - Gmail dengan **App Password** (butuh 2FA aktif) atau
   - Resend/Brevo (SMTP).
4. **Tunnel untuk webhook**: install **ngrok** (atau cloudflared). Midtrans tidak bisa menembak `localhost`.
5. Pastikan Node ≥ 20, Git, dan Expo Go di HP.

**DoD:** semua kredensial tercatat di `.env` (tidak di-commit).

---

## FASE 1 — Sambungkan Database Aiven + Prisma  ⭐ (prioritas Anda)

### 1.1 Buat PostgreSQL di Aiven
1. Login Aiven → **Create service** → pilih **PostgreSQL**.
2. Pilih plan **Free** (jika tersedia di region Anda) → pilih region terdekat (mis. Singapore bila ada) → **Create**.
3. Tunggu status **Running** (beberapa menit).
4. Di halaman *Overview* service, salin **Service URI**. Bentuknya:
   ```
   postgres://avnadmin:<PASSWORD>@<HOST>.aivencloud.com:<PORT>/defaultdb?sslmode=require
   ```
5. Pastikan **Allowed IP addresses** mengizinkan koneksi Anda (default biasanya `0.0.0.0/0` terbuka; untuk produksi, batasi ke IP server).

### 1.2 Simpan di `.env` backend
```
DATABASE_URL="postgres://avnadmin:PASSWORD@HOST.aivencloud.com:PORT/defaultdb?sslmode=require"
```
Jika password mengandung karakter khusus (`@`, `#`, `/`), **URL-encode** dulu.

### 1.3 Install & inisialisasi Prisma (di folder `backend/`)
```bash
npm install prisma --save-dev
npm install @prisma/client
npx prisma init --datasource-provider postgresql
```
- Ganti isi `prisma/schema.prisma` dengan schema lengkap di **`docs/ERD.md` §5**.
- Pastikan `url = env("DATABASE_URL")`.

### 1.4 Tes koneksi & migrasi
```bash
npx prisma validate
npx prisma migrate dev --name init
npx prisma generate
```
Jika berhasil, tabel ada di Aiven (cek di Aiven console, atau `npx prisma studio`).

### 1.5 Tambah CHECK constraint
Ikuti `docs/ERD.md` §3 (`--create-only`, tempel SQL, jalankan migrate).

### 1.6 Prisma client singleton — `src/lib/prisma.ts`
```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
```

### 1.7 Seed — `prisma/seed.ts`
Isi: roles, permissions, role_permissions (sesuai PRD §3), Super Admin, dan data demo (lihat `docs/ERD.md` §4). Tambahkan ke `package.json`:
```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```
```bash
npm i -D tsx
npx prisma db seed
```

### 1.8 Endpoint health check
`GET /api/v1/health` → jalankan `SELECT 1` via `prisma.$queryRaw` dan balas `{ db: "up" }`.

### Troubleshooting umum
| Masalah | Solusi |
|---|---|
| `P1001 can't reach database` | Cek HOST/PORT, Allowed IP di Aiven, koneksi internet |
| `P1011 / SSL error` | Pastikan `?sslmode=require` ada di URL |
| `P1000 auth failed` | Password salah / belum di-URL-encode |
| `permission denied to create database` (shadow DB) | Gunakan `npx prisma db push` untuk dev awal, atau buat database kedua dan set `shadowDatabaseUrl` |
| Koneksi habis di free tier | Batasi pool: tambahkan `&connection_limit=5` pada URL |

**DoD Fase 1:** `prisma migrate` sukses · seed sukses · `/health` mengembalikan `db: up` · tabel terlihat di Prisma Studio.

**Prompt untuk AI agent:**
> Baca `AGENTS.md` dan `docs/ERD.md`. Kerjakan FASE 1 di `docs/GUIDE.md`: install Prisma di folder backend, pasang schema dari ERD.md, hubungkan ke `DATABASE_URL` Aiven (sudah ada di `.env`), buat migration `init` + migration CHECK constraint, buat `src/lib/prisma.ts`, tulis `prisma/seed.ts` (roles, permissions, role_permissions sesuai PRD §3, 1 super admin dari env, data demo), dan endpoint `/api/v1/health`. Jalankan dan tunjukkan hasilnya. Berhenti setelah DoD terpenuhi.

---

## FASE 2 — Fondasi Backend

**Langkah**
1. Install: `express cors helmet morgan zod bcrypt jsonwebtoken cookie-parser express-rate-limit dotenv node-cron nodemailer qrcode midtrans-client nanoid` + types (`@types/*`).
2. `src/config/env.ts` — validasi env dengan Zod (gagal start bila ada yang kurang).
3. `src/config/constants.ts`:
   ```ts
   export const ORDER_EXPIRY_MINUTES = 15;
   export const POINT_EARN_PER_RUPIAH = 10_000;  // 1 poin tiap Rp10.000
   export const POINT_VALUE_RUPIAH = 100;        // 1 poin = Rp100
   export const MAX_POINT_DISCOUNT_RATIO = 0.5;  // maks 50% subtotal
   ```
4. `AppError`, `asyncHandler`, `errorHandler`, helper response `ok()` / `fail()`.
5. Middleware: `validate(schema)`, rate limiter, CORS (whitelist `APP_URL`), helmet.
6. `app.ts` (tanpa listen) dan `server.ts` (listen) dipisah agar mudah dites.

**DoD:** server jalan, error terformat konsisten, env tervalidasi.

**Prompt:** *"Kerjakan FASE 2 di docs/GUIDE.md sesuai konvensi AGENTS.md §7–8."*

---

## FASE 3 — Auth & RBAC

**Langkah**
1. `POST /auth/register` (role CUSTOMER), `/login`, `/refresh`, `/logout`, `GET/PATCH /me`.
2. JWT access (15m) memuat `sub`, `role`. Refresh token acak, **simpan hash** di `refresh_tokens`, rotasi tiap refresh.
3. Middleware `authenticate` (wajib login), `optionalAuth` (untuk checkout: kalau ada token → member, kalau tidak → guest), dan `authorize('permission.code')` yang memeriksa `role_permissions` (cache di memori per role).
4. Suspended user tidak bisa login.
5. `Super Admin` membuat akun staff: `POST /admin/users` (role EVENT_MANAGER / GATE_OFFICER).
6. Reset password & verifikasi email (kirim via mailer; boleh dikerjakan setelah Fase 8 bila mailer belum siap).

**DoD:** login 4 role berhasil · endpoint terlindungi mengembalikan 401/403 yang benar · tes manual via REST client.

**Prompt:** *"Kerjakan FASE 3. Gunakan permission code dari seed, bukan hardcode nama role. Buat `authenticate`, `optionalAuth`, `authorize`. Tunjukkan contoh request/response."*

---

## FASE 4 — Event & Kategori Tiket (Event Manager)

**Langkah**
1. CRUD event di `/manage/events` — Event Manager hanya boleh event miliknya (`createdById`), Super Admin semua.
2. Slug otomatis dari judul (unik).
3. Transisi status: `DRAFT → PUBLISHED → ONGOING → FINISHED`, `CANCELLED` kapan saja. Publish butuh minimal 1 kategori aktif.
4. CRUD `ticket_categories`: validasi `quota >= sold + reserved`, `price >= 0`.
5. Delete = soft delete (`deletedAt`), ditolak bila ada order PAID.
6. Assign/unassign Gate Officer (`event_staff`).
7. Upload poster: MVP cukup field URL; opsional `multer` ke `/uploads`.
8. Audit log pada aksi create/update/delete.

**DoD:** Event Manager A tidak bisa mengubah event Event Manager B (uji IDOR) · validasi kuota berjalan.

**Prompt:** *"Kerjakan FASE 4 dengan pengecekan kepemilikan di setiap endpoint /manage/*."*

---

## FASE 5 — Katalog Publik

**Langkah**
- `GET /events` : hanya `PUBLISHED`, `deletedAt null`, filter `q`, `city`, `from/to`, pagination, urut `startAt`.
- `GET /events/:slug` : sertakan kategori + `available = quota - sold - reserved` + `saleState` (`UPCOMING | ON_SALE | SOLD_OUT | CLOSED`).
- Jangan bocorkan data internal (createdBy, staff).

**DoD:** response publik tanpa auth, tanpa field sensitif.

**Prompt:** *"Kerjakan FASE 5."*

---

## FASE 6 — Checkout & Reservasi Stok

**Request `POST /orders`** (auth opsional):
```json
{
  "eventId": "uuid",
  "items": [{ "ticketCategoryId": "uuid", "quantity": 2 }],
  "buyer": { "name": "Budi", "email": "budi@mail.com", "phone": "081234567890" },
  "voucherCode": "HEMAT10",
  "pointsToUse": 0
}
```
**Aturan:**
- Member (ada token): `buyer` diambil dari profil (boleh di-override email/telepon). Guest: `buyer.name/email/phone` **wajib** (Zod).
- `pointsToUse` & voucher member-only hanya diproses bila login; guest → abaikan/tolak dengan error jelas.

**Langkah dalam SATU `prisma.$transaction`:**
1. Ambil event (harus `PUBLISHED`) & kategori; cek periode jual, `maxPerOrder`.
2. **Reserve atomik** per kategori:
   ```ts
   const updated = await tx.$executeRaw`
     UPDATE ticket_categories
     SET reserved = reserved + ${qty}
     WHERE id = ${categoryId}
       AND "isActive" = true
       AND sold + reserved + ${qty} <= quota`;
   if (updated === 0) throw new AppError('INSUFFICIENT_STOCK', 'Tiket tidak mencukupi', 409);
   ```
3. Hitung `subtotal` dari harga DB. Validasi voucher → `discountAmount`. Validasi poin (saldo cukup, ≤ 50% subtotal) → potong poin (ledger `REDEEM`, kurangi `pointBalance`).
4. `totalAmount = max(0, subtotal - discount - pointsUsed * 100)`.
5. Buat `orders` (`orderCode` mis. `ETX-YYMMDD-XXXXXX`, `accessToken` = `nanoid(32)`, `expiresAt = now + 15m`) + `order_items`; catat `voucher_redemptions` & naikkan `vouchers.used`.
6. Kembalikan `{ orderCode, accessToken, totalAmount, expiresAt }`.

**Cron `jobs/expireOrders.ts`** (tiap 1 menit): cari `PENDING` & `expiresAt < now` → set `EXPIRED`, kurangi `reserved`, kembalikan poin (ledger `REFUND`), batalkan redemption voucher. Harus aman dijalankan berulang.

**DoD:** uji 2 request paralel merebut 1 tiket terakhir → hanya 1 berhasil · order lewat 15 menit otomatis EXPIRED & stok kembali.

**Prompt:** *"Kerjakan FASE 6. Hitung semua harga di server. Gunakan transaksi + UPDATE bersyarat untuk stok. Tulis juga skrip tes concurrency sederhana."*

---

## FASE 7 — Midtrans Sandbox + Webhook

### 7.1 Buat transaksi Snap — `POST /orders/:orderCode/pay`
Akses: pemilik order **atau** pemegang `accessToken`. Order harus `PENDING` & belum expired.

```ts
import midtransClient from 'midtrans-client';

export const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: env.MIDTRANS_SERVER_KEY,
  clientKey: env.MIDTRANS_CLIENT_KEY,
});

const midtransOrderId = `${order.orderCode}-${attempt}`; // attempt = jumlah payment + 1

const trx = await snap.createTransaction({
  transaction_details: { order_id: midtransOrderId, gross_amount: order.totalAmount },
  customer_details: { first_name: order.buyerName, email: order.buyerEmail, phone: order.buyerPhone },
  item_details: items.map(i => ({ id: i.categoryId, price: i.unitPrice, quantity: i.quantity, name: i.name.slice(0, 50) })),
  expiry: { unit: 'minutes', duration: minutesLeft },
  callbacks: { finish: `${env.APP_URL}/orders/${order.orderCode}?token=${order.accessToken}` },
});
// simpan payment: { midtransOrderId, snapToken: trx.token, redirectUrl: trx.redirect_url, grossAmount, status: 'PENDING' }
```
> Catatan: bila ada diskon/poin, `item_details` harus **berjumlah sama** dengan `gross_amount`. Tambahkan 1 item negatif "Diskon" agar total cocok, atau cukup kirim 1 item ringkasan.

### 7.2 Frontend memakai Snap
Muat script sandbox: `https://app.sandbox.midtrans.com/snap/snap.js` dengan `data-client-key=VITE_MIDTRANS_CLIENT_KEY`, lalu:
```ts
window.snap.pay(snapToken, {
  onSuccess: () => navigate(`/orders/${code}?token=${token}`), // HANYA navigasi, bukan penerbitan tiket
  onPending: () => navigate(`/orders/${code}?token=${token}`),
  onError:   () => toast.error('Pembayaran gagal'),
  onClose:   () => toast('Pembayaran belum diselesaikan'),
});
```

### 7.3 Webhook — `POST /payments/midtrans/notification`
1. Verifikasi signature:
   ```ts
   import crypto from 'crypto';
   const expected = crypto.createHash('sha512')
     .update(order_id + status_code + gross_amount + env.MIDTRANS_SERVER_KEY)
     .digest('hex');
   if (expected !== signature_key) return res.status(403).end();
   ```
2. Cari `payments.midtransOrderId = order_id`; cocokkan `gross_amount`.
3. Simpan `rawNotification`, `paymentType`, `transactionId`, `fraudStatus`.
4. Mapping:
   | `transaction_status` | Aksi |
   |---|---|
   | `settlement` | PAID |
   | `capture` + `fraud_status = accept` | PAID |
   | `pending` | tetap PENDING |
   | `deny`, `failure` | FAILED + release stok/poin |
   | `cancel` | CANCELLED + release |
   | `expire` | EXPIRED + release |
5. **Idempotent:** jika order sudah `PAID`, balas `200` tanpa aksi.
6. Saat PAID (satu transaksi DB): order `PAID` + `paidAt`, payment `SETTLEMENT`, `reserved → sold`, buat tiket (Fase 8), poin `EARN` untuk member (`floor(total/10000)`).
7. Kirim email **setelah** transaksi commit (agar kegagalan email tidak membatalkan pembayaran).
8. Selalu balas **200** jika signature valid (agar Midtrans tidak spam retry), kecuali error server sungguhan.

### 7.4 Endpoint fallback `POST /orders/:orderCode/sync`
Panggil `snap.transaction.status(midtransOrderId)` lalu proses dengan fungsi yang **sama** dengan webhook (satu service `handleMidtransStatus()`). Dipanggil saat user kembali ke halaman status atau polling berulang.

### 7.5 Mengetes webhook di lokal
```bash
ngrok http 4000
```
Di dashboard Midtrans Sandbox → *Settings → Configuration* → **Payment Notification URL**:
`https://<id>.ngrok-free.app/api/v1/payments/midtrans/notification`

Kartu tes sandbox: `4811 1111 1111 1114`, CVV `123`, expiry bulan/tahun masa depan, OTP `112`. Untuk VA/QRIS/e-wallet gunakan **Midtrans Payment Simulator** di dokumentasi sandbox.

**DoD:** bayar via sandbox → order jadi PAID otomatis tanpa aksi manual · kirim ulang webhook yang sama tidak menggandakan tiket · signature palsu ditolak 403.

**Prompt:** *"Kerjakan FASE 7. Buat satu service `handleMidtransStatus` yang dipakai oleh webhook DAN endpoint sync. Pastikan idempotent dan signature diverifikasi. Jangan terbitkan tiket dari request frontend."*

---

## FASE 8 — Tiket, QR & Email Otomatis

**Generate tiket** (di dalam transaksi PAID), per kuantitas di tiap `order_item`:
```ts
import { randomBytes } from 'crypto';
import { customAlphabet } from 'nanoid';

const codeGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);
ticketCode = `ETX-${codeGen()}`;        // mudah dibaca, untuk input manual
qrToken    = randomBytes(24).toString('base64url'); // isi QR, tidak bisa ditebak
```
Isi QR = **`qrToken` saja** (opsional prefix `ETX1:`). Jangan taruh data pribadi di QR.

**QR → PNG:**
```ts
import QRCode from 'qrcode';
const png = await QRCode.toBuffer(qrToken, { width: 400, margin: 2, errorCorrectionLevel: 'M' });
```

**Email (`lib/mailer.ts`, Nodemailer):**
- Subjek: `Tiket Anda untuk {event} — {orderCode}`
- Isi: ringkasan order, nama event, venue, tanggal (WIB), daftar tiket (kategori + kode), **QR per tiket** (lampiran + `cid` inline), tombol **"Lihat Tiket Online"** → `${APP_URL}/tickets/view?token=${accessToken}`, ajakan "Daftar akun untuk dapat poin" (jika guest).
- Retry hingga 3x dengan jeda; catat setiap hasil di `email_logs`.
- Endpoint `POST /orders/:orderCode/resend-email`.

**Halaman tiket by token:** `GET /tickets/by-token?token=` → daftar tiket + `qrToken`. Frontend merender QR dengan library (mis. `qrcode.react`).

**DoD:** setelah bayar sandbox, email masuk (Mailtrap/inbox) berisi QR yang bisa discan · `email_logs` tercatat · kegagalan SMTP tidak menggagalkan order.

**Prompt:** *"Kerjakan FASE 8: generate tiket dalam transaksi PAID, mailer dengan template HTML responsif, QR PNG attachment+inline, email_logs, resend endpoint, dan GET /tickets/by-token."*

---

## FASE 9 — Fitur Member

**Langkah**
1. `GET /me/orders`, `/me/orders/:code`, `/me/tickets`, `/me/points` (saldo + ledger, paginated).
2. `POST /vouchers/validate` — kembalikan potongan terhitung tanpa membuat order.
3. **Klaim order guest:** saat email diverifikasi (atau saat register bila memakai verifikasi instan di MVP), `UPDATE orders SET userId = :id WHERE userId IS NULL AND buyerEmail = :email`.
4. CRUD voucher di `/manage/vouchers`.
5. Pastikan poin diberikan **sekali** per order (cek ledger `EARN` untuk `orderId` sebelum menambah).

**DoD:** member melihat riwayat & tiket · poin bertambah setelah PAID, berkurang saat redeem, kembali bila order expired.

**Prompt:** *"Kerjakan FASE 9."*

---

## FASE 10 — Gate Officer: API Scan

**Langkah**
1. `GET /gate/events` — event yang ada di `event_staff` user & status `PUBLISHED/ONGOING`.
2. `POST /gate/scan` `{ eventId, qrToken }`:
   - Cek officer ditugaskan di `eventId` → else 403.
   - Cari ticket by `qrToken` (trim input). Tidak ada → `INVALID`.
   - `ticket.eventId !== eventId` → `WRONG_EVENT`. `CANCELLED` → `CANCELLED`.
   - Tandai terpakai **atomik**:
     ```ts
     const r = await tx.ticket.updateMany({
       where: { id: ticket.id, status: 'ACTIVE' },
       data: { status: 'USED', usedAt: new Date() },
     });
     // r.count === 1 → VALID, selain itu → ALREADY_USED
     ```
   - Selalu tulis `ticket_scans` (semua hasil).
3. Response berisi: `result`, `ticketCode`, `categoryName`, `holderName/buyerName`, dan bila `ALREADY_USED`: `usedAt` + nama petugas sebelumnya.
4. `POST /gate/scan-manual` `{ eventId, ticketCode }` dengan logika sama.
5. `GET /gate/events/:id/stats` → `{ totalTickets, checkedIn, remaining }`.
6. Rate-limit longgar (scan cepat), tetapi tetap ada.

**DoD:** scan pertama VALID, kedua ALREADY_USED · QR event lain → WRONG_EVENT · scan paralel hanya 1 yang VALID.

**Prompt:** *"Kerjakan FASE 10. Gunakan updateMany dengan kondisi status ACTIVE untuk mencegah race condition."*

---

## FASE 11 — Super Admin: Monitoring

**Langkah**
1. `GET /admin/orders` — filter `status`, `eventId`, `from/to`, `paymentType`, search `q` (orderCode/email/telepon), paginated. **Read-only.**
2. `GET /admin/orders/:id` — order + items + payments (termasuk `rawNotification`) + tickets + email logs.
3. `GET /admin/dashboard` — total revenue (order PAID), jumlah order per status, tiket terjual, top event, tren 30 hari (group by date).
4. `CRUD /admin/users`, `/admin/roles`, `/admin/permissions` (assign permission ke role + invalidasi cache). Nama role tetap mengikuti enum Prisma; role baru tidak dapat dibuat tanpa migrasi.
5. `GET /admin/email-logs` + resend, `GET /admin/audit-logs`.
6. Pastikan **tidak ada** endpoint yang mengubah status pembayaran.

**DoD:** hanya Super Admin yang dapat mengakses · angka dashboard sesuai data.

**Prompt:** *"Kerjakan FASE 11. Semua endpoint monitoring read-only, kecuali user/role/permission dan resend email."*

---

## FASE 12 — Frontend Web (Vite + TS)

**Rekomendasi stack FE** (bila belum ada): React Router, TanStack Query, axios, Zod + React Hook Form, Tailwind CSS, `qrcode.react`.

**Langkah**
1. Struktur: `src/api/` (axios + interceptor refresh token), `src/features/*`, `src/routes/` (guard per role), `src/components/`, `src/pages/`.
2. Auth store (access token di memori; refresh token httpOnly cookie atau storage — pilih satu dan konsisten).
3. **Halaman publik dulu:** Beranda, Daftar Event, Detail Event.
4. **Checkout:** form Guest (nama, email, telepon; konfirmasi email) / Member (prefilled), ringkasan harga dari server, tombol Bayar → `snap.pay`. Tampilkan countdown `expiresAt`.
5. **Status order:** polling `/orders/:code/status` tiap 3 detik (maks beberapa menit) + tombol "Cek status pembayaran" yang memanggil `/sync`. Saat PAID → tampilkan tiket + QR.
6. **Tiket by token** (`/tickets/view?token=`), **Cek Pesanan** (kode + email).
7. **Area Member:** riwayat, tiket saya, poin, voucher.
8. **Dashboard Event Manager** & **Dashboard Super Admin** (tabel + filter + grafik sederhana).
9. Guard route: `RequireRole` + redirect.
10. UX: loading/empty/error state, format Rupiah `Intl.NumberFormat('id-ID')`, tanggal WIB.

**DoD:** alur Guest dari pilih tiket sampai melihat QR berjalan end-to-end di sandbox.

**Prompt:** *"Kerjakan FASE 12 bertahap per grup halaman (publik → checkout → member → event manager → super admin). Berhenti dan minta konfirmasi di tiap grup."*

---

## FASE 13 — Mobile Expo

**Paket:** `expo-camera` (scanner via `CameraView` + `barcodeScannerSettings`), `expo-secure-store` (token), `expo-haptics`, `expo-router` atau React Navigation, `@tanstack/react-query`, `react-native-qrcode-svg`.

**Langkah**
1. Konfigurasi `EXPO_PUBLIC_API_URL` memakai **IP LAN laptop** (atau ngrok).
2. Login + simpan token di `SecureStore`; routing berdasar role (GATE_OFFICER → modul Gate, CUSTOMER → modul tiket).
3. **Gate:** pilih event → scanner layar penuh:
   ```tsx
   <CameraView
     style={{ flex: 1 }}
     barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
     onBarcodeScanned={locked ? undefined : onScan}
   />
   ```
   - Kunci scanner sesaat setelah scan (hindari scan ganda), kirim ke `/gate/scan`, tampilkan **layar hasil penuh** (hijau VALID, kuning ALREADY_USED, merah INVALID) + getar/suara, otomatis kembali ke scanner setelah ±2 detik.
   - Tombol input manual `ticketCode`, statistik masuk/total.
4. **Customer (opsional MVP):** Tiket Saya (QR besar + brightness tinggi), riwayat order.
5. Tangani kamera ditolak (permission) & offline (pesan jelas).

**DoD:** scan QR dari email/web di HP fisik → hasil benar sesuai Fase 10.

**Prompt:** *"Kerjakan FASE 13 modul Gate Officer dulu, tes di Expo Go, lalu modul Customer."*

---

## FASE 14 — Testing, Hardening, Deploy

**Tes wajib (otomatis bila bisa: Vitest/Jest + Supertest)**
- Signature webhook valid/invalid · webhook ganda (idempotent) · gross_amount tidak cocok.
- Concurrency stok (N request vs sisa 1 tiket).
- Expire order mengembalikan stok & poin.
- Scan: valid, dobel, event salah, tiket batal, paralel.
- IDOR: Event Manager A vs B, member A melihat order member B, guest tanpa token.
- Guest tidak bisa memakai poin / voucher member-only.

**Hardening:** helmet, CORS whitelist, rate-limit (login, order, scan, lookup), validasi Zod di semua input, sanitasi log, secret hanya di env, HTTPS di produksi, backup DB (Aiven menyediakan).

**Deploy (saran):** BE → Render/Railway/VPS · FE → Vercel/Netlify · DB tetap Aiven (batasi Allowed IP ke IP server) · Mobile → EAS Build. Ubah Payment Notification URL Midtrans ke domain produksi (tetap Sandbox).

**Prompt:** *"Kerjakan FASE 14: tulis tes untuk daftar di atas, perbaiki bug yang ditemukan, dan buat README deploy."*

---

## Lampiran A — Template Prompt Harian ke AI Agent

```
Konteks: baca AGENTS.md dan dokumen docs/ yang relevan.
Tugas: kerjakan FASE <N> di docs/GUIDE.md.
Aturan: ikuti aturan bisnis kritis di AGENTS.md §5, jangan ubah skema DB tanpa migration,
        tanya bila ada yang ambigu, jalankan & tunjukkan bukti DoD, lalu berhenti.
```

## Lampiran B — Checklist Rilis MVP

- [ ] Guest beli → bayar sandbox → email + QR masuk, tanpa approval admin
- [ ] Member beli → poin bertambah → riwayat tampil
- [ ] Redeem poin & voucher menghitung benar di server
- [ ] Tidak ada overselling (tes paralel lulus)
- [ ] Order expired mengembalikan stok & poin
- [ ] Gate scan: VALID / ALREADY_USED / INVALID / WRONG_EVENT benar
- [ ] Super Admin hanya monitoring (tidak ada approve manual)
- [ ] Secret tidak ada di repo / bundle FE / mobile
- [ ] Webhook signature & idempotency teruji
