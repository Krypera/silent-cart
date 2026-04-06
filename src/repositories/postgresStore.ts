import type { PoolClient } from "pg";
import { Database, type Queryable } from "../db/database.js";
import { createAdminsRepository } from "./postgres/adminsRepository.js";
import { createFulfillmentsRepository } from "./postgres/fulfillmentsRepository.js";
import { createLicenseStockRepository } from "./postgres/licenseStockRepository.js";
import { createOrdersRepository } from "./postgres/ordersRepository.js";
import { createPaymentsRepository } from "./postgres/paymentsRepository.js";
import { createProductsRepository } from "./postgres/productsRepository.js";
import { createRetentionRepository } from "./postgres/retentionRepository.js";
import { createSettingsRepository } from "./postgres/settingsRepository.js";
import { createSnapshotsRepository } from "./postgres/snapshotsRepository.js";
import type { SilentCartStore } from "./store.js";

class PostgresSilentCartStore implements SilentCartStore {
  public readonly products: SilentCartStore["products"];
  public readonly snapshots: SilentCartStore["snapshots"];
  public readonly orders: SilentCartStore["orders"];
  public readonly payments: SilentCartStore["payments"];
  public readonly fulfillments: SilentCartStore["fulfillments"];
  public readonly licenseStock: SilentCartStore["licenseStock"];
  public readonly settings: SilentCartStore["settings"];
  public readonly retention: SilentCartStore["retention"];
  public readonly admins: SilentCartStore["admins"];

  public constructor(
    private readonly database: Database,
    private readonly executor: Queryable
  ) {
    this.products = createProductsRepository(executor);
    this.snapshots = createSnapshotsRepository(executor);
    this.orders = createOrdersRepository(executor);
    this.payments = createPaymentsRepository(executor);
    this.fulfillments = createFulfillmentsRepository(executor);
    this.licenseStock = createLicenseStockRepository(executor);
    this.settings = createSettingsRepository(executor);
    this.retention = createRetentionRepository(executor);
    this.admins = createAdminsRepository(executor);
  }

  public async withTransaction<T>(callback: (store: SilentCartStore) => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (client: PoolClient) => {
      const txStore = new PostgresSilentCartStore(this.database, client);
      return callback(txStore);
    });
  }
}

export function createPostgresStore(database: Database): SilentCartStore {
  return new PostgresSilentCartStore(database, database);
}
