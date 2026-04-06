import { describe, expect, it } from "vitest";
import { MonerodRpcClient } from "../../src/monero/daemonRpcClient.js";
import { InMemoryStore } from "../../src/repositories/inMemoryStore.js";
import { OperatorAlertService } from "../../src/services/operatorAlertService.js";
import { WalletHealthService } from "../../src/services/walletHealthService.js";
import { WalletHealthAlertWorker } from "../../src/workers/walletHealthAlertWorker.js";
import { createHarness, FakeMessenger, FakeMoneroAdapter } from "../helpers/harness.js";

class UnsynchronizedMonerodRpcClient extends MonerodRpcClient {
  public constructor() {
    super({
      url: "http://localhost/get_info",
      username: "",
      password: ""
    });
  }

  public override async getInfo(): Promise<{
    height: number;
    targetHeight: number;
    synchronized: boolean;
  }> {
    return {
      height: 120,
      targetHeight: 150,
      synchronized: false
    };
  }
}

describe("WalletHealthAlertWorker", () => {
  it("alerts when scans are stale while pending orders exist", async () => {
    const harness = createHarness();
    await harness.store.admins.syncAllowlist([1n]);
    const product = await harness.catalogService.createProduct({
      title: "Stale scan product",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.2",
      payload: {
        kind: "text",
        content: "payload"
      }
    });
    await harness.orderService.createOrder(product.id, 44n, new Date("2026-01-01T00:00:00.000Z"));
    await harness.store.settings.set("wallet.last_scan_at", {
      lastSuccessfulScanAt: "2026-01-01T00:00:00.000Z"
    });

    const worker = new WalletHealthAlertWorker(
      harness.walletHealthService,
      harness.operatorAlertService,
      60_000
    );

    await worker.runOnce(new Date("2026-01-01T00:05:00.000Z"));

    expect(
      harness.alertMessenger.messages.some((message) =>
        message.text.includes("Payment scanning looks stale")
      )
    ).toBe(true);
  });

  it("alerts when wallet-rpc becomes unreachable", async () => {
    const harness = createHarness();
    await harness.store.admins.syncAllowlist([1n]);
    harness.moneroAdapter.getWalletHeight = async () => {
      throw new Error("wallet down");
    };

    const worker = new WalletHealthAlertWorker(
      harness.walletHealthService,
      harness.operatorAlertService,
      60_000
    );

    await worker.runOnce();

    expect(
      harness.alertMessenger.messages.some((message) =>
        message.text.includes("wallet-rpc is currently unreachable")
      )
    ).toBe(true);
  });

  it("alerts when monerod is not synchronized", async () => {
    const store = new InMemoryStore();
    await store.admins.syncAllowlist([1n]);
    const moneroAdapter = new FakeMoneroAdapter();
    const alertMessenger = new FakeMessenger();
    const operatorAlertService = new OperatorAlertService(store, alertMessenger, 1000);
    const walletHealthService = new WalletHealthService(
      store,
      moneroAdapter,
      new UnsynchronizedMonerodRpcClient()
    );
    const worker = new WalletHealthAlertWorker(
      walletHealthService,
      operatorAlertService,
      60_000
    );

    await worker.runOnce();

    expect(
      alertMessenger.messages.some((message) =>
        message.text.includes("does not appear synchronized")
      )
    ).toBe(true);
  });
});
