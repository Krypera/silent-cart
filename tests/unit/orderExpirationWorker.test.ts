import { describe, expect, it } from "vitest";
import { OrderExpirationWorker } from "../../src/workers/orderExpirationWorker.js";
import { createHarness } from "../helpers/harness.js";

describe("OrderExpirationWorker", () => {
  it("expires old checkouts and notifies the user", async () => {
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
    const worker = new OrderExpirationWorker(
      harness.store,
      harness.orderService,
      0,
      harness.userNotificationService
    );

    await worker.runOnce(new Date("2026-01-01T00:31:00.000Z"));

    expect((await harness.store.orders.findById(order.id))?.state).toBe("expired");
    expect(
      harness.notificationMessenger.messages.some((message) => message.text.includes("Quote expired."))
    ).toBe(true);
  });
});
