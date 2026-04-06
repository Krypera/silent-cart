import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness.js";

describe("Order lifecycle integration", () => {
  it("moves from awaiting payment to payment seen to confirmed to fulfilled", async () => {
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
        confirmations: 0,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date()
      }
    ]);

    await harness.paymentMonitorService.scan();
    expect((await harness.store.orders.findById(order.id))?.state).toBe("payment_seen");

    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-1",
        amountAtomic: order.quotedAmountAtomic,
        confirmations: 1,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date()
      }
    ]);

    await harness.paymentMonitorService.scan();
    await harness.fulfillmentEngine.fulfillConfirmedOrders();

    expect((await harness.store.orders.findById(order.id))?.state).toBe("fulfilled");
  });

  it("marks underpaid orders as terminal and does not fulfill them", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Underpaid",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "1",
      payload: {
        kind: "text",
        content: "payload"
      }
    });

    const order = await harness.orderService.createOrder(product.id, 55n, new Date("2026-01-01T00:00:00.000Z"));
    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-under",
        amountAtomic: order.quotedAmountAtomic - 1n,
        confirmations: 1,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date("2026-01-01T00:05:00.000Z")
      }
    ]);

    await harness.paymentMonitorService.scan(new Date("2026-01-01T00:32:00.000Z"));
    await harness.fulfillmentEngine.fulfillConfirmedOrders();

    expect((await harness.store.orders.findById(order.id))?.state).toBe("underpaid");
    expect(harness.messenger.messages.some((message) => message.text.includes(order.id))).toBe(false);
  });

  it("fulfills overpaid orders once and ignores duplicate scans", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Overpaid",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.1",
      payload: {
        kind: "text",
        content: "payload"
      }
    });

    const order = await harness.orderService.createOrder(product.id, 1n);
    const overpaid = order.quotedAmountAtomic + 10n;
    harness.moneroAdapter.setTransfers([
      {
        txHash: "tx-over",
        amountAtomic: overpaid,
        confirmations: 1,
        accountIndex: order.accountIndex,
        subaddressIndex: order.subaddressIndex,
        address: order.paymentAddress,
        seenAt: new Date()
      }
    ]);

    await harness.paymentMonitorService.scan();
    await harness.fulfillmentEngine.fulfillConfirmedOrders();
    await harness.paymentMonitorService.scan();
    await harness.fulfillmentEngine.fulfillConfirmedOrders();

    expect((await harness.store.orders.findById(order.id))?.state).toBe("fulfilled");
    expect(harness.messenger.messages.filter((message) => message.text.includes(order.id)).length).toBe(1);
  });

  it("expires unpaid orders after the quote lifetime", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Expiring",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.1",
      payload: {
        kind: "text",
        content: "payload"
      }
    });

    const order = await harness.orderService.createOrder(product.id, 1n, new Date("2026-01-01T00:00:00.000Z"));
    await harness.orderService.expireOrder(order.id, new Date("2026-01-01T00:31:00.000Z"));

    expect((await harness.store.orders.findById(order.id))?.state).toBe("expired");
  });

  it("keeps historical order data after user-link purge", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "History",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.1",
      payload: {
        kind: "text",
        content: "payload"
      }
    });

    const order = await harness.orderService.createOrder(product.id, 33n);
    await harness.orderService.markConfirmed(order.id, "tx-1", order.quotedAmountAtomic, new Date());
    await harness.fulfillmentEngine.fulfillOrder(order.id);

    const link = await harness.store.retention.findByOrderId(order.id);
    await harness.retentionService.purgeExpiredLinks(
      new Date((link?.expiresAt ?? new Date()).getTime() + 1)
    );

    const snapshot = await harness.store.snapshots.findByOrderId(order.id);
    const purgedOrder = await harness.store.orders.findById(order.id);
    expect(snapshot?.title).toBe("History");
    expect(purgedOrder?.prePurgeState).toBe("fulfilled");
  });
});
