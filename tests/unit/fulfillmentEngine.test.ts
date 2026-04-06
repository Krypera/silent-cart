import { describe, expect, it } from "vitest";
import { FulfillmentEngine } from "../../src/services/fulfillment/fulfillmentEngine.js";
import { createHarness } from "../helpers/harness.js";

describe("FulfillmentEngine", () => {
  it("delivers all supported product types and supports re-delivery", async () => {
    const harness = createHarness();

    const file = await harness.catalogService.createProduct({
      title: "File",
      shortDescription: "file",
      type: "file",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.1",
      payload: {
        kind: "file",
        telegramFileId: "file-123"
      }
    });
    const text = await harness.catalogService.createProduct({
      title: "Text",
      shortDescription: "text",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.1",
      payload: {
        kind: "text",
        content: "secret"
      }
    });
    const link = await harness.catalogService.createProduct({
      title: "Link",
      shortDescription: "link",
      type: "download_link",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.1",
      payload: {
        kind: "download_link",
        url: "https://example.com/dl"
      }
    });
    const license = await harness.catalogService.createProduct({
      title: "License",
      shortDescription: "license",
      type: "license_key",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.1",
      payload: {
        kind: "license_key",
        note: "Use once."
      }
    });
    await harness.catalogService.addLicenseStock(license.id, ["KEY-123"]);

    for (const product of [file, text, link, license]) {
      const order = await harness.orderService.createOrder(product.id, 77n);
      await harness.orderService.markConfirmed(order.id, "tx", order.quotedAmountAtomic, new Date());
      await harness.fulfillmentEngine.fulfillOrder(order.id);
      await harness.fulfillmentEngine.redeliver(order.id, 77n);
    }

    expect(harness.messenger.documents.length).toBeGreaterThanOrEqual(2);
    expect(harness.messenger.messages.some((message) => message.text.includes("secret"))).toBe(true);
    expect(harness.messenger.messages.some((message) => message.text.includes("https://example.com/dl"))).toBe(
      true
    );
    expect(harness.messenger.messages.some((message) => message.text.includes("KEY-123"))).toBe(true);
  });

  it("marks receipt failures as delivered so payloads are not sent twice", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Text",
      shortDescription: "text",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.1",
      payload: {
        kind: "text",
        content: "secret"
      }
    });
    const order = await harness.orderService.createOrder(product.id, 77n);
    await harness.orderService.markConfirmed(order.id, "tx", order.quotedAmountAtomic, new Date());

    let sendCount = 0;
    const flakyMessenger = {
      async sendMessage(chatId: bigint, text: string) {
        sendCount += 1;
        if (sendCount === 2) {
          throw new Error("receipt failed");
        }
        return {
          messageId: sendCount
        };
      },
      async sendDocument(chatId: bigint, fileId: string, caption?: string) {
        sendCount += 1;
        return {
          messageId: sendCount
        };
      }
    };

    const fulfillmentEngine = new FulfillmentEngine(
      harness.store,
      harness.catalogService,
      harness.orderService,
      harness.retentionService,
      flakyMessenger
    );

    const first = await fulfillmentEngine.fulfillOrder(order.id);
    const second = await fulfillmentEngine.fulfillOrder(order.id);

    expect(first?.status).toBe("delivered");
    expect(second?.status).toBe("delivered");
    expect(sendCount).toBe(2);
  });

  it("moves stale processing records to manual review instead of retrying delivery", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Text",
      shortDescription: "text",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.1",
      payload: {
        kind: "text",
        content: "secret"
      }
    });
    const order = await harness.orderService.createOrder(product.id, 77n);
    await harness.orderService.markConfirmed(order.id, "tx", order.quotedAmountAtomic, new Date());
    await harness.store.fulfillments.createOrUpdate({
      id: "fulfillment-1",
      orderId: order.id,
      deliveryType: "text",
      status: "processing",
      attempts: 1,
      lastErrorCode: null,
      deliveredAt: null,
      lastAttemptAt: new Date(),
      receiptMessageId: null
    });

    const result = await harness.fulfillmentEngine.fulfillOrder(order.id);

    expect(result?.status).toBe("manual_review");
    expect(harness.messenger.messages.length).toBe(0);
  });

  it("lets an admin resolve manual review orders that were left expired after a recorded payment", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Text",
      shortDescription: "text",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.1",
      payload: {
        kind: "text",
        content: "secret"
      }
    });
    const order = await harness.orderService.createOrder(product.id, 77n, new Date("2026-01-01T00:00:00.000Z"));
    await harness.orderService.expireOrder(order.id, new Date("2026-01-01T00:31:00.000Z"));
    await harness.store.payments.upsert({
      id: "payment-1",
      orderId: order.id,
      txHash: "tx-manual-review",
      amountAtomic: order.quotedAmountAtomic,
      confirmations: 1,
      category: "qualifying",
      firstSeenAt: new Date("2026-01-01T00:10:00.000Z"),
      lastSeenAt: new Date("2026-01-01T00:10:00.000Z"),
      confirmedAt: new Date("2026-01-01T00:10:00.000Z")
    });
    await harness.store.fulfillments.createOrUpdate({
      id: "fulfillment-1",
      orderId: order.id,
      deliveryType: "text",
      status: "manual_review",
      attempts: 1,
      lastErrorCode: "Manual review is required.",
      deliveredAt: null,
      lastAttemptAt: new Date(),
      receiptMessageId: null
    });

    const result = await harness.fulfillmentEngine.resolveManualReview(order.id, 77n, true);

    expect(result.status).toBe("delivered");
    expect((await harness.store.orders.findById(order.id))?.state).toBe("fulfilled");
    expect(harness.messenger.messages.some((message) => message.text.includes("secret"))).toBe(true);
  });
});
