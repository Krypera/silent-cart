import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness.js";

describe("RetentionService", () => {
  it("purges the Telegram linkage but keeps anonymous order records", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "Text product",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.2",
      payload: {
        kind: "text",
        content: "hello"
      }
    });
    const order = await harness.orderService.createOrder(product.id, 42n);
    await harness.orderService.markConfirmed(order.id, "tx-1", 200_000_000_000n, new Date());
    await harness.fulfillmentEngine.fulfillOrder(order.id);

    const link = await harness.store.retention.findByOrderId(order.id);
    await harness.retentionService.purgeExpiredLinks(
      new Date((link?.expiresAt ?? new Date()).getTime() + 1000)
    );

    const purgedLink = await harness.store.retention.findByOrderId(order.id);
    const purgedOrder = await harness.store.orders.findById(order.id);
    expect(purgedLink?.telegramUserId).toBeNull();
    expect(purgedOrder?.state).toBe("purged");
    expect(purgedOrder?.prePurgeState).toBe("fulfilled");
  });
});
