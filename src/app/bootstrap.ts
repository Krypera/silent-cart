import { createAppServices } from "./services.js";
import { createBot, registerBotHandlers } from "../bot/register.js";
import { logger } from "../logger/logger.js";
import { loadEnvConfig } from "../config/env.js";
import { FulfillmentRetryWorker } from "../workers/fulfillmentRetryWorker.js";
import { ExpiredReservationReleaseWorker } from "../workers/expiredReservationReleaseWorker.js";
import { DatabaseTaskCoordinator } from "../workers/databaseTaskCoordinator.js";
import { OrderExpirationWorker } from "../workers/orderExpirationWorker.js";
import { PaymentScanWorker } from "../workers/paymentScanWorker.js";
import { PeriodicTaskRunner } from "../workers/periodicTaskRunner.js";
import { RetentionPurgeWorker } from "../workers/retentionPurgeWorker.js";
import { WalletHealthAlertWorker } from "../workers/walletHealthAlertWorker.js";

export async function bootstrap(): Promise<void> {
  const env = loadEnvConfig();
  const bot = createBot(env.botToken);
  const services = createAppServices(bot.telegram, env);
  registerBotHandlers(bot, services);

  await services.adminAuthorizationService.syncAllowlist();

  const paymentWorker = new PaymentScanWorker(
    services.paymentMonitorService,
    services.operatorAlertService
  );
  const expiryWorker = new OrderExpirationWorker(
    services.store,
    services.orderService,
    services.env.paymentScanIntervalMs,
    services.userNotificationService
  );
  const retentionWorker = new RetentionPurgeWorker(services.retentionService);
  const fulfillmentWorker = new FulfillmentRetryWorker(services.fulfillmentEngine);
  const walletHealthAlertWorker = new WalletHealthAlertWorker(
    services.walletHealthService,
    services.operatorAlertService,
    services.env.walletStaleScanAlertMs
  );
  const expiredReservationReleaseWorker = new ExpiredReservationReleaseWorker(
    services.store,
    services.env.expiredLicenseReservationReleaseMinutes
  );
  const taskCoordinator = new DatabaseTaskCoordinator(services.database);
  const coordinatedTask = (name: string, task: () => Promise<void>) => async () => {
    await taskCoordinator.runExclusively(name, task);
  };
  const taskRunners = [
    new PeriodicTaskRunner({
      name: "payment-scan",
      intervalMs: services.env.paymentScanIntervalMs,
      task: coordinatedTask("payment-scan", () => paymentWorker.runOnce()),
      runImmediately: true
    }),
    new PeriodicTaskRunner({
      name: "order-expiry",
      intervalMs: services.env.orderExpiryIntervalMs,
      task: coordinatedTask("order-expiry", () => expiryWorker.runOnce()),
      runImmediately: true
    }),
    new PeriodicTaskRunner({
      name: "retention-purge",
      intervalMs: services.env.retentionPurgeIntervalMs,
      task: coordinatedTask("retention-purge", () => retentionWorker.runOnce()),
      runImmediately: false
    }),
    new PeriodicTaskRunner({
      name: "fulfillment-retry",
      intervalMs: services.env.fulfillmentRetryIntervalMs,
      task: coordinatedTask("fulfillment-retry", () => fulfillmentWorker.runOnce()),
      runImmediately: true
    }),
    new PeriodicTaskRunner({
      name: "wallet-health-alerts",
      intervalMs: services.env.walletHealthCheckIntervalMs,
      task: coordinatedTask("wallet-health-alerts", () => walletHealthAlertWorker.runOnce()),
      runImmediately: false
    }),
    new PeriodicTaskRunner({
      name: "expired-reservation-release",
      intervalMs: services.env.orderExpiryIntervalMs,
      task: coordinatedTask("expired-reservation-release", () => expiredReservationReleaseWorker.runOnce()),
      runImmediately: false
    })
  ];

  await bot.launch();
  for (const taskRunner of taskRunners) {
    taskRunner.start();
  }

  let shutdownPromise: Promise<void> | null = null;
  const handleShutdown = () => {
    shutdownPromise ??= shutdown(
      bot.stop.bind(bot),
      services.database.close.bind(services.database),
      taskRunners
    );
    return shutdownPromise;
  };

  process.once("SIGINT", () => {
    void handleShutdown();
  });
  process.once("SIGTERM", () => {
    void handleShutdown();
  });

  logger.info("SilentCart started.");
}

async function shutdown(
  stopBot: (reason?: string) => void,
  closeDatabase: () => Promise<void>,
  taskRunners: PeriodicTaskRunner[]
) {
  stopBot("shutdown");
  await Promise.all(taskRunners.map((taskRunner) => taskRunner.stop()));
  await closeDatabase();
}
