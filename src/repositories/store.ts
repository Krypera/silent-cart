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

export interface ProductStore {
  create(input: {
    id: string;
    title: string;
    shortDescription: string;
    type: Product["type"];
    pricingMode: PricingMode;
    fixedPriceAtomic: bigint | null;
    usdPriceCents: number | null;
    encryptedPayload: string | null;
    active: boolean;
  }): Promise<Product>;
  update(
    id: string,
    patch: Partial<{
      title: string;
      shortDescription: string;
      pricingMode: PricingMode;
      fixedPriceAtomic: bigint | null;
      usdPriceCents: number | null;
      encryptedPayload: string | null;
      active: boolean;
    }>
  ): Promise<Product>;
  findById(id: string): Promise<Product | null>;
  listActive(): Promise<Product[]>;
  listAll(): Promise<Product[]>;
  listLicenseProducts(): Promise<Product[]>;
}

export interface ProductSnapshotStore {
  create(input: {
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
  }): Promise<ProductSnapshot>;
  findByOrderId(orderId: string): Promise<ProductSnapshot | null>;
  update(
    orderId: string,
    patch: Partial<Pick<ProductSnapshot, "payloadReference">>
  ): Promise<ProductSnapshot>;
}

export interface OrderStore {
  create(input: {
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
  }): Promise<Order>;
  update(
    id: string,
    patch: Partial<
      Pick<
        Order,
        | "state"
        | "prePurgeState"
        | "paymentTxHash"
        | "paymentReceivedAtomic"
        | "paymentSeenAt"
        | "confirmedAt"
        | "fulfilledAt"
      >
    >
  ): Promise<Order>;
  findById(id: string): Promise<Order | null>;
  listByStates(states: OrderState[], limit?: number, offset?: number): Promise<Order[]>;
  listRecent(limit: number, offset?: number, states?: OrderState[]): Promise<Order[]>;
  countMatching(states?: OrderState[]): Promise<number>;
  countByState(state: OrderState): Promise<number>;
  countHistoricallyFulfilled(): Promise<number>;
  countOpenOrders(): Promise<number>;
  sumSettledAtomic(): Promise<bigint>;
}

export interface PaymentEventStore {
  upsert(input: {
    id: string;
    orderId: string;
    txHash: string;
    amountAtomic: bigint;
    confirmations: number;
    category: PaymentEvent["category"];
    firstSeenAt: Date;
    lastSeenAt: Date;
    confirmedAt: Date | null;
  }): Promise<PaymentEvent>;
  findByOrderId(orderId: string): Promise<PaymentEvent[]>;
  listRecent(limit: number): Promise<PaymentEvent[]>;
}

export interface FulfillmentStore {
  createOrUpdate(input: {
    id: string;
    orderId: string;
    deliveryType: FulfillmentRecord["deliveryType"];
    status: FulfillmentRecord["status"];
    attempts: number;
    lastErrorCode: string | null;
    deliveredAt: Date | null;
    lastAttemptAt: Date | null;
    receiptMessageId: number | null;
  }): Promise<FulfillmentRecord>;
  findByOrderId(orderId: string): Promise<FulfillmentRecord | null>;
  listByStatus(status: FulfillmentRecord["status"]): Promise<FulfillmentRecord[]>;
}

export interface LicenseStockStore {
  add(input: {
    id: string;
    productId: string;
    encryptedSecret: string;
    secretFingerprint: string | null;
  }): Promise<LicenseStockItem>;
  reserveAvailable(productId: string, orderId: string): Promise<LicenseStockItem | null>;
  releaseReservation(orderId: string): Promise<void>;
  finalizeReservation(orderId: string): Promise<LicenseStockItem | null>;
  findByConsumedOrderId(orderId: string): Promise<LicenseStockItem | null>;
  findByReservedOrderId(orderId: string): Promise<LicenseStockItem | null>;
  listByProductId(productId: string): Promise<LicenseStockItem[]>;
}

export interface BotSettingStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, valueJson: unknown): Promise<BotSetting>;
  delete(key: string): Promise<void>;
}

export interface RetentionLinkStore {
  create(input: {
    orderId: string;
    telegramUserId: bigint;
    expiresAt: Date | null;
    purgedAt: Date | null;
  }): Promise<RetentionLink>;
  findByOrderId(orderId: string): Promise<RetentionLink | null>;
  listByTelegramUserId(telegramUserId: bigint): Promise<RetentionLink[]>;
  listExpired(now: Date): Promise<RetentionLink[]>;
  update(
    orderId: string,
    patch: Partial<Pick<RetentionLink, "telegramUserId" | "expiresAt" | "purgedAt">>
  ): Promise<RetentionLink>;
}

export interface AdminUserStore {
  syncAllowlist(ids: bigint[]): Promise<void>;
  isKnownAdmin(telegramUserId: bigint): Promise<boolean>;
  listAll(): Promise<AdminUser[]>;
}

export interface SilentCartStore {
  readonly products: ProductStore;
  readonly snapshots: ProductSnapshotStore;
  readonly orders: OrderStore;
  readonly payments: PaymentEventStore;
  readonly fulfillments: FulfillmentStore;
  readonly licenseStock: LicenseStockStore;
  readonly settings: BotSettingStore;
  readonly retention: RetentionLinkStore;
  readonly admins: AdminUserStore;
  withTransaction<T>(callback: (store: SilentCartStore) => Promise<T>): Promise<T>;
}
