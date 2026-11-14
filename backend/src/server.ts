import { env } from './config/env';
import { app } from './app';
import { prisma } from './lib/prisma';
import { startOrderExpirationJob } from './jobs/expire-orders';

const server = app.listen(env.PORT, () => {
  console.log(
    `EventTixx API [${env.NODE_ENV}] running on ${env.API_URL} (port ${env.PORT})`,
  );
});
const orderExpirationTask = startOrderExpirationJob();

let shuttingDown = false;

const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  orderExpirationTask.stop();

  console.log(`${signal} received, shutting down...`);

  const forceExit = setTimeout(() => {
    console.error('Shutdown timeout, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    await prisma.$disconnect();
    clearTimeout(forceExit);
    process.exit(exitCode);
  });
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  void shutdown('uncaughtException', 1);
});
