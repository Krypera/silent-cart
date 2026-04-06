import type { Telegram } from "telegraf";
import { EncryptionService } from "../crypto/encryption.js";
import { Database } from "../db/database.js";
import { loadEnvConfig, type AppEnv } from "../config/env.js";
import { MonerodRpcClient } from "../monero/daemonRpcClient.js";
import { MoneroWalletRpcClient } from "../monero/walletRpcClient.js";
import { createPostgresStore } from "../repositories/postgresStore.js";
import { AdminAuthorizationService } from "../services/adminAuthorizationService.js";
import { AdminDraftService } from "../services/adminDraftService.js";
import { CatalogService } from "../services/catalogService.js";
import { FulfillmentEngine } from "../services/fulfillment/fulfillmentEngine.js";
import { GuideService } from "../services/guideService.js";
import { OperatorAlertService } from "../services/operatorAlertService.js";
import { OrderService } from "../services/orderService.js";
import { PaymentMonitorService } from "../services/paymentMonitorService.js";
import { CoinGeckoRateProvider, PricingService } from "../services/pricingService.js";
import { RetentionService } from "../services/retentionService.js";
import { StatsService } from "../services/statsService.js";
import { UserNotificationService } from "../services/userNotificationService.js";
import { WalletHealthService } from "../services/walletHealthService.js";
import { TelegramDeliveryMessenger } from "../bot/telegramMessenger.js";

export interface AppServices {
  env: AppEnv;
  database: Database;
  store: ReturnType<typeof createPostgresStore>;
  encryptionService: EncryptionService;
  catalogService: CatalogService;
  pricingService: PricingService;
  orderService: OrderService;
  paymentMonitorService: PaymentMonitorService;
  retentionService: RetentionService;
  guideService: GuideService;
  walletHealthService: WalletHealthService;
  statsService: StatsService;
  adminAuthorizationService: AdminAuthorizationService;
  adminDraftService: AdminDraftService;
  userNotificationService: UserNotificationService;
  operatorAlertService: OperatorAlertService;
  fulfillmentEngine: FulfillmentEngine;
}

export function createAppServices(telegram: Telegram, env = loadEnvConfig()): AppServices {
  const database = new Database(env.databaseUrl);
  const store = createPostgresStore(database);
  const encryptionService = new EncryptionService(env.fulfillmentEncryptionKey);
  const rateProvider = new CoinGeckoRateProvider(env.coinGeckoApiBaseUrl);
  const pricingService = new PricingService(rateProvider, env.usdReferenceEnabled);
  const catalogService = new CatalogService(store, encryptionService);
  const telegramMessenger = new TelegramDeliveryMessenger(telegram, {
    maxAttempts: env.telegramRetryAttempts,
    baseDelayMs: env.telegramRetryBaseDelayMs,
    maxDelayMs: env.telegramRetryMaxDelayMs
  });
  const moneroAdapter = new MoneroWalletRpcClient({
    url: env.walletRpc.url,
    username: env.walletRpc.username,
    password: env.walletRpc.password,
    accountIndex: env.xmrAccountIndex
  });
  const retentionService = new RetentionService(store, env.retentionDays);
  const orderService = new OrderService(
    store,
    catalogService,
    pricingService,
    moneroAdapter,
    env.quoteLifetimeMinutes
  );
  const adminAuthorizationService = new AdminAuthorizationService(
    store,
    env.adminTelegramUserIds
  );
  const adminDraftService = new AdminDraftService(store);
  const guideService = new GuideService(store, env.retentionDays);
  const userNotificationService = new UserNotificationService(store, telegramMessenger);
  const operatorAlertService = new OperatorAlertService(
    store,
    telegramMessenger,
    env.operatorAlertCooldownMs
  );
  const walletHealthService = new WalletHealthService(
    store,
    moneroAdapter,
    env.monerodRpc
      ? new MonerodRpcClient({
          url: env.monerodRpc.url,
          username: env.monerodRpc.username,
          password: env.monerodRpc.password
        })
      : null
  );
  const fulfillmentEngine = new FulfillmentEngine(
    store,
    catalogService,
    orderService,
    retentionService,
    telegramMessenger,
    operatorAlertService
  );

  return {
    env,
    database,
    store,
    encryptionService,
    catalogService,
    pricingService,
    orderService,
    paymentMonitorService: new PaymentMonitorService(
      store,
      orderService,
      moneroAdapter,
      env.walletScanBatchSize,
      userNotificationService,
      operatorAlertService
    ),
    retentionService,
    guideService,
    walletHealthService,
    statsService: new StatsService(store),
    adminAuthorizationService,
    adminDraftService,
    userNotificationService,
    operatorAlertService,
    fulfillmentEngine
  };
}
