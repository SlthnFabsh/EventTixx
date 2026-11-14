import cron from 'node-cron';
import { expirePendingOrders } from '../modules/orders/orders.service';

export const startOrderExpirationJob = () => {
  let running = false;

  return cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const count = await expirePendingOrders();
      if (count > 0) {
        console.log(`${count} order kedaluwarsa berhasil diproses`);
      }
    } catch (error) {
      console.error(
        'Gagal memproses order kedaluwarsa:',
        error instanceof Error ? error.message : error,
      );
    } finally {
      running = false;
    }
  });
};
