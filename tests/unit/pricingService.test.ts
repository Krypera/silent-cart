import { describe, expect, it } from "vitest";
import { PricingService } from "../../src/services/pricingService.js";
import { StaticRateProvider } from "../helpers/harness.js";

describe("PricingService", () => {
  it("freezes USD anchored quotes into XMR", async () => {
    const pricingService = new PricingService(new StaticRateProvider(150), true);

    const quote = await pricingService.freezeQuote({
      id: "p1",
      title: "USD anchored",
      shortDescription: "desc",
      type: "text",
      pricingMode: "usd_anchored",
      fixedPriceAtomic: null,
      usdPriceCents: 1500,
      active: true,
      encryptedPayload: "cipher",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    expect(quote.quotedAmountXmr).toBe("0.1");
    expect(quote.usdReferenceCents).toBe(1500);
  });

  it("keeps fixed XMR pricing available when the USD reference provider fails", async () => {
    const pricingService = new PricingService(
      {
        async getUsdPerXmr() {
          throw new Error("rate provider unavailable");
        }
      },
      true
    );

    const view = await pricingService.buildPublicProductView({
      id: "p1",
      title: "Fixed XMR",
      shortDescription: "desc",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedPriceAtomic: 100_000_000_000n,
      usdPriceCents: null,
      active: true,
      encryptedPayload: "cipher",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    expect(view.xmrAmount).toBe("0.1");
    expect(view.usdReference).toBeNull();
  });
});
