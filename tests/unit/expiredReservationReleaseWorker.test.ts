import { describe, expect, it } from "vitest";
import { ExpiredReservationReleaseWorker } from "../../src/workers/expiredReservationReleaseWorker.js";
import { createHarness } from "../helpers/harness.js";

describe("ExpiredReservationReleaseWorker", () => {
  it("keeps expired license reservations during the recovery window and releases them later", async () => {
    const harness = createHarness();
    const product = await harness.catalogService.createProduct({
      title: "License",
      shortDescription: "desc",
      type: "license_key",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "1",
      payload: {
        kind: "license_key",
        note: "Use once."
      }
    });
    await harness.catalogService.addLicenseStock(product.id, ["KEY-123"]);

    const order = await harness.orderService.createOrder(product.id, 99n, new Date("2026-01-01T00:00:00.000Z"));
    await harness.orderService.expireOrder(order.id, new Date("2026-01-03T00:31:00.000Z"));

    const worker = new ExpiredReservationReleaseWorker(harness.store, 60);
    await worker.runOnce(new Date("2026-01-03T00:32:00.000Z"));
    expect((await harness.store.licenseStock.findByReservedOrderId(order.id))?.state).toBe("reserved");

    await worker.runOnce(new Date("2026-01-03T01:32:00.000Z"));
    expect(await harness.store.licenseStock.findByReservedOrderId(order.id)).toBeNull();
  });
});
