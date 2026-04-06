import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness.js";

describe("CatalogService", () => {
  it("creates and edits products", async () => {
    const { catalogService } = createHarness();

    const product = await catalogService.createProduct({
      title: "Private file",
      shortDescription: "Encrypted archive",
      type: "file",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.25",
      payload: {
        kind: "file",
        telegramFileId: "file-id-1"
      }
    });

    expect(product.title).toBe("Private file");

    const updated = await catalogService.updateProduct(product.id, {
      title: "Private file v2",
      shortDescription: "Updated archive"
    });

    expect(updated.title).toBe("Private file v2");
    expect(updated.shortDescription).toBe("Updated archive");
  });

  it("rejects duplicate license keys in the same product stock", async () => {
    const { catalogService } = createHarness();
    const product = await catalogService.createProduct({
      title: "License product",
      shortDescription: "Encrypted stock",
      type: "license_key",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "1",
      payload: {
        kind: "license_key"
      }
    });

    await catalogService.addLicenseStock(product.id, ["KEY-1"]);

    await expect(catalogService.addLicenseStock(product.id, ["KEY-1"])).rejects.toThrow(
      "already exist in stock"
    );
    await expect(catalogService.addLicenseStock(product.id, ["KEY-2", "KEY-2"])).rejects.toThrow(
      "Duplicate license keys were found in the import batch"
    );
  });
});
