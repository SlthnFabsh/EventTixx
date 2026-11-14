# PRD — EventTixx (Product Requirements Document)

Versi: 1.0 · Status: Draft MVP · Tanggal: 9 November 2026

---

## 1. Latar Belakang & Tujuan

Pembelian tiket konser sering terhambat karena **wajib registrasi**, proses konfirmasi lambat, dan tiket fisik rawan palsu. EventTixx menyelesaikan ini dengan:

1. **Checkout tanpa akun** (Guest) agar konversi tinggi.
2. **Keuntungan tambahan untuk Member** (poin, riwayat, diskon) untuk mendorong registrasi.
3. **Tiket digital + QR otomatis** setelah bayar, tanpa approval manual.
4. **Validasi di pintu masuk** lewat scan QR (aplikasi mobile Gate Officer).

### Tujuan terukur (MVP)
- Alur beli (pilih tiket → bayar → terima QR) selesai < 3 menit.
- Tiket terkirim ke email < 1 menit setelah pembayaran sukses.
- Tidak ada tiket ganda / tiket yang bisa masuk 2 kali.
- Tidak ada overselling (jumlah terjual ≤ kuota).

### Di luar cakupan MVP (Non-Goals)
- Payment production (hanya Midtrans Sandbox).
- Refund otomatis, transfer/resale tiket, seating map (pilih kursi).
- Multi-bahasa & multi-currency (hanya IDR, Bahasa Indonesia).
- Push notification.

---

## 2. Pengguna & Role

| # | Role | Punya akun? | Platform | Deskripsi |
|---|------|-------------|----------|-----------|
| 1 | **Super Admin** | Ya (seed) | Web | Mengelola seluruh user, role, permission, dan memonitor semua transaksi/sistem. **Tidak** meng-approve pembayaran. |
| 2 | **Event Manager** | Ya | Web | Membuat, mengubah, menghapus (soft), dan mengelola event serta kategori tiket & voucher. |
| 3 | **Gate Officer** | Ya | Mobile (Expo) | Scan QR tiket & validasi saat masuk konser. |
| 4a | **Member** (Customer berakun) | Ya | Web + Mobile | Melihat event, beli tiket, riwayat transaksi, tiket digital, poin, redeem diskon. |
| 4b | **Guest** (Customer tanpa akun) | Tidak | Web | Beli tiket cukup isi nama, email, telepon. Tiket diterima via email & link. |

> **Definisi:** Guest = pembeli yang tidak membuat akun. Member = pembeli yang membuat akun.
> Di database, Guest **bukan** baris di tabel `users`; datanya tersimpan di `orders` (`buyerName/Email/Phone`, `userId = null`).

---

## 3. Matriks Permission

Legenda: ✅ boleh · ❌ tidak · 🔸 terbatas (hanya miliknya / event yang ditugaskan)

| Permission code | Super Admin | Event Manager | Gate Officer | Member | Guest |
|---|:--:|:--:|:--:|:--:|:--:|
| `event.view_public` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `event.create` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `event.update` | ✅ | 🔸 | ❌ | ❌ | ❌ |
| `event.delete` | ✅ | 🔸 | ❌ | ❌ | ❌ |
| `ticket_category.manage` | ✅ | 🔸 | ❌ | ❌ | ❌ |
| `voucher.manage` | ✅ | 🔸 | ❌ | ❌ | ❌ |
| `order.create` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `order.view_own` | ✅ | ✅ | ✅ | ✅ | 🔸 (via link/token) |
| `order.view_event` | ✅ | 🔸 | ❌ | ❌ | ❌ |
| `order.view_all` (monitoring) | ✅ | ❌ | ❌ | ❌ | ❌ |
| `ticket.view_own` | ✅ | ✅ | ✅ | ✅ | 🔸 (via link/token) |
| `ticket.scan` | ❌ | ❌ | 🔸 | ❌ | ❌ |
| `point.use` | ❌ | ❌ | ❌ | ✅ | ❌ |
| `user.manage` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `role.manage` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `permission.manage` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `report.view_all` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `report.view_event` | ✅ | 🔸 | ❌ | ❌ | ❌ |
| `audit_log.view` | ✅ | ❌ | ❌ | ❌ | ❌ |

**Aturan 🔸 untuk Event Manager:** hanya event yang `createdById`-nya dirinya sendiri (Super Admin bebas).
**Aturan 🔸 untuk Gate Officer:** hanya event yang ada di tabel `event_staff` untuknya.

---

## 4. Guest vs Member

| Fitur | Guest | Member |
|---|:--:|:--:|
| Lihat event & detail | ✅ | ✅ |
| Beli tiket | ✅ (isi nama, email, telepon) | ✅ (data otomatis dari profil) |
| Bayar via Midtrans | ✅ | ✅ |
| QR & tiket via email | ✅ | ✅ |
| Lihat tiket digital di web/app | 🔸 via link `accessToken` di email | ✅ dari menu "Tiket Saya" |
| Riwayat transaksi | ❌ (hanya cek via kode order + email) | ✅ |
| Dapat poin | ❌ | ✅ |
| Redeem poin / voucher member-only | ❌ | ✅ |
| Voucher umum (non member-only) | ✅ | ✅ |

### Konversi Guest → Member
- Di halaman sukses & email tiket ada ajakan: "Daftar untuk simpan riwayat & dapatkan poin".
- Saat Guest mendaftar dengan **email yang sama** dengan order lama dan sudah **verifikasi email**, order lama (`userId = null`, `buyerEmail` sama) **di-klaim** ke akunnya. Poin untuk order lama **tidak** diberikan mundur (keputusan MVP, bisa diubah).

---

## 5. Kebutuhan Fungsional

### 5.1 Autentikasi & Akun (AUTH)
- **AUTH-1** Registrasi Member (nama, email, telepon, password). Role otomatis `CUSTOMER`.
- **AUTH-2** Login (email + password) → access + refresh token.
- **AUTH-3** Refresh token & logout (revoke).
- **AUTH-4** Lupa/reset password via email.
- **AUTH-5** Verifikasi email (dibutuhkan untuk klaim order guest).
- **AUTH-6** Akun staff (Event Manager, Gate Officer) **dibuat oleh Super Admin**, bukan registrasi publik.

### 5.2 Katalog Event (EVT) — publik
- **EVT-1** Daftar event berstatus `PUBLISHED`, dengan pencarian (judul), filter (kota, tanggal), dan pagination.
- **EVT-2** Detail event: poster, deskripsi, venue, jadwal, daftar kategori tiket + harga + sisa kuota.
- **EVT-3** Status kategori: tersedia / hampir habis / sold out / belum dibuka / ditutup.

### 5.3 Manajemen Event (EMG) — Event Manager / Super Admin
- **EMG-1** CRUD event (draft → published → finished/cancelled). Hapus = **soft delete**; event yang sudah punya order `PAID` **tidak boleh dihapus**, hanya `CANCELLED`.
- **EMG-2** CRUD kategori tiket (nama, harga, kuota, periode jual, maks per order). Kuota tidak boleh diturunkan di bawah `sold + reserved`.
- **EMG-3** Upload poster (MVP: URL gambar atau upload ke storage lokal/cloud).
- **EMG-4** Assign Gate Officer ke event.
- **EMG-5** Dashboard penjualan per event: jumlah terjual, pendapatan, kehadiran (scan).
- **EMG-6** CRUD voucher untuk event miliknya.

### 5.4 Checkout & Order (ORD)
- **ORD-1** Pilih kategori + jumlah (≤ `maxPerOrder`, ≤ sisa kuota).
- **ORD-2** Guest mengisi: nama, email, nomor telepon (validasi format; telepon Indonesia `08xx`/`+62`). Member: data prefilled dari profil.
- **ORD-3** Terapkan voucher (opsional) & poin (Member, opsional). Server menghitung total final.
- **ORD-4** Buat order `PENDING`, **reserve stok** secara atomik (transaksi + locking), `expiresAt = now + 15 menit`.
- **ORD-5** Order kadaluarsa/dibatalkan → stok dikembalikan otomatis oleh cron job.
- **ORD-6** Halaman status order (polling) setelah pembayaran: PENDING / PAID / EXPIRED / FAILED.

### 5.5 Pembayaran (PAY) — Midtrans Sandbox
- **PAY-1** Server membuat transaksi **Midtrans Snap**, mengembalikan `snapToken` + `redirectUrl`.
- **PAY-2** Frontend membuka popup Snap (client key sandbox).
- **PAY-3** **Webhook** `POST /api/v1/payments/midtrans/notification`:
  - Verifikasi `signature_key` = `SHA512(order_id + status_code + gross_amount + ServerKey)`.
  - Cocokkan `gross_amount` dengan order di DB.
  - Mapping status: `settlement`/`capture(accept)` → **PAID**; `pending` → tetap PENDING; `deny`/`cancel`/`failure` → FAILED/CANCELLED; `expire` → EXPIRED.
  - **Idempotent**.
- **PAY-4** Fallback: endpoint `GET /orders/:code/sync` yang menanyakan status langsung ke Midtrans Status API (untuk kasus webhook terlambat/sandbox lokal).
- **PAY-5** Pembayaran sukses **otomatis**: tiket dibuat, QR digenerate, email terkirim. **Tanpa approval Super Admin.**

### 5.6 Tiket Digital & Email (TIX)
- **TIX-1** Setelah `PAID`: buat 1 baris `tickets` per kuantitas, masing-masing punya `ticketCode` (mudah dibaca) & `qrToken` (acak, unik).
- **TIX-2** Generate gambar QR (PNG) dari `qrToken`.
- **TIX-3** Kirim email ke `buyerEmail`: ringkasan order, detail event, **QR tiap tiket** (inline/attachment), dan **link tiket** (`/tickets/view?token=<accessToken>`).
- **TIX-4** Pencatatan `email_logs` (QUEUED/SENT/FAILED) + tombol **kirim ulang email** (Member dari akun; Guest via halaman cek order dengan kode + email).
- **TIX-5** Halaman tiket digital (web & mobile) menampilkan QR besar, kode tiket, status (ACTIVE/USED).

### 5.7 Member (MBR)
- **MBR-1** Riwayat transaksi (filter status), detail order.
- **MBR-2** "Tiket Saya": tiket aktif & yang sudah dipakai.
- **MBR-3** Poin: saldo + riwayat mutasi poin.
- **MBR-4** Redeem poin saat checkout sebagai potongan harga.
- **MBR-5** Voucher member-only.

### 5.8 Gate / Validasi Tiket (GATE) — Mobile
- **GATE-1** Gate Officer login di app, memilih event yang ditugaskan.
- **GATE-2** Scan QR via kamera → server memvalidasi.
- **GATE-3** Hasil scan (besar & jelas, warna + suara/getar):
  - ✅ `VALID` → tiket diubah `USED`, tampilkan nama kategori & pemegang.
  - ⚠️ `ALREADY_USED` → tampilkan waktu & petugas yang scan sebelumnya.
  - ❌ `INVALID` / `WRONG_EVENT` / `CANCELLED`.
- **GATE-4** Input manual `ticketCode` bila QR rusak/kamera bermasalah.
- **GATE-5** Statistik realtime sederhana: sudah masuk / total tiket event.
- **GATE-6** Semua percobaan scan dicatat di `ticket_scans`.

### 5.9 Super Admin (ADM)
- **ADM-1** CRUD user (semua role), suspend/aktifkan.
- **ADM-2** Kelola role & permission (assign permission ke role).
- **ADM-3** **Monitoring transaksi**: daftar semua order/payment, filter (status, event, tanggal, metode bayar), pencarian (kode order/email), detail + raw log Midtrans (read-only).
- **ADM-4** Dashboard: total pendapatan, jumlah order per status, tiket terjual, event teraktif, tren harian.
- **ADM-5** Monitoring email gagal (dengan opsi resend), audit log.
- **ADM-6** **TIDAK ada** fitur approve/reject pembayaran.

---

## 6. Aturan Bisnis

| ID | Aturan |
|----|--------|
| BR-1 | Harga & total dihitung server. Client hanya kirim `ticketCategoryId` + `quantity` + kode voucher + jumlah poin. |
| BR-2 | Stok: `sold + reserved ≤ quota`. Reserve saat order dibuat; saat PAID `reserved → sold`; saat EXPIRED/FAILED/CANCELLED `reserved` dikurangi. |
| BR-3 | Timeout pembayaran: 15 menit (konfigurasi). Disinkronkan dengan `expiry` di Snap. |
| BR-4 | Maks tiket per order: sesuai `maxPerOrder` kategori (default 5). |
| BR-5 | Penjualan hanya saat `event.status = PUBLISHED` dan dalam `saleStartAt..saleEndAt`. |
| BR-6 | Poin didapat = `floor(totalAmount / 10000)`; diberikan **hanya setelah PAID**. |
| BR-7 | Redeem poin: 1 poin = Rp100, maks 50% subtotal, tidak melebihi saldo. Poin dipotong saat order dibuat (status hold), dikembalikan bila order gagal/expired. |
| BR-8 | Voucher: cek aktif, periode, kuota, minimal belanja, member-only, event-spesifik. Maks 1 voucher per order. |
| BR-9 | Total akhir minimal Rp0. Bila total = 0 (gratis penuh dengan voucher/poin), order langsung `PAID` tanpa Midtrans (opsional, fase lanjut). |
| BR-10 | Tiket `ACTIVE → USED` hanya sekali. Tidak bisa kembali ke ACTIVE. |
| BR-11 | Scan hanya valid bila `ticket.eventId` = event yang sedang dijaga & officer terdaftar di event tsb. |
| BR-12 | Email & telepon guest wajib valid; email dipakai untuk pengiriman tiket sehingga wajib dikonfirmasi di UI ("Pastikan email benar"). |
| BR-13 | Guest dapat mengakses tiket via `accessToken` panjang acak di URL (bukan kode order yang bisa ditebak). |
| BR-14 | Event yang sudah punya order PAID tidak boleh dihapus; hanya dibatalkan. |

---

## 7. Daftar Halaman / Layar

### Web (Vite)
**Publik:** Beranda · Daftar Event · Detail Event · Checkout (guest/member) · Pembayaran (Snap) · Status Order · Tiket Digital (via token) · Cek Pesanan (kode + email) · Login · Register · Lupa Password
**Member:** Profil · Riwayat Transaksi · Detail Order · Tiket Saya · Poin & Voucher
**Event Manager:** Dashboard · Daftar Event · Form Event · Kelola Kategori Tiket · Voucher · Penjualan Event · Assign Gate Officer
**Super Admin:** Dashboard · Users · Roles & Permissions · Monitoring Transaksi · Detail Transaksi · Email Logs · Audit Log

### Mobile (Expo)
**Gate Officer:** Login · Pilih Event · Scanner · Hasil Scan · Input Manual · Statistik
**Member (opsional MVP+):** Login · Event · Tiket Saya (QR) · Riwayat

---

## 8. Kebutuhan Non-Fungsional

- **Keamanan:** HTTPS (produksi), password bcrypt, JWT, rate-limit (login, checkout, scan), CORS whitelist, helmet, validasi Zod, proteksi IDOR (selalu cek kepemilikan), signature webhook, QR token acak.
- **Konsistensi data:** transaksi DB untuk reserve stok, generate tiket, dan scan.
- **Performa:** daftar event dengan pagination & index; scan < 1 detik.
- **Keandalan:** webhook idempotent, cron job expire order, email dengan retry (maks 3x) + log.
- **Observability:** log terstruktur, audit log aksi penting.
- **Privasi:** data pribadi (email/telepon) hanya terlihat oleh Super Admin & Event Manager event terkait; masking di log.
- **Responsif:** web mobile-first.

---

## 9. Metrik Keberhasilan
- Conversion rate checkout (order dibuat → PAID).
- % tiket terkirim < 1 menit.
- % guest yang jadi member.
- Error rate webhook, jumlah email gagal.
- Waktu rata-rata antrean di gate (scan per menit).

---

## 10. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Overselling saat traffic tinggi | Transaksi + `UPDATE ... WHERE sold+reserved+qty <= quota` atomik |
| Webhook tidak sampai (localhost) | Pakai ngrok/cloudflared + endpoint sync fallback |
| Webhook dobel | Idempotency check berdasar status order/payment |
| Email masuk spam / gagal | Log + resend + halaman tiket via link |
| QR difoto & dibagikan | 1x valid, tandai USED; catat scan log |
| Internet gate lemah | Mode input manual; (lanjutan: offline cache) |
| Guest salah ketik email | Konfirmasi email di UI + halaman "Cek Pesanan" + kirim ulang |

---

## 11. Roadmap

- **MVP (Fase 1–11 di GUIDE):** katalog, checkout guest/member, Midtrans sandbox, tiket+email otomatis, gate scan, admin monitoring, poin & voucher dasar.
- **v1.1:** refund manual oleh Super Admin, tiket PDF, export laporan CSV, notifikasi WhatsApp.
- **v1.2:** pilih kursi, waiting room antrean, offline scan, payment production.
