import type { QueryResultRow } from "pg";
import { loadEnvConfig } from "../config/env.js";
import { Database } from "../db/database.js";
import { MonerodRpcClient } from "../monero/daemonRpcClient.js";
import { MoneroWalletRpcClient } from "../monero/walletRpcClient.js";
import { createPostgresStore } from "../repositories/postgresStore.js";
import { WalletHealthService } from "../services/walletHealthService.js";
import {
  assessDoctorSnapshot,
  renderDoctorReport,
  type DoctorSnapshot
} from "./doctorReport.js";

interface CountRow extends QueryResultRow {
  count: string;
}

async function main(): Promise<void> {
  const env = loadEnvConfig();
  const database = new Database(env.databaseUrl);

  const snapshot: DoctorSnapshot = {
    nodeEnv: env.nodeEnv,
    databaseReachable: false,
    migrationsReady: false,
    migrationCount: null,
    configuredAdminCount: env.adminTelegramUserIds.length,
    syncedAdminCount: null,
    walletRpcReachable: null,
    walletHeight: null,
    daemonConfigured: env.monerodRpc !== null,
    daemonSynchronized: null,
    daemonHeight: null,
    daemonTargetHeight: null,
    lastSuccessfulScanAt: null,
    lastFulfilledOrderAt: null,
    pendingOrderCount: null,
    underpaidOrderCount: null,
    manualReviewCount: null,
    failedFulfillmentCount: null
  };

  try {
    await database.query("select 1");
    snapshot.databaseReachable = true;

    try {
      const migrationCount = await database.query<CountRow>(
        "select count(*)::text as count from schema_migrations"
      );
      snapshot.migrationCount = Number.parseInt(migrationCount.rows[0]?.count ?? "0", 10);
      snapshot.migrationsReady = true;
    } catch {
      snapshot.migrationsReady = false;
    }

    if (snapshot.migrationsReady) {
      const syncedAdmins = await database.query<CountRow>(
        "select count(*)::text as count from admin_users"
      );
      snapshot.syncedAdminCount = Number.parseInt(syncedAdmins.rows[0]?.count ?? "0", 10);

      const store = createPostgresStore(database);
      const walletHealthService = new WalletHealthService(
        store,
        new MoneroWalletRpcClient({
          url: env.walletRpc.url,
          username: env.walletRpc.username,
          password: env.walletRpc.password,
          accountIndex: env.xmrAccountIndex
        }),
        env.monerodRpc
          ? new MonerodRpcClient({
              url: env.monerodRpc.url,
              username: env.monerodRpc.username,
              password: env.monerodRpc.password
            })
          : null
      );

      const health = await walletHealthService.getHealth();
      snapshot.walletRpcReachable = health.walletRpcReachable;
      snapshot.walletHeight = health.walletHeight;
      snapshot.daemonSynchronized = health.daemonSynchronized;
      snapshot.daemonHeight = health.daemonHeight;
      snapshot.daemonTargetHeight = health.daemonTargetHeight;
      snapshot.lastSuccessfulScanAt = health.lastSuccessfulScanAt;
      snapshot.lastFulfilledOrderAt = health.lastFulfilledOrderAt;
      snapshot.pendingOrderCount = health.pendingOrderCount;
      snapshot.underpaidOrderCount = health.underpaidOrderCount;
      snapshot.manualReviewCount = health.manualReviewCount;
      snapshot.failedFulfillmentCount = health.failedFulfillmentCount;
    }
  } finally {
    await database.close();
  }

  const assessment = assessDoctorSnapshot(snapshot);
  console.log(renderDoctorReport(snapshot, assessment));
  process.exitCode = assessment.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
