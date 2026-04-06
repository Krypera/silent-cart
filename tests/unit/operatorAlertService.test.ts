import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness.js";

describe("OperatorAlertService", () => {
  it("deduplicates manual review alerts for the same order", async () => {
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

    await harness.operatorAlertService.notifyManualReview(order.id, "First problem");
    await harness.operatorAlertService.notifyManualReview(order.id, "Second problem");

    expect(harness.alertMessenger.messages.filter((message) => message.text.includes(order.id)).length).toBe(1);
  });
});
