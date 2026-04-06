import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness.js";

describe("License stock", () => {
  it("soft-reserves one key per order and finalizes on fulfillment", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "License",
      shortDescription: "One key",
      type: "license_key",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "1",
      payload: {
        kind: "license_key",
        note: "Install normally."
      }
    });
    await harness.catalogService.addLicenseStock(product.id, ["AAA-111", "BBB-222"]);

    const order = await harness.orderService.createOrder(product.id, 999n);
    const reserved = await harness.store.licenseStock.findByReservedOrderId(order.id);
    expect(reserved?.state).toBe("reserved");

    await harness.orderService.markConfirmed(order.id, "tx-1", 1_000_000_000_000n, new Date());
    await harness.fulfillmentEngine.fulfillOrder(order.id);

    const consumed = await harness.store.licenseStock.findByConsumedOrderId(order.id);
    expect(consumed?.state).toBe("consumed");
  });
});
