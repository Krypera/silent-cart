import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { MoneroPaymentAdapter } from "../../src/monero/types.js";
import { PaymentMonitorService } from "../../src/services/paymentMonitorService.js";
import { createHarness } from "../helpers/harness.js";

describe("PaymentMonitorService", () => {
  it("recovers a timely payment that is scanned after the order was expired", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Text product",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.5",
      payload: {
        kind: "text",
        content: "payload"
      }
    });

    const order = await harness.orderService.createOrder(product.id, 55n, new Date("2026-01-01T00:00:00.000Z"));
    await harness.orderService.expireOrder(order.id, new Date("2026-01-01T00:31:00.000Z"));

    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-on-time",
        amountAtomic: order.quotedAmountAtomic,
        confirmations: 1,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date("2026-01-01T00:29:00.000Z")
      }
    ]);

    await harness.paymentMonitorService.scan(new Date("2026-01-01T00:32:00.000Z"));

    expect((await harness.store.orders.findById(order.id))?.state).toBe("confirmed");
    expect((await harness.store.payments.findByOrderId(order.id)).length).toBe(1);
  });

  it("notifies the user when a payment is seen and when it later confirms", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Text product",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.5",
      payload: {
        kind: "text",
        content: "payload"
      }
    });

    const order = await harness.orderService.createOrder(product.id, 55n, new Date("2026-01-01T00:00:00.000Z"));
    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-seen",
        amountAtomic: order.quotedAmountAtomic,
        confirmations: 0,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date("2026-01-01T00:01:00.000Z")
      }
    ]);

    await harness.paymentMonitorService.scan(new Date("2026-01-01T00:02:00.000Z"));

    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-seen",
        amountAtomic: order.quotedAmountAtomic,
        confirmations: 1,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date("2026-01-01T00:01:00.000Z")
      }
    ]);

    await harness.paymentMonitorService.scan(new Date("2026-01-01T00:03:00.000Z"));

    expect(harness.notificationMessenger.messages.some((message) => message.text.includes("Payment seen."))).toBe(
      true
    );
    expect(
      harness.notificationMessenger.messages.some((message) => message.text.includes("Payment confirmed."))
    ).toBe(true);
  });

  it("keeps account and subaddress pairs isolated when matching transfers", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Text product",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.5",
      payload: {
        kind: "text",
        content: "payload"
      }
    });

    const firstOrderId = randomUUID();
    const secondOrderId = randomUUID();
    for (const [orderId, accountIndex, paymentAddress, telegramUserId] of [
      [firstOrderId, 0, "addr-0", 11n],
      [secondOrderId, 1, "addr-1", 12n]
    ] as const) {
      await harness.store.orders.create({
        id: orderId,
        productId: product.id,
        state: "awaiting_payment",
        prePurgeState: null,
        pricingMode: "fixed_xmr",
        quotedAmountAtomic: 500_000_000_000n,
        quotedAmountXmr: "0.5",
        usdReferenceCents: null,
        paymentAddress,
        accountIndex,
        subaddressIndex: 0,
        quoteExpiresAt: new Date("2026-01-01T00:30:00.000Z"),
        paymentTxHash: null,
        paymentReceivedAtomic: null,
        paymentSeenAt: null,
        confirmedAt: null,
        fulfilledAt: null
      });
      await harness.store.retention.create({
        orderId,
        telegramUserId,
        expiresAt: null,
        purgedAt: null
      });
    }

    const accountAwareAdapter: MoneroPaymentAdapter = {
      async createSubaddress(label: string) {
        return {
          address: label,
          accountIndex: 0,
          subaddressIndex: 0
        };
      },
      async refresh() {},
      async getIncomingTransfers({ accountIndex, subaddressIndices }) {
        const transfers = [
          {
            txHash: "tx-account-0",
            amountAtomic: 500_000_000_000n,
            confirmations: 1,
            accountIndex: 0,
            subaddressIndex: 0,
            address: "addr-0",
            seenAt: new Date("2026-01-01T00:01:00.000Z")
          },
          {
            txHash: "tx-account-1",
            amountAtomic: 500_000_000_000n,
            confirmations: 1,
            accountIndex: 1,
            subaddressIndex: 0,
            address: "addr-1",
            seenAt: new Date("2026-01-01T00:02:00.000Z")
          }
        ];

        return transfers.filter(
          (transfer) =>
            transfer.accountIndex === accountIndex &&
            subaddressIndices.includes(transfer.subaddressIndex)
        );
      },
      async getWalletHeight() {
        return {
          height: 1
        };
      },
      async getVersion() {
        return {
          version: 1
        };
      }
    };

    const paymentMonitorService = new PaymentMonitorService(
      harness.store,
      harness.orderService,
      accountAwareAdapter,
      250
    );
    await paymentMonitorService.scan(new Date("2026-01-01T00:03:00.000Z"));

    expect((await harness.store.orders.findById(firstOrderId))?.paymentTxHash).toBe("tx-account-0");
    expect((await harness.store.orders.findById(secondOrderId))?.paymentTxHash).toBe("tx-account-1");
  });

  it("updates lastSuccessfulScanAt only after the scan completes", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Text product",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.5",
      payload: {
        kind: "text",
        content: "payload"
      }
    });
    await harness.orderService.createOrder(product.id, 55n);

    const failingAdapter: MoneroPaymentAdapter = {
      async createSubaddress(label: string) {
        return {
          address: label,
          accountIndex: 0,
          subaddressIndex: 0
        };
      },
      async refresh() {},
      async getIncomingTransfers() {
        throw new Error("rpc failure after refresh");
      },
      async getWalletHeight() {
        return {
          height: 1
        };
      },
      async getVersion() {
        return {
          version: 1
        };
      }
    };

    const paymentMonitorService = new PaymentMonitorService(
      harness.store,
      harness.orderService,
      failingAdapter,
      250
    );

    await expect(
      paymentMonitorService.scan(new Date("2026-01-01T00:00:00.000Z"))
    ).rejects.toThrow("rpc failure after refresh");
    expect(await harness.store.settings.get("wallet.last_scan_at")).toBeNull();
  });

  it("does not advance lastSuccessfulScanAt when an order fails during scan processing", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Text product",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.5",
      payload: {
        kind: "text",
        content: "payload"
      }
    });
    const order = await harness.orderService.createOrder(product.id, 55n);
    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-1",
        amountAtomic: order.quotedAmountAtomic,
        confirmations: 1,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date("2026-01-01T00:01:00.000Z")
      }
    ]);

    harness.store.payments.findByOrderId = async () => {
      throw new Error("simulated payment store failure");
    };

    const result = await harness.paymentMonitorService.scan(new Date("2026-01-01T00:02:00.000Z"));

    expect(result.orderFailures).toBe(1);
    expect(await harness.store.settings.get("wallet.last_scan_at")).toBeNull();
  });

  it("keeps awaiting payment after an underpayment while the quote is still open and accepts a later exact payment", async () => {
    const harness = createHarness();
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const product = await harness.catalogService.createProduct({
      title: "Text product",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "1",
      payload: {
        kind: "text",
        content: "payload"
      }
    });

    const order = await harness.orderService.createOrder(product.id, 55n, createdAt);
    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-under",
        amountAtomic: 500_000_000_000n,
        confirmations: 1,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date("2026-01-01T00:05:00.000Z")
      }
    ]);

    await harness.paymentMonitorService.scan(new Date("2026-01-01T00:06:00.000Z"));
    expect((await harness.store.orders.findById(order.id))?.state).toBe("awaiting_payment");

    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-under",
        amountAtomic: 500_000_000_000n,
        confirmations: 1,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date("2026-01-01T00:05:00.000Z")
      },
      {
        txHash: "tx-exact",
        amountAtomic: order.quotedAmountAtomic,
        confirmations: 1,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date("2026-01-01T00:10:00.000Z")
      }
    ]);

    await harness.paymentMonitorService.scan(new Date("2026-01-01T00:11:00.000Z"));

    expect((await harness.store.orders.findById(order.id))?.state).toBe("confirmed");
    expect((await harness.store.orders.findById(order.id))?.paymentTxHash).toBe("tx-exact");
    expect((await harness.store.payments.findByOrderId(order.id)).length).toBe(2);
  });

  it("marks expired orders underpaid when only a timely underpayment exists", async () => {
    const harness = createHarness();
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const product = await harness.catalogService.createProduct({
      title: "Text product",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "1",
      payload: {
        kind: "text",
        content: "payload"
      }
    });

    const order = await harness.orderService.createOrder(product.id, 55n, createdAt);
    await harness.orderService.expireOrder(order.id, new Date("2026-01-01T00:31:00.000Z"));
    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-under",
        amountAtomic: 500_000_000_000n,
        confirmations: 1,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date("2026-01-01T00:05:00.000Z")
      }
    ]);

    await harness.paymentMonitorService.scan(new Date("2026-01-01T00:32:00.000Z"));

    expect((await harness.store.orders.findById(order.id))?.state).toBe("underpaid");
  });

  it("rotates expired recovery scans so newer orders are eventually revisited", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Text product",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.5",
      payload: {
        kind: "text",
        content: "payload"
      }
    });

    const orders = [];
    for (let index = 0; index < 12; index += 1) {
      const order = await harness.orderService.createOrder(
        product.id,
        BigInt(index + 1),
        new Date(`2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`)
      );
      await harness.orderService.expireOrder(order.id, new Date("2026-01-01T00:31:00.000Z"));
      orders.push(order);
    }

    const target = orders[11];
    if (!target) {
      throw new Error("Expected target order to exist.");
    }

    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-target",
        amountAtomic: target.quotedAmountAtomic,
        confirmations: 1,
        accountIndex: target.accountIndex,
        subaddressIndex: target.subaddressIndex,
        address: target.paymentAddress,
        seenAt: new Date(target.quoteExpiresAt.getTime() - 60_000)
      }
    ]);

    const paymentMonitorService = new PaymentMonitorService(
      harness.store,
      harness.orderService,
      harness.moneroAdapter,
      1
    );

    await paymentMonitorService.scan(new Date("2026-01-01T00:32:00.000Z"));
    await paymentMonitorService.scan(new Date("2026-01-01T00:33:00.000Z"));

    expect((await harness.store.orders.findById(target.id))?.state).toBe("confirmed");
    expect((await harness.store.payments.findByOrderId(target.id)).length).toBe(1);
  });

  it("flags timely recovered license payments for manual review if inventory is no longer available", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "License product",
      shortDescription: "desc",
      type: "license_key",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "1",
      payload: {
        kind: "license_key",
        note: "Install normally."
      }
    });
    await harness.catalogService.addLicenseStock(product.id, ["KEY-123"]);

    const firstOrder = await harness.orderService.createOrder(
      product.id,
      1n,
      new Date("2026-01-01T00:00:00.000Z")
    );
    await harness.orderService.expireOrder(firstOrder.id, new Date("2026-01-01T00:31:00.000Z"));
    await harness.store.licenseStock.releaseReservation(firstOrder.id);

    const secondOrder = await harness.orderService.createOrder(
      product.id,
      2n,
      new Date("2026-01-01T00:32:00.000Z")
    );
    await harness.orderService.markConfirmed(
      secondOrder.id,
      "tx-2",
      secondOrder.quotedAmountAtomic,
      new Date("2026-01-01T00:33:00.000Z")
    );
    await harness.fulfillmentEngine.fulfillOrder(secondOrder.id);

    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-1",
        amountAtomic: firstOrder.quotedAmountAtomic,
        confirmations: 1,
        accountIndex: firstOrder.accountIndex,
        subaddressIndex: firstOrder.subaddressIndex,
        address: firstOrder.paymentAddress,
        seenAt: new Date("2026-01-01T00:29:00.000Z")
      }
    ]);

    await harness.paymentMonitorService.scan(new Date("2026-01-01T00:34:00.000Z"));

    expect((await harness.store.orders.findById(firstOrder.id))?.state).toBe("expired");
    expect((await harness.store.fulfillments.findByOrderId(firstOrder.id))?.status).toBe("manual_review");
    expect(harness.alertMessenger.messages.some((message) => message.text.includes(firstOrder.id))).toBe(true);
  });
});
