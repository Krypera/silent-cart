import { EncryptionService } from "../crypto/encryption.js";
import { loadEnvConfig } from "../config/env.js";
import { Database } from "../db/database.js";
import { createPostgresStore } from "../repositories/postgresStore.js";
import { CatalogService } from "../services/catalogService.js";

async function main(): Promise<void> {
  const env = loadEnvConfig();
  const database = new Database(env.databaseUrl);

  try {
    const store = createPostgresStore(database);
    const catalogService = new CatalogService(
      store,
      new EncryptionService(env.fulfillmentEncryptionKey)
    );

    const existingProducts = await catalogService.listAllProducts();
    if (existingProducts.length > 0 && process.env.DEMO_SEED_FORCE !== "true") {
      console.log("[SilentCart] Catalog already contains products. Skipping demo seed.");
      console.log("Set DEMO_SEED_FORCE=true if you intentionally want to add sample products anyway.");
      return;
    }

    const sampleText = await catalogService.createProduct({
      title: "SilentCart Demo Text",
      shortDescription: "A tiny sample product for verifying the full Telegram -> Monero -> delivery flow.",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.01",
      payload: {
        kind: "text",
        content: [
          "SilentCart demo delivery",
          "",
          "If you received this message after paying, the core checkout and fulfillment flow is working.",
          "Replace this sample product with your own catalog before using the bot in production."
        ].join("\n")
      }
    });

    const sampleLink = await catalogService.createProduct({
      title: "SilentCart Demo Link",
      shortDescription: "A sample download-link product for testing non-file delivery.",
      type: "download_link",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.015",
      payload: {
        kind: "download_link",
        url: "https://example.com/silentcart-demo",
        note: "Replace this placeholder link before using SilentCart with real buyers."
      }
    });

    console.log("[SilentCart] Demo products created.");
    console.log(`- ${sampleText.title} (${sampleText.id})`);
    console.log(`- ${sampleLink.title} (${sampleLink.id})`);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
