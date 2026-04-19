import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ADMIN_TELEGRAM_USER_IDS: z.string().min(1),
  FULFILLMENT_ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Fa-f0-9]{64}$/, "FULFILLMENT_ENCRYPTION_KEY must be 64 hex chars"),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  QUOTE_LIFETIME_MINUTES: z.coerce.number().int().positive().default(30),
  USD_REFERENCE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  XMR_ACCOUNT_INDEX: z.coerce.number().int().nonnegative().default(0),
  XMR_WALLET_RPC_URL: z.string().url(),
  XMR_WALLET_RPC_USERNAME: z.string().optional().default(""),
  XMR_WALLET_RPC_PASSWORD: z.string().optional().default(""),
  MONEROD_RPC_URL: z.string().url().optional().or(z.literal("")).default(""),
  MONEROD_RPC_USERNAME: z.string().optional().default(""),
  MONEROD_RPC_PASSWORD: z.string().optional().default(""),
  COINGECKO_API_BASE_URL: z.string().url().default("https://api.coingecko.com/api/v3"),
  COINGECKO_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  WALLET_RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  MONEROD_RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  PAYMENT_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  ORDER_EXPIRY_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  RETENTION_PURGE_INTERVAL_MS: z.coerce.number().int().positive().default(3600000),
  FULFILLMENT_RETRY_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  EXPIRED_LICENSE_RESERVATION_RELEASE_MINUTES: z.coerce.number().int().positive().default(1440),
  WALLET_SCAN_BATCH_SIZE: z.coerce.number().int().positive().default(250),
  WALLET_HEALTH_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  WALLET_STALE_SCAN_ALERT_MS: z.coerce.number().int().positive().default(180000),
  TELEGRAM_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(4),
  TELEGRAM_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000),
  TELEGRAM_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(10000),
  OPERATOR_ALERT_COOLDOWN_MS: z.coerce.number().int().positive().default(900000)
});

export type AppEnv = ReturnType<typeof loadEnvConfig>;

export function loadEnvConfig() {
  const parsed = envSchema.parse(process.env);

  return {
    nodeEnv: parsed.NODE_ENV,
    botToken: parsed.BOT_TOKEN,
    databaseUrl: parsed.DATABASE_URL,
    adminTelegramUserIds: parsed.ADMIN_TELEGRAM_USER_IDS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => BigInt(value)),
    fulfillmentEncryptionKey: parsed.FULFILLMENT_ENCRYPTION_KEY,
    retentionDays: parsed.RETENTION_DAYS,
    quoteLifetimeMinutes: parsed.QUOTE_LIFETIME_MINUTES,
    usdReferenceEnabled: parsed.USD_REFERENCE_ENABLED,
    xmrAccountIndex: parsed.XMR_ACCOUNT_INDEX,
    walletRpc: {
      url: parsed.XMR_WALLET_RPC_URL,
      username: parsed.XMR_WALLET_RPC_USERNAME,
      password: parsed.XMR_WALLET_RPC_PASSWORD,
      timeoutMs: parsed.WALLET_RPC_TIMEOUT_MS
    },
    monerodRpc: parsed.MONEROD_RPC_URL
      ? {
          url: parsed.MONEROD_RPC_URL,
          username: parsed.MONEROD_RPC_USERNAME,
          password: parsed.MONEROD_RPC_PASSWORD,
          timeoutMs: parsed.MONEROD_RPC_TIMEOUT_MS
        }
      : null,
    coinGeckoApiBaseUrl: parsed.COINGECKO_API_BASE_URL,
    coinGeckoRequestTimeoutMs: parsed.COINGECKO_REQUEST_TIMEOUT_MS,
    paymentScanIntervalMs: parsed.PAYMENT_SCAN_INTERVAL_MS,
    orderExpiryIntervalMs: parsed.ORDER_EXPIRY_INTERVAL_MS,
    retentionPurgeIntervalMs: parsed.RETENTION_PURGE_INTERVAL_MS,
    fulfillmentRetryIntervalMs: parsed.FULFILLMENT_RETRY_INTERVAL_MS,
    expiredLicenseReservationReleaseMinutes: parsed.EXPIRED_LICENSE_RESERVATION_RELEASE_MINUTES,
    walletScanBatchSize: parsed.WALLET_SCAN_BATCH_SIZE,
    walletHealthCheckIntervalMs: parsed.WALLET_HEALTH_CHECK_INTERVAL_MS,
    walletStaleScanAlertMs: parsed.WALLET_STALE_SCAN_ALERT_MS,
    telegramRetryAttempts: parsed.TELEGRAM_RETRY_ATTEMPTS,
    telegramRetryBaseDelayMs: parsed.TELEGRAM_RETRY_BASE_DELAY_MS,
    telegramRetryMaxDelayMs: parsed.TELEGRAM_RETRY_MAX_DELAY_MS,
    operatorAlertCooldownMs: parsed.OPERATOR_ALERT_COOLDOWN_MS
  };
}
