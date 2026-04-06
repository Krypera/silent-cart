import type {
  AdminUser,
  BotSetting,
  FulfillmentRecord,
  LicenseStockItem,
  Order,
  OrderState,
  PaymentEvent,
  PricingMode,
  Product,
  ProductSnapshot,
  RetentionLink
} from "../domain/models.js";
import type { SilentCartStore } from "./store.js";

function cloneDate(date: Date | null): Date | null {
  return date ? new Date(date) : null;
}

export class InMemoryStore implements SilentCartStore {
  private readonly productMap = new Map<string, Product>();
  private readonly snapshotMap = new Map<string, ProductSnapshot>();
  private readonly orderMap = new Map<string, Order>();
  private readonly paymentMap = new Map<string, PaymentEvent>();
  private readonly fulfillmentMap = new Map<string, FulfillmentRecord>();
  private readonly licenseMap = new Map<string, LicenseStockItem>();
  private readonly settingMap = new Map<string, BotSetting>();
  private readonly retentionMap = new Map<string, RetentionLink>();
  private readonly adminMap = new Map<string, AdminUser>();

  public readonly products = {
    create: async (input: {
      id: string;
      title: string;
      shortDescription: string;
      type: Product["type"];
      pricingMode: PricingMode;
      fixedPriceAtomic: bigint | null;
      usdPriceCents: number | null;
      encryptedPayload: string | null;
      active: boolean;
    }) => {
      const now = new Date();
      const product: Product = {
        ...input,
        createdAt: now,
        updatedAt: now
      };
      this.productMap.set(product.id, product);
      return product;
    },
    update: async (id: string, patch: Partial<Product>) => {
      const existing = this.productMap.get(id);
      if (!existing) {
        throw new Error(`Missing product ${id}`);
      }
      const updated: Product = {
        ...existing,
        ...patch,
        updatedAt: new Date()
      };
      this.productMap.set(id, updated);
      return updated;
    },
    findById: async (id: string) => this.productMap.get(id) ?? null,
    listActive: async () =>
      [...this.productMap.values()].filter((product) => product.active),
    listAll: async () => [...this.productMap.values()],
    listLicenseProducts: async () =>
      [...this.productMap.values()].filter((product) => product.type === "license_key")
  };

  public readonly snapshots = {
    create: async (input: {
      id: string;
      orderId: string;
      productId: string;
      title: string;
      shortDescription: string;
      type: Product["type"];
      pricingMode: PricingMode;
      quotedAmountAtomic: bigint;
      quotedAmountXmr: string;
      usdReferenceCents: number | null;
      encryptedPayloadSnapshot: string | null;
      payloadReference: string | null;
    }) => {
      const snapshot: ProductSnapshot = {
        ...input,
        createdAt: new Date()
      };
      this.snapshotMap.set(snapshot.orderId, snapshot);
      return snapshot;
    },
    findByOrderId: async (orderId: string) => this.snapshotMap.get(orderId) ?? null,
    update: async (
      orderId: string,
      patch: Partial<Pick<ProductSnapshot, "payloadReference">>
    ) => {
      const existing = this.snapshotMap.get(orderId);
      if (!existing) {
        throw new Error(`Missing product snapshot for order ${orderId}`);
      }

      const updated: ProductSnapshot = {
        ...existing,
        ...patch
      };
      this.snapshotMap.set(orderId, updated);
      return updated;
    }
  };

  public readonly orders = {
    create: async (input: {
      id: string;
      productId: string;
      state: OrderState;
      prePurgeState: OrderState | null;
      pricingMode: PricingMode;
      quotedAmountAtomic: bigint;
      quotedAmountXmr: string;
      usdReferenceCents: number | null;
      paymentAddress: string;
      accountIndex: number;
      subaddressIndex: number;
      quoteExpiresAt: Date;
      paymentTxHash: string | null;
      paymentReceivedAtomic: bigint | null;
      paymentSeenAt: Date | null;
      confirmedAt: Date | null;
      fulfilledAt: Date | null;
    }) => {
      const now = new Date();
      const order: Order = {
        ...input,
        createdAt: now,
        updatedAt: now
      };
      this.orderMap.set(order.id, order);
      return order;
    },
    update: async (id: string, patch: Partial<Order>) => {
      const existing = this.orderMap.get(id);
      if (!existing) {
        throw new Error(`Missing order ${id}`);
      }
      const updated: Order = {
        ...existing,
        ...patch,
        updatedAt: new Date()
      };
      this.orderMap.set(id, updated);
      return updated;
    },
    findById: async (id: string) => this.orderMap.get(id) ?? null,
    listByStates: async (states: OrderState[], limit?: number, offset = 0) => {
      const items = [...this.orderMap.values()]
        .filter((order) => states.includes(order.state))
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      const paged = offset > 0 ? items.slice(offset) : items;
      return typeof limit === "number" ? paged.slice(0, limit) : paged;
    },
    listRecent: async (limit: number, offset = 0, states?: OrderState[]) =>
      [...this.orderMap.values()]
        .filter((order) => !states || states.includes(order.state))
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(offset, offset + limit),
    countMatching: async (states?: OrderState[]) =>
      [...this.orderMap.values()].filter((order) => !states || states.includes(order.state)).length,
    countByState: async (state: OrderState) =>
      [...this.orderMap.values()].filter((order) => order.state === state).length,
    countHistoricallyFulfilled: async () =>
      [...this.orderMap.values()].filter(
        (order) => order.state === "fulfilled" || order.prePurgeState === "fulfilled"
      ).length,
    countOpenOrders: async () =>
      [...this.orderMap.values()].filter((order) =>
        ["awaiting_payment", "payment_seen", "confirmed"].includes(order.state)
      ).length,
    sumSettledAtomic: async () =>
      [...this.orderMap.values()].reduce((sum, order) => {
        if (order.state === "fulfilled" || order.prePurgeState === "fulfilled") {
          return sum + order.quotedAmountAtomic;
        }
        return sum;
      }, 0n)
  };

  public readonly payments = {
    upsert: async (input: {
      id: string;
      orderId: string;
      txHash: string;
      amountAtomic: bigint;
      confirmations: number;
      category: PaymentEvent["category"];
      firstSeenAt: Date;
      lastSeenAt: Date;
      confirmedAt: Date | null;
    }) => {
      const key = `${input.orderId}:${input.txHash}`;
      const existing = this.paymentMap.get(key);
      const payment: PaymentEvent = {
        id: existing?.id ?? input.id,
        orderId: input.orderId,
        txHash: input.txHash,
        amountAtomic: input.amountAtomic,
        confirmations: input.confirmations,
        category: input.category,
        firstSeenAt: existing?.firstSeenAt ?? input.firstSeenAt,
        lastSeenAt: input.lastSeenAt,
        confirmedAt: input.confirmedAt
      };
      this.paymentMap.set(key, payment);
      return payment;
    },
    findByOrderId: async (orderId: string) =>
      [...this.paymentMap.values()]
        .filter((payment) => payment.orderId === orderId)
        .sort((left, right) => left.firstSeenAt.getTime() - right.firstSeenAt.getTime()),
    findByTxHash: async (txHash: string) =>
      [...this.paymentMap.values()]
        .filter((payment) => payment.txHash === txHash)
        .sort((left, right) => left.firstSeenAt.getTime() - right.firstSeenAt.getTime()),
    listRecent: async (limit: number) =>
      [...this.paymentMap.values()]
        .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
        .slice(0, limit)
  };

  public readonly fulfillments = {
    createOrUpdate: async (input: {
      id: string;
      orderId: string;
      deliveryType: FulfillmentRecord["deliveryType"];
      status: FulfillmentRecord["status"];
      attempts: number;
      lastErrorCode: string | null;
      deliveredAt: Date | null;
      lastAttemptAt: Date | null;
      receiptMessageId: number | null;
    }) => {
      const fulfillment: FulfillmentRecord = {
        id: this.fulfillmentMap.get(input.orderId)?.id ?? input.id,
        orderId: input.orderId,
        deliveryType: input.deliveryType,
        status: input.status,
        attempts: input.attempts,
        lastErrorCode: input.lastErrorCode,
        deliveredAt: cloneDate(input.deliveredAt),
        lastAttemptAt: cloneDate(input.lastAttemptAt),
        receiptMessageId: input.receiptMessageId
      };
      this.fulfillmentMap.set(input.orderId, fulfillment);
      return fulfillment;
    },
    findByOrderId: async (orderId: string) => this.fulfillmentMap.get(orderId) ?? null,
    listByStatus: async (status: FulfillmentRecord["status"]) =>
      [...this.fulfillmentMap.values()].filter((record) => record.status === status)
  };

  public readonly licenseStock = {
    add: async (input: {
      id: string;
      productId: string;
      encryptedSecret: string;
      secretFingerprint: string | null;
    }) => {
      const item: LicenseStockItem = {
        id: input.id,
        productId: input.productId,
        encryptedSecret: input.encryptedSecret,
        secretFingerprint: input.secretFingerprint,
        state: "available",
        reservedOrderId: null,
        consumedOrderId: null,
        reservedAt: null,
        consumedAt: null,
        createdAt: new Date()
      };
      this.licenseMap.set(item.id, item);
      return item;
    },
    reserveAvailable: async (productId: string, orderId: string) => {
      const item = [...this.licenseMap.values()].find(
        (candidate) => candidate.productId === productId && candidate.state === "available"
      );
      if (!item) {
        return null;
      }
      const updated: LicenseStockItem = {
        ...item,
        state: "reserved",
        reservedOrderId: orderId,
        reservedAt: new Date()
      };
      this.licenseMap.set(item.id, updated);
      return updated;
    },
    releaseReservation: async (orderId: string) => {
      for (const item of this.licenseMap.values()) {
        if (item.reservedOrderId === orderId && item.state === "reserved") {
          this.licenseMap.set(item.id, {
            ...item,
            state: "available",
            reservedOrderId: null,
            reservedAt: null
          });
        }
      }
    },
    finalizeReservation: async (orderId: string) => {
      const item = [...this.licenseMap.values()].find(
        (candidate) =>
          candidate.reservedOrderId === orderId || candidate.consumedOrderId === orderId
      );
      if (!item) {
        return null;
      }
      const updated: LicenseStockItem = {
        ...item,
        state: "consumed",
        consumedOrderId: orderId,
        consumedAt: item.consumedAt ?? new Date()
      };
      this.licenseMap.set(item.id, updated);
      return updated;
    },
    findByConsumedOrderId: async (orderId: string) =>
      [...this.licenseMap.values()].find((item) => item.consumedOrderId === orderId) ?? null,
    findByReservedOrderId: async (orderId: string) =>
      [...this.licenseMap.values()].find((item) => item.reservedOrderId === orderId) ?? null,
    listByProductId: async (productId: string) =>
      [...this.licenseMap.values()].filter((item) => item.productId === productId)
  };

  public readonly settings = {
    get: async <T>(key: string) => (this.settingMap.get(key)?.valueJson as T | undefined) ?? null,
    set: async (key: string, valueJson: unknown) => {
      const setting: BotSetting = {
        key,
        valueJson,
        updatedAt: new Date()
      };
      this.settingMap.set(key, setting);
      return setting;
    },
    delete: async (key: string) => {
      this.settingMap.delete(key);
    }
  };

  public readonly retention = {
    create: async (input: {
      orderId: string;
      telegramUserId: bigint;
      expiresAt: Date | null;
      purgedAt: Date | null;
    }) => {
      const link: RetentionLink = {
        orderId: input.orderId,
        telegramUserId: input.telegramUserId,
        expiresAt: cloneDate(input.expiresAt),
        purgedAt: cloneDate(input.purgedAt),
        createdAt: new Date()
      };
      this.retentionMap.set(link.orderId, link);
      return link;
    },
    findByOrderId: async (orderId: string) => this.retentionMap.get(orderId) ?? null,
    listByTelegramUserId: async (telegramUserId: bigint) =>
      [...this.retentionMap.values()].filter(
        (link) => link.telegramUserId === telegramUserId && link.purgedAt === null
      ),
    listExpired: async (now: Date) =>
      [...this.retentionMap.values()].filter(
        (link) => link.expiresAt !== null && link.expiresAt.getTime() <= now.getTime() && !link.purgedAt
      ),
    update: async (
      orderId: string,
      patch: Partial<Pick<RetentionLink, "telegramUserId" | "expiresAt" | "purgedAt">>
    ) => {
      const existing = this.retentionMap.get(orderId);
      if (!existing) {
        throw new Error(`Missing retention link ${orderId}`);
      }
      const updated: RetentionLink = {
        ...existing,
        ...patch,
        expiresAt:
          patch.expiresAt === undefined ? existing.expiresAt : cloneDate(patch.expiresAt),
        purgedAt: patch.purgedAt === undefined ? existing.purgedAt : cloneDate(patch.purgedAt)
      };
      this.retentionMap.set(orderId, updated);
      return updated;
    }
  };

  public readonly admins = {
    syncAllowlist: async (ids: bigint[]) => {
      this.adminMap.clear();
      for (const id of ids) {
        this.adminMap.set(id.toString(), {
          telegramUserId: id,
          createdAt: new Date()
        });
      }
    },
    isKnownAdmin: async (telegramUserId: bigint) => this.adminMap.has(telegramUserId.toString()),
    listAll: async () => [...this.adminMap.values()]
  };

  public async withTransaction<T>(callback: (store: SilentCartStore) => Promise<T>): Promise<T> {
    return callback(this);
  }
}
