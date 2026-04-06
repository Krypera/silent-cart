import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness.js";

describe("StatsService", () => {
  it("keeps historical fulfilled counts after retention purge", async () => {
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

    const before = await harness.statsService.getBasicStats();
    const link = await harness.store.retention.findByOrderId(order.id);
    await harness.retentionService.purgeExpiredLinks(
      new Date((link?.expiresAt ?? new Date()).getTime() + 1)
    );
    const after = await harness.statsService.getBasicStats();

    expect(before.fulfilled).toBe(1);
    expect(after.fulfilled).toBe(1);
    expect(after.totalSettledXmr).toBe("0.1");
  });
});
