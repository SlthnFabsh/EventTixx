# FLOW — EventTixx

Semua diagram memakai Mermaid. Render di GitHub / VS Code / https://mermaid.live

---

## 1. Arsitektur Sistem

```mermaid
flowchart LR
    subgraph Client
        WEB[Web - Vite TS<br/>Guest, Member, Event Manager, Super Admin]
        MOB[Mobile - Expo<br/>Gate Officer, Member]
    end
    subgraph Server
        API[Express API /api/v1]
        CRON[Cron Job<br/>expire order]
        MAIL[Mailer<br/>Nodemailer]
    end
    DB[(PostgreSQL Aiven)]
    MID[Midtrans Sandbox<br/>Snap + Notification]
    SMTP[SMTP Provider]

    WEB -->|REST| API
    MOB -->|REST| API
    API --> DB
    CRON --> DB
    API -->|create Snap transaction| MID
    MID -->|Webhook notification| API
    API --> MAIL --> SMTP
    SMTP -->|Email + QR| USER((Customer))
    WEB -.Snap popup.-> MID
```

---

## 2. Alur Pembelian Tiket (Guest & Member)

```mermaid
flowchart TD
    A([Buka halaman event]) --> B[Pilih kategori tiket & jumlah]
    B --> C{Sudah login?}
    C -- Ya Member --> D[Data otomatis dari profil<br/>Opsional: pakai poin / voucher]
    C -- Tidak Guest --> E[Isi nama, email, nomor telepon<br/>Opsional: voucher umum<br/>Atau pilih Login / Daftar]
    D --> F[Klik Bayar]
    E --> F
    F --> G[POST /orders<br/>Server validasi & hitung total]
    G --> H{Stok cukup?}
    H -- Tidak --> X1[Tampilkan 'Tiket habis / tidak cukup']
    H -- Ya --> I[Reserve stok + buat order PENDING<br/>expiresAt = +15 menit]
    I --> J[POST /orders/:code/pay<br/>Server buat Snap token Midtrans]
    J --> K[Frontend buka popup Snap]
    K --> L{Pembayaran?}
    L -- Sukses --> M[Midtrans kirim Webhook]
    L -- Pending --> N[Menunggu pembayaran<br/>VA / QRIS dll]
    N --> M
    L -- Gagal / Tutup --> O[Order tetap PENDING sampai expired<br/>atau user bayar ulang]
    M --> P[Server verifikasi signature<br/>Order jadi PAID]
    P --> Q[Generate tiket + QR otomatis]
    Q --> R[Kirim email tiket + QR]
    R --> S([Halaman Status: Tiket Siap<br/>Lihat tiket / Cek email])
    O --> T{Lewat 15 menit?}
    T -- Ya --> U[Cron: order EXPIRED<br/>stok & poin dikembalikan]
```

---

## 3. Sequence — Checkout Guest sampai Tiket Terkirim

```mermaid
sequenceDiagram
    autonumber
    actor G as Guest
    participant FE as Web (Vite)
    participant BE as Express API
    participant DB as PostgreSQL
    participant MT as Midtrans Sandbox
    participant ML as SMTP

    G->>FE: Pilih tiket + isi nama/email/telepon
    FE->>BE: POST /orders {eventId, items, buyer}
    BE->>DB: BEGIN; lock kategori; cek stok
    BE->>DB: reserved += qty; insert order(PENDING) + items
    BE->>DB: COMMIT
    BE-->>FE: {orderCode, accessToken, totalAmount}
    FE->>BE: POST /orders/:code/pay
    BE->>MT: Snap createTransaction(order_id, gross_amount, customer, expiry)
    MT-->>BE: {token, redirect_url}
    BE->>DB: insert payment(PENDING, snapToken)
    BE-->>FE: {snapToken}
    FE->>MT: snap.pay(snapToken) (popup)
    G->>MT: Bayar (sandbox)
    MT-->>BE: POST /payments/midtrans/notification
    BE->>BE: Verifikasi signature_key & gross_amount
    BE->>DB: BEGIN; order PAID; reserved->sold; payment SETTLEMENT
    BE->>DB: insert tickets (qrToken acak) ; COMMIT
    BE->>ML: Kirim email (QR + link tiket)
    BE->>DB: email_logs SENT/FAILED
    BE-->>MT: 200 OK
    FE->>BE: Polling GET /orders/:code/status
    BE-->>FE: {status: PAID}
    FE-->>G: Tampilkan "Pembayaran berhasil, tiket dikirim ke email"
```

---

## 4. Penanganan Webhook Midtrans (Idempotent)

```mermaid
flowchart TD
    A([POST notification dari Midtrans]) --> B[Hitung SHA512 order_id+status_code+gross_amount+ServerKey]
    B --> C{signature_key cocok?}
    C -- Tidak --> X[403 Abaikan + log]
    C -- Ya --> D[Cari payment by midtransOrderId]
    D --> E{Ditemukan?}
    E -- Tidak --> X2[404 / log]
    E -- Ya --> F{gross_amount sama dengan DB?}
    F -- Tidak --> X3[Tolak + audit log]
    F -- Ya --> G[Simpan rawNotification]
    G --> H{transaction_status}
    H -- settlement atau capture+accept --> I{Order sudah PAID?}
    I -- Ya --> J[Idempotent: 200 OK tanpa aksi]
    I -- Tidak --> K[TRANSAKSI DB:<br/>order PAID, payment SETTLEMENT<br/>reserved→sold, buat tiket<br/>poin EARN untuk member]
    K --> L[Kirim email tiket<br/>di luar transaksi]
    H -- pending --> M[Update payment PENDING]
    H -- expire --> N[Order EXPIRED<br/>release stok & poin]
    H -- deny / cancel / failure --> O[Order FAILED atau CANCELLED<br/>release stok & poin]
    L --> Z([200 OK])
    J --> Z
    M --> Z
    N --> Z
    O --> Z
```

---

## 5. Status Order (State Machine)

```mermaid
stateDiagram-v2
    [*] --> PENDING: Order dibuat (stok direserve)
    PENDING --> PAID: Webhook settlement/capture
    PENDING --> EXPIRED: Lewat expiresAt / Midtrans expire
    PENDING --> FAILED: deny / failure
    PENDING --> CANCELLED: cancel oleh user / Midtrans
    PAID --> REFUNDED: Refund (fase lanjutan)
    EXPIRED --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
    REFUNDED --> [*]
    PAID --> [*]
```

## 5b. Status Tiket

```mermaid
stateDiagram-v2
    [*] --> ACTIVE: Order PAID
    ACTIVE --> USED: Scan VALID di gate
    ACTIVE --> CANCELLED: Refund / event dibatalkan
    USED --> [*]
    CANCELLED --> [*]
```

---

## 6. Alur Scan Gate Officer (Mobile)

```mermaid
flowchart TD
    A([Gate Officer login di app]) --> B[Pilih event yang ditugaskan]
    B --> C[Buka kamera scanner]
    C --> D[Scan QR -> dapat qrToken]
    D --> E[POST /gate/scan {eventId, qrToken}]
    E --> F{Officer ditugaskan<br/>di event ini?}
    F -- Tidak --> X0[403 Forbidden]
    F -- Ya --> G{Tiket dengan qrToken ada?}
    G -- Tidak --> R1[INVALID ❌<br/>log scan]
    G -- Ya --> H{ticket.eventId = eventId?}
    H -- Tidak --> R2[WRONG_EVENT ❌]
    H -- Ya --> I{Status tiket}
    I -- CANCELLED --> R3[CANCELLED ❌]
    I -- USED --> R4[ALREADY_USED ⚠️<br/>tampilkan waktu & petugas sebelumnya]
    I -- ACTIVE --> J[TRANSAKSI: UPDATE tickets SET USED<br/>WHERE id AND status=ACTIVE]
    J --> K{Baris ter-update = 1?}
    K -- Tidak, race condition --> R4
    K -- Ya --> R5[VALID ✅<br/>tampilkan kategori & pemegang]
    R1 --> L[Catat ticket_scans]
    R2 --> L
    R3 --> L
    R4 --> L
    R5 --> L
    L --> C
```

---

## 7. Reservasi & Pengembalian Stok

```mermaid
sequenceDiagram
    participant API as Express API
    participant DB as PostgreSQL
    participant CR as Cron (tiap 1 menit)

    Note over API,DB: Saat order dibuat
    API->>DB: UPDATE ticket_categories SET reserved = reserved + :qty<br/>WHERE id = :id AND sold + reserved + :qty <= quota
    DB-->>API: rowCount (0 = stok tidak cukup → batal)

    Note over API,DB: Saat PAID
    API->>DB: SET reserved = reserved - :qty, sold = sold + :qty

    Note over CR,DB: Order kadaluarsa
    CR->>DB: SELECT orders WHERE status=PENDING AND expiresAt < now()
    CR->>DB: order EXPIRED; reserved = reserved - :qty; poin dikembalikan
```

---

## 8. Alur Registrasi Member & Klaim Order Guest

```mermaid
flowchart TD
    A([Guest klik Daftar]) --> B[Isi nama, email, telepon, password]
    B --> C[POST /auth/register<br/>role = CUSTOMER]
    C --> D[Kirim email verifikasi]
    D --> E[User klik link verifikasi]
    E --> F[emailVerifiedAt terisi]
    F --> G{Ada order Guest dengan<br/>buyerEmail sama & userId NULL?}
    G -- Ya --> H[UPDATE orders SET userId = user.id<br/>riwayat & tiket muncul di akun]
    G -- Tidak --> I([Selesai])
    H --> I
```

---

## 9. Hak Akses per Role (Navigasi)

```mermaid
flowchart LR
    subgraph Publik
        P1[Lihat event] --> P2[Checkout Guest]
        P2 --> P3[Tiket via link email]
    end
    subgraph Member
        M1[Riwayat transaksi]
        M2[Tiket Saya]
        M3[Poin & Redeem]
    end
    subgraph EventManager[Event Manager]
        E1[CRUD Event]
        E2[CRUD Kategori Tiket]
        E3[Voucher]
        E4[Laporan penjualan event]
        E5[Assign Gate Officer]
    end
    subgraph Gate[Gate Officer - Mobile]
        G1[Scan QR]
        G2[Validasi masuk]
        G3[Statistik kehadiran]
    end
    subgraph SA[Super Admin]
        S1[Kelola User / Role / Permission]
        S2[Monitoring semua transaksi - READ ONLY]
        S3[Dashboard & Audit log]
        S4[Email log & resend]
    end
```

---

## 10. Daftar Endpoint API (ringkas)

Prefix `/api/v1`. 🔓 publik · 🔐 perlu login · 🛡 perlu permission tertentu.

### Auth
| Method | Path | Akses |
|---|---|---|
| POST | `/auth/register` | 🔓 |
| POST | `/auth/login` | 🔓 |
| POST | `/auth/refresh` | 🔓 |
| POST | `/auth/logout` | 🔐 |
| POST | `/auth/forgot-password` · `/auth/reset-password` | 🔓 |
| GET  | `/auth/verify-email?token=` | 🔓 |
| GET  | `/me` · PATCH `/me` | 🔐 |

### Event (publik)
| GET | `/events` (search, city, date, page) | 🔓 |
| GET | `/events/:slug` | 🔓 |

### Event Management
| POST/PATCH/DELETE | `/manage/events` · `/manage/events/:id` | 🛡 `event.*` |
| GET | `/manage/events` (milik sendiri) | 🛡 |
| POST/PATCH/DELETE | `/manage/events/:id/categories` | 🛡 `ticket_category.manage` |
| POST/DELETE | `/manage/events/:id/staff` | 🛡 |
| GET | `/manage/events/:id/sales` | 🛡 `report.view_event` |
| CRUD | `/manage/vouchers` | 🛡 `voucher.manage` |

### Order & Payment
| POST | `/orders` (guest/member) | 🔓 (token opsional) |
| POST | `/orders/:orderCode/pay` | 🔓 + `accessToken` atau pemilik |
| GET | `/orders/:orderCode/status` | 🔓 + `accessToken` atau pemilik |
| POST | `/orders/:orderCode/sync` | 🔓 + `accessToken` atau pemilik |
| POST | `/orders/lookup` {orderCode, email} | 🔓 |
| GET | `/me/orders` · `/me/orders/:code` | 🔐 |
| POST | `/payments/midtrans/notification` | 🔓 **(verifikasi signature)** |

### Tiket
| GET | `/tickets/by-token?token=<accessToken>` | 🔓 (guest) |
| GET | `/me/tickets` | 🔐 |
| POST | `/orders/:orderCode/resend-email` | 🔓 + akses order |

### Poin & Voucher
| GET | `/me/points` | 🔐 |
| POST | `/vouchers/validate` {code, eventId, subtotal} | 🔓 |

### Gate
| GET | `/gate/events` (event yang ditugaskan) | 🛡 `ticket.scan` |
| POST | `/gate/scan` {eventId, qrToken} | 🛡 `ticket.scan` |
| POST | `/gate/scan-manual` {eventId, ticketCode} | 🛡 `ticket.scan` |
| GET | `/gate/events/:id/stats` | 🛡 `ticket.scan` |

### Super Admin
| CRUD | `/admin/users` | 🛡 `user.manage` |
| CRUD | `/admin/roles` · `/admin/permissions` | 🛡 `role.manage` |
| GET | `/admin/orders` (filter/search) · `/admin/orders/:id` | 🛡 `order.view_all` |
| GET | `/admin/payments` | 🛡 `order.view_all` |
| GET | `/admin/dashboard` | 🛡 `report.view_all` |
| GET | `/admin/email-logs` · POST `/admin/email-logs/:id/resend` | 🛡 |
| GET | `/admin/audit-logs` | 🛡 `audit_log.view` |

> ⚠️ **Tidak ada** endpoint approve/reject pembayaran.
