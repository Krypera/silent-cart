import { describe, expect, it } from "vitest";
import {
  assessDoctorSnapshot,
  renderDoctorReport,
  type DoctorSnapshot
} from "../../src/ops/doctorReport.js";

function buildSnapshot(overrides: Partial<DoctorSnapshot> = {}): DoctorSnapshot {
  return {
    nodeEnv: "production",
    databaseReachable: true,
    migrationsReady: true,
    migrationCount: 3,
    configuredAdminCount: 1,
    syncedAdminCount: 1,
    walletRpcReachable: true,
    walletHeight: 123,
    daemonConfigured: true,
    daemonSynchronized: true,
    daemonHeight: 222,
    daemonTargetHeight: 222,
    lastSuccessfulScanAt: "2026-04-06T12:00:00.000Z",
    lastFulfilledOrderAt: "2026-04-06T12:05:00.000Z",
    pendingOrderCount: 0,
    underpaidOrderCount: 0,
    manualReviewCount: 0,
    failedFulfillmentCount: 0,
    ...overrides
  };
}

describe("doctorReport", () => {
  it("marks healthy snapshots as OK", () => {
    const snapshot = buildSnapshot();
    const assessment = assessDoctorSnapshot(snapshot);
    const report = renderDoctorReport(snapshot, assessment);

    expect(assessment.ok).toBe(true);
    expect(assessment.errors).toHaveLength(0);
    expect(report).toContain("Overall status: OK");
  });

  it("reports errors and warnings for unhealthy deployments", () => {
    const snapshot = buildSnapshot({
      databaseReachable: false,
      migrationsReady: false,
      walletRpcReachable: false,
      daemonSynchronized: false,
      syncedAdminCount: 0,
      pendingOrderCount: 2,
      lastSuccessfulScanAt: null,
      underpaidOrderCount: 1,
      manualReviewCount: 1,
      failedFulfillmentCount: 1
    });
    const assessment = assessDoctorSnapshot(snapshot);
    const report = renderDoctorReport(snapshot, assessment);

    expect(assessment.ok).toBe(false);
    expect(assessment.errors).toContain("Database is unreachable.");
    expect(assessment.warnings).toContain(
      "Pending orders exist but no successful payment scan has been recorded yet."
    );
    expect(report).toContain("Errors:");
    expect(report).toContain("Warnings:");
    expect(report).toContain("Overall status: ATTENTION NEEDED");
  });

  it("keeps wallet status unknown when health checks did not run yet", () => {
    const snapshot = buildSnapshot({
      databaseReachable: true,
      migrationsReady: false,
      walletRpcReachable: null
    });
    const assessment = assessDoctorSnapshot(snapshot);
    const report = renderDoctorReport(snapshot, assessment);

    expect(assessment.errors).not.toContain("wallet-rpc is unreachable.");
    expect(report).toContain("wallet-rpc reachable: unknown");
  });
});
