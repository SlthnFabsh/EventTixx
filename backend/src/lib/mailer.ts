import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import { EmailStatus, OrderStatus } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from './prisma';
import { escapeHtml } from './mailer.logic';
import { AppError } from '../utils/app-error';

const getSafeErrorMessage = (error: unknown): string => {
  let message =
    error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
  for (const secret of [env.SMTP_PASS, env.SMTP_USER]) {
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  return message.slice(0, 1000);
};

const createTransporter = () => {
  if (!env.SMTP_HOST) {
    throw new AppError(
      'EMAIL_NOT_CONFIGURED',
      'Konfigurasi SMTP belum tersedia',
      503,
    );
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) {
    throw new AppError(
      'EMAIL_CONFIGURATION_INVALID',
      'Kredensial SMTP tidak lengkap',
      503,
    );
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER && env.SMTP_PASS
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
      : {}),
  });
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const sendTicketEmail = async (
  orderId: string,
  initialEmailLogId?: string,
): Promise<{ sent: boolean; attempts: number }> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      event: { select: { title: true, venueName: true, startAt: true } },
      items: {
        include: { ticketCategory: { select: { name: true } } },
      },
      tickets: {
        include: { ticketCategory: { select: { name: true } } },
      },
    },
  });

  if (!order || order.status !== OrderStatus.PAID || order.tickets.length === 0) {
    throw new AppError(
      'PAID_ORDER_TICKETS_NOT_FOUND',
      'Tiket untuk order berbayar tidak ditemukan',
      409,
    );
  }

  const subject = `Tiket Anda untuk ${order.event.title} - ${order.orderCode}`;
  const date = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(order.event.startAt);
  const orderUrl = `${env.APP_URL.replace(/\/$/, '')}/tickets/view?token=${encodeURIComponent(order.accessToken)}`;
  const ticketRows = order.tickets
    .map(
      (ticket) => `
        <tr>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb">
            ${escapeHtml(ticket.ticketCategory.name)}
          </td>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb">
            ${escapeHtml(ticket.ticketCode)}
          </td>
        </tr>`,
    )
    .join('');
  const items = order.items
    .map(
      (item) => `
        <li>${escapeHtml(item.ticketCategory.name)} × ${item.quantity}
          — Rp${item.subtotal.toLocaleString('id-ID')}</li>`,
    )
    .join('');
  const ticketImages = order.tickets
    .map(
      (ticket) => `
        <div style="display:inline-block;margin:12px;text-align:center">
          <img src="cid:${escapeHtml(ticket.ticketCode)}@eventtixx"
            width="200" height="200" alt="QR ${escapeHtml(ticket.ticketCode)}" />
          <div>${escapeHtml(ticket.ticketCode)}</div>
        </div>`,
    )
    .join('');
  const guestCallout = order.userId
    ? ''
    : '<p>Daftar akun EventTixx agar dapat menikmati poin untuk pembelian berikutnya.</p>';
  const html = `
    <!doctype html>
    <html lang="id">
      <body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827">
        <div style="max-width:640px;margin:24px auto;padding:24px;background:#fff;border-radius:12px">
          <h1 style="font-size:24px">Pembayaran berhasil</h1>
          <p>Pesanan <strong>${escapeHtml(order.orderCode)}</strong> untuk
            <strong>${escapeHtml(order.event.title)}</strong> sudah dikonfirmasi.</p>
          <p>${escapeHtml(order.event.venueName)} · ${escapeHtml(date)}</p>
          <h2 style="font-size:18px">Ringkasan pesanan</h2>
          <ul>${items}</ul>
          <p>Total: <strong>Rp${order.totalAmount.toLocaleString('id-ID')}</strong></p>
          <h2 style="font-size:18px">Tiket Anda</h2>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr><th align="left">Kategori</th><th align="left">Kode tiket</th></tr></thead>
            <tbody>${ticketRows}</tbody>
          </table>
          <div style="text-align:center;margin:20px 0">${ticketImages}</div>
          <p style="text-align:center">
            <a href="${escapeHtml(orderUrl)}"
              style="display:inline-block;padding:12px 20px;background:#6d28d9;color:#fff;text-decoration:none;border-radius:8px">
              Lihat Tiket Online
            </a>
          </p>
          ${guestCallout}
        </div>
      </body>
    </html>`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const emailLog =
      attempt === 1 && initialEmailLogId
        ? await prisma.emailLog.findUniqueOrThrow({
            where: { id: initialEmailLogId },
          })
        : await prisma.emailLog.create({
            data: {
              orderId: order.id,
              toEmail: order.buyerEmail,
              type: 'TICKET',
              subject,
              status: EmailStatus.QUEUED,
            },
          });

    try {
      const attachments = await Promise.all(
        order.tickets.map(async (ticket) => ({
          filename: `${ticket.ticketCode}.png`,
          content: await QRCode.toBuffer(ticket.qrToken, {
            width: 400,
            margin: 2,
            errorCorrectionLevel: 'M',
          }),
          contentType: 'image/png',
          cid: `${ticket.ticketCode}@eventtixx`,
        })),
      );
      const transporter = createTransporter();
      await transporter.sendMail({
        from: env.MAIL_FROM,
        to: order.buyerEmail,
        subject,
        html,
        attachments,
      });
    } catch (error) {
      const errorMessage = getSafeErrorMessage(error);
      await prisma.emailLog.update({
        where: { id: emailLog.id },
        data: { status: EmailStatus.FAILED, errorMessage },
      });
      console.error(
        `Ticket email attempt ${attempt} failed for order ${order.orderCode}:`,
        error instanceof Error ? error.name : 'Unknown error',
      );
      if (attempt < 3) await delay(attempt * 500);
      continue;
    }

    await prisma.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: EmailStatus.SENT,
        sentAt: new Date(),
        errorMessage: null,
      },
    });
    return { sent: true, attempts: attempt };
  }

  return { sent: false, attempts: 3 };
};
