import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EncryptionService } from "../../src/crypto/encryption.js";
import { Database } from "../../src/db/database.js";
import { runMigrations } from "../../src/db/migrationRunner.js";
import { createPostgresStore } from "../../src/repositories/postgresStore.js";
import { CatalogService } from "../../src/services/catalogService.js";
import { FulfillmentEngine } from "../../src/services/fulfillment/fulfillmentEngine.js";
import { OperatorAlertService } from "../../src/services/operatorAlertService.js";
import { OrderService } from "../../src/services/orderService.js";
import { PricingService } from "../../src/services/pricingService.js";
import { RetentionService } from "../../src/services/retentionService.js";
import { FakeMessenger, FakeMoneroAdapter, StaticRateProvider } from "../helpers/harness.js";

const describeWithDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

async function truncateAll(database: Database): Promise<void> {
  await database.query(`
    truncate table
      admin_users,
      retention_links,
      fulfillment_records,
      payment_events,
      product_snapshots,
      orders,
      license_stock_items,
      products,
      bot_settings
    restart identity cascade
  `);
}

describeWithDatabase("Postgres smoke tests", () => {
  let database: Database;

  beforeAll(async () => {
    database = new Database(process.env.TEST_DATABASE_URL as string);
    await runMigrations(database, path.join(currentDir, "../../src/db/migrations"));
  });

  beforeEach(async () => {
    await truncateAll(database);
  });

  afterAll(async () => {
    await database.close();
  });

  it("runs a product to fulfillment lifecycle against Postgres", async () => {
    const store = createPostgresStore(database);
    const encryptionService = new EncryptionService(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    const pricingService = new PricingService(new StaticRateProvider(150), true);
    const catalogService = new CatalogService(store, encryptionService);
    const moneroAdapter = new FakeMoneroAdapter();
    const retentionService = new RetentionService(store, 30);
    const orderService = new OrderService(store, catalogService, pricingService, moneroAdapter, 30);
    const operatorAlertService = new OperatorAlertService(store, new FakeMessenger(), 1000);
    const fulfillmentEngine = new FulfillmentEngine(
      store,
      catalogService,
      orderService,
      retentionService,
      new FakeMessenger(),
      operatorAlertService
    );

    const product = await catalogService.createProduct({
      title: "Postgres product",
      shortDescription: "Smoke",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.4",
      payload: {
        kind: "text",
        content: "postgres payload"
      }
    });
    const order = await orderService.createOrder(product.id, 88n);
    await orderService.markConfirmed(order.id, "tx-pg-1", order.quotedAmountAtomic, new Date());
    await fulfillmentEngine.fulfillOrder(order.id);

    const persistedOrder = await store.orders.findById(order.id);
    const snapshot = await store.snapshots.findByOrderId(order.id);
    const fulfillment = await store.fulfillments.findByOrderId(order.id);
    const retentionLink = await store.retention.findByOrderId(order.id);

    expect(persistedOrder?.state).toBe("fulfilled");
    expect(snapshot?.title).toBe("Postgres product");
    expect(fulfillment?.status).toBe("delivered");
    expect(retentionLink?.telegramUserId).toBe(88n);
  });

  it("counts and pages recent orders against Postgres", async () => {
    const store = createPostgresStore(database);
    const encryptionService = new EncryptionService(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    const pricingService = new PricingService(new StaticRateProvider(150), true);
    const catalogService = new CatalogService(store, encryptionService);
    const moneroAdapter = new FakeMoneroAdapter();
    const orderService = new OrderService(store, catalogService, pricingService, moneroAdapter, 30);

    const product = await catalogService.createProduct({
      title: "Order paging product",
      shortDescription: "Smoke",
      type: "text",
      pricingMode: "fixed_xmr",
      fixedXmrAmount: "0.1",
      payload: {
        kind: "text",
        content: "payload"
      }
    });

    const created = await orderService.createOrder(product.id, 10n, new Date("2026-01-01T00:00:00.000Z"));
    const awaiting = await orderService.createOrder(product.id, 11n, new Date("2026-01-01T00:01:00.000Z"));
    await store.orders.update(created.id, { state: "created" });
    await store.orders.update(awaiting.id, { state: "awaiting_payment" });

    const recent = await store.orders.listRecent(1, 0, ["awaiting_payment"]);
    const createdCount = await store.orders.countMatching(["created"]);

    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe(awaiting.id);
    expect(createdCount).toBe(1);
  });
});
