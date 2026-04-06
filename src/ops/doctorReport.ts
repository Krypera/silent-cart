export interface DoctorSnapshot {
  nodeEnv: string;
  databaseReachable: boolean;
  migrationsReady: boolean;
  migrationCount: number | null;
  configuredAdminCount: number;
  syncedAdminCount: number | null;
  walletRpcReachable: boolean | null;
  walletHeight: number | null;
  daemonConfigured: boolean;
  daemonSynchronized: boolean | null;
  daemonHeight: number | null;
  daemonTargetHeight: number | null;
  lastSuccessfulScanAt: string | null;
  pendingOrderCount: number | null;
  underpaidOrderCount: number | null;
}

export interface DoctorAssessment {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function assessDoctorSnapshot(snapshot: DoctorSnapshot): DoctorAssessment {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!snapshot.databaseReachable) {
    errors.push("Database is unreachable.");
  }

  if (snapshot.databaseReachable && !snapshot.migrationsReady) {
    errors.push("Database migrations are missing or unreadable.");
  }

  if (snapshot.walletRpcReachable === false) {
    errors.push("wallet-rpc is unreachable.");
  }

  if (snapshot.daemonConfigured && snapshot.daemonSynchronized === false) {
    errors.push("monerod is configured but not synchronized.");
  }

  if (snapshot.configuredAdminCount === 0) {
    errors.push("No admin Telegram user IDs are configured.");
  }

  if (snapshot.syncedAdminCount === 0) {
    warnings.push("No admin users are currently synced into the database.");
  }

  if (snapshot.pendingOrderCount !== null && snapshot.pendingOrderCount > 0 && !snapshot.lastSuccessfulScanAt) {
    warnings.push("Pending orders exist but no successful payment scan has been recorded yet.");
  }

  if (snapshot.underpaidOrderCount !== null && snapshot.underpaidOrderCount > 0) {
    warnings.push("There are underpaid orders waiting for operator attention.");
  }

  if (!snapshot.daemonConfigured) {
    warnings.push("MONEROD_RPC_URL is not configured; daemon sync checks are disabled.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

export function renderDoctorReport(
  snapshot: DoctorSnapshot,
  assessment: DoctorAssessment
): string {
  const lines = [
    "SilentCart Doctor",
    "",
    `Environment: ${snapshot.nodeEnv}`,
    `Database reachable: ${snapshot.databaseReachable ? "yes" : "no"}`,
    `Migrations ready: ${snapshot.migrationsReady ? "yes" : "no"}`,
    `Applied migrations: ${snapshot.migrationCount ?? "unknown"}`,
    `Configured admin IDs: ${snapshot.configuredAdminCount}`,
    `Synced admin IDs: ${snapshot.syncedAdminCount ?? "unknown"}`,
    `wallet-rpc reachable: ${
      snapshot.walletRpcReachable === null ? "unknown" : snapshot.walletRpcReachable ? "yes" : "no"
    }`,
    `Wallet height: ${snapshot.walletHeight ?? "unknown"}`,
    `monerod checks enabled: ${snapshot.daemonConfigured ? "yes" : "no"}`,
    `Daemon synchronized: ${
      snapshot.daemonSynchronized === null ? "unknown" : snapshot.daemonSynchronized ? "yes" : "no"
    }`,
    `Daemon height: ${snapshot.daemonHeight ?? "unknown"}`,
    `Daemon target height: ${snapshot.daemonTargetHeight ?? "unknown"}`,
    `Last successful scan: ${snapshot.lastSuccessfulScanAt ?? "never"}`,
    `Pending orders: ${snapshot.pendingOrderCount ?? "unknown"}`,
    `Underpaid orders: ${snapshot.underpaidOrderCount ?? "unknown"}`,
    ""
  ];

  if (assessment.errors.length > 0) {
    lines.push("Errors:");
    for (const error of assessment.errors) {
      lines.push(`- ${error}`);
    }
    lines.push("");
  }

  if (assessment.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of assessment.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push(`Overall status: ${assessment.ok ? "OK" : "ATTENTION NEEDED"}`);
  return lines.join("\n");
}
