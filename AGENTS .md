# AGENTS.md — EventTixx

> File ini adalah **pintu masuk utama untuk AI agent**. Baca file ini PERTAMA, lalu baca dokumen di `docs/` sesuai kebutuhan.
> (Bisa di-copy / rename menjadi `CLAUDE.md`, `.cursorrules`, atau `.github/copilot-instructions.md` sesuai tool yang dipakai.)

## 1. Ringkasan Proyek

**EventTixx** adalah platform penjualan tiket konser online.
Pembeli bisa membeli **tanpa login (Guest)** atau **dengan akun (Member)**. Setelah bayar via **Midtrans (Sandbox)**, tiket + QR Code **otomatis** terbit dan dikirim ke email **tanpa approval manual**. Super Admin hanya **memonitor**.

## 2. Tech Stack (SUDAH di-setup, jangan ganti)

| Layer   | Teknologi                                              |
|---------|--------------------------------------------------------|
| Web FE  | Vite + React + TypeScript                              |
| Backend | Node.js + Express (TypeScript)                         |
| Database| PostgreSQL (Aiven) — **belum tersambung**, lihat GUIDE |
| ORM     | Prisma (rekomendasi, dipakai di seluruh dokumen)       |
| Mobile  | Expo (React Native + TypeScript)                       |
| Payment | Midtrans **Sandbox** (Snap)                            |
| Email   | Nodemailer (SMTP) — QR dikirim sebagai attachment/inline|

> Jika struktur folder proyek berbeda dari contoh di dokumen, **sesuaikan dengan struktur yang sudah ada**. Jangan membuat ulang proyek dari nol.

## 3. Peta Dokumen (wajib dibaca sesuai tugas)

| File | Isi | Baca ketika |
|------|-----|-------------|
| `docs/PRD.md`   | Kebutuhan produk, role, fitur, aturan bisnis | Mulai fitur baru / ragu soal perilaku |
| `docs/ERD.md`   | ERD (Mermaid) + **Prisma schema lengkap**    | Menyentuh database / model |
| `docs/FLOW.md`  | Diagram alur (checkout, payment, scan, dll)  | Menulis logika alur |
| `docs/GUIDE.md` | **Panduan langkah demi langkah per fase** + prompt | Memulai pekerjaan — ikuti URUTANNYA |

## 4. Cara Kerja Agent (WAJIB)

1. Kerjakan **berurutan per fase** di `docs/GUIDE.md`. Jangan loncat fase.
2. Sebelum mengerjakan fase: sebutkan rencana singkat, lalu eksekusi.
3. Setelah fase selesai: jalankan **Definition of Done** fase tersebut, laporkan hasilnya, lalu **berhenti dan minta konfirmasi** sebelum lanjut.
4. Jika ada hal ambigu yang tidak dijawab dokumen → **tanya**, jangan menebak untuk hal yang menyangkut uang, keamanan, atau skema DB.
5. Perubahan skema DB hanya lewat **Prisma migration**, bukan edit manual di database.
6. Jangan menambah library besar tanpa alasan; sebutkan alasannya.
7. Tulis TypeScript strict. Tanpa `any` kecuali terpaksa (beri komentar).

## 5. Aturan Bisnis Kritis (JANGAN dilanggar)

1. **Guest checkout diperbolehkan.** Guest wajib mengisi `nama`, `email`, `nomor telepon`. Guest TIDAK mendapat poin/voucher.
2. **Member** = user dengan akun (role `CUSTOMER`). Mendapat poin, riwayat transaksi, redeem diskon.
3. Order dibuat dengan status `PENDING` + `expiresAt` (default 15 menit). Stok **di-reserve** saat order dibuat, dikembalikan saat `EXPIRED/FAILED/CANCELLED`.
4. **Tiket HANYA dibuat setelah pembayaran terkonfirmasi** oleh **webhook Midtrans** (yang signature-nya valid). Tidak ada approval Super Admin.
5. Webhook harus **idempotent** (Midtrans bisa mengirim notifikasi berulang). Tiket tidak boleh terbit dobel.
6. **Jangan percaya data harga dari client.** Harga & total selalu dihitung ulang di server dari DB.
7. **Jangan percaya status pembayaran dari frontend.** Sumber kebenaran = notifikasi Midtrans / hasil query ke Midtrans API.
8. QR Code berisi **token acak yang tidak bisa ditebak** (bukan ID berurutan). Validasi dilakukan di server.
9. Satu tiket hanya bisa **di-scan valid sekali** (`ACTIVE` → `USED`). Gunakan transaksi/row-lock agar tidak race condition saat 2 petugas scan bersamaan.
10. Harga disimpan sebagai **integer Rupiah** (tanpa desimal).
11. Poin: dapat **1 poin per Rp10.000** dari total bayar (dihitung setelah order `PAID`). Tukar poin: **1 poin = Rp100** diskon, maksimal 50% subtotal. (Konstanta ada di `config`, mudah diubah.)
12. Super Admin **tidak** memiliki endpoint approve/reject transaksi. Hanya baca/monitor (+ refund manual di fase lanjutan).

## 6. Role & Hak Akses (ringkas)

| Role | Platform utama | Ringkasan |
|------|----------------|-----------|
| `SUPER_ADMIN`   | Web  | Kelola user, role, permission, monitoring semua transaksi & sistem |
| `EVENT_MANAGER` | Web  | CRUD event, kategori tiket, voucher; lihat penjualan event miliknya |
| `GATE_OFFICER`  | Mobile (Expo) | Scan QR & validasi tiket di event yang ditugaskan |
| `CUSTOMER` (Member) | Web + Mobile | Beli tiket, riwayat, tiket digital, poin, voucher |
| Guest (bukan role/akun) | Web | Beli tiket tanpa akun, lihat tiket via link di email |

Detail matriks permission ada di `docs/PRD.md`.

## 7. Konvensi Kode

- **API prefix**: `/api/v1`
- **Response format** (konsisten):
  ```json
  { "success": true, "data": {}, "message": "OK" }
  { "success": false, "error": { "code": "TICKET_ALREADY_USED", "message": "..." } }
  ```
- **Validasi input**: Zod di setiap endpoint.
- **Auth**: JWT access token (15 menit) + refresh token (7 hari, disimpan hash di DB). Password pakai `bcrypt`.
- **Otorisasi**: middleware `authenticate` + `authorize(permission)` — cek berdasarkan **permission code**, bukan nama role hardcoded.
- **Penamaan**: file `kebab-case`, variabel `camelCase`, tabel DB `snake_case` (via `@@map`), enum `UPPER_SNAKE`.
- **Error**: gunakan class `AppError(code, message, httpStatus)` + global error handler.
- **Logging**: jangan log secret (server key, password, token).
- **Waktu**: simpan UTC, tampilkan WIB (Asia/Jakarta) di UI.

## 8. Struktur Folder Backend (target)

```
backend/
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts
├─ src/
│  ├─ config/        # env, constants (poin, expiry)
│  ├─ middlewares/   # authenticate, authorize, validate, errorHandler
│  ├─ modules/
│  │  ├─ auth/
│  │  ├─ users/
│  │  ├─ events/
│  │  ├─ ticket-categories/
│  │  ├─ orders/
│  │  ├─ payments/    # midtrans service + webhook
│  │  ├─ tickets/     # generate, qr, my tickets
│  │  ├─ gate/        # scan & validate
│  │  ├─ points/
│  │  ├─ vouchers/
│  │  └─ admin/       # monitoring
│  ├─ jobs/          # cron: expire order
│  ├─ lib/           # prisma client, mailer, qr, midtrans client
│  ├─ utils/
│  ├─ app.ts
│  └─ server.ts
└─ .env
```

## 9. Environment Variables

**backend/.env**
```
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:5173
API_URL=http://localhost:4000

# Aiven PostgreSQL
DATABASE_URL="postgres://avnadmin:PASSWORD@HOST:PORT/defaultdb?sslmode=require"

JWT_ACCESS_SECRET=ganti_dengan_string_acak_panjang
JWT_REFRESH_SECRET=ganti_dengan_string_acak_panjang_lain
QR_SECRET=ganti_dengan_string_acak_untuk_hmac_qr

# Midtrans SANDBOX
MIDTRANS_IS_PRODUCTION=false
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxx
MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxx

# SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM="EventTixx <no-reply@eventtixx.com>"
```

**frontend/.env**
```
VITE_API_URL=http://localhost:4000/api/v1
VITE_MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxx
```

**mobile/.env** (Expo)
```
EXPO_PUBLIC_API_URL=http://<IP-LAN-LAPTOP>:4000/api/v1
```
> Di HP fisik, `localhost` TIDAK bisa dipakai. Gunakan IP LAN laptop atau tunnel (ngrok).

## 10. Larangan

- Jangan commit `.env`, server key, atau password DB. Pastikan `.gitignore` sudah memuatnya.
- Jangan menaruh `MIDTRANS_SERVER_KEY` di frontend/mobile. Hanya **Client Key** yang boleh.
- Jangan membuat endpoint "approve pembayaran manual" untuk Super Admin.
- Jangan menerbitkan tiket dari callback frontend (`onSuccess` Snap). Tiket hanya dari webhook / verifikasi server.
- Jangan hapus data transaksi secara fisik. Gunakan status / soft delete.
