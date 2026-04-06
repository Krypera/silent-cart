import type { QueryResultRow } from "pg";
import type {
  AdminUser,
  BotSetting,
  FulfillmentRecord,
  LicenseStockItem,
  Order,
  PaymentEvent,
  PricingMode,
  Product,
  ProductSnapshot,
  RetentionLink
} from "../../domain/models.js";

export function toBigInt(value: string | bigint | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function requireRow<T>(row: T | undefined, entityName: string): T {
  if (!row) {
    throw new Error(`Expected ${entityName} row to exist.`);
  }

  return row;
}

export interface ProductRow extends QueryResultRow {
  id: string;
  title: string;
  short_description: string;
  type: Product["type"];
  pricing_mode: PricingMode;
  fixed_price_atomic: string | null;
  usd_price_cents: number | null;
  active: boolean;
  encrypted_payload: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ProductSnapshotRow extends QueryResultRow {
  id: string;
  order_id: string;
  product_id: string;
  title: string;
  short_description: string;
  type: Product["type"];
  pricing_mode: PricingMode;
  quoted_amount_atomic: string;
  quoted_amount_xmr: string;
  usd_reference_cents: number | null;
  encrypted_payload_snapshot: string | null;
  payload_reference: string | null;
  created_at: Date | string;
}

export interface OrderRow extends QueryResultRow {
  id: string;
  product_id: string;
  state: Order["state"];
  pre_purge_state: Order["prePurgeState"];
  pricing_mode: PricingMode;
  quoted_amount_atomic: string;
  quoted_amount_xmr: string;
  usd_reference_cents: number | null;
  payment_address: string;
  account_index: number;
  subaddress_index: number;
  quote_expires_at: Date | string;
  payment_tx_hash: string | null;
  payment_received_atomic: string | null;
  payment_seen_at: Date | string | null;
  confirmed_at: Date | string | null;
  fulfilled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PaymentEventRow extends QueryResultRow {
  id: string;
  order_id: string;
  tx_hash: string;
  amount_atomic: string;
  confirmations: number;
  category: PaymentEvent["category"];
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  confirmed_at: Date | string | null;
}

export interface FulfillmentRow extends QueryResultRow {
  id: string;
  order_id: string;
  delivery_type: FulfillmentRecord["deliveryType"];
  status: FulfillmentRecord["status"];
  attempts: number;
  last_error_code: string | null;
  delivered_at: Date | string | null;
  last_attempt_at: Date | string | null;
  receipt_message_id: number | null;
}

export interface LicenseStockRow extends QueryResultRow {
  id: string;
  product_id: string;
  encrypted_secret: string;
  secret_fingerprint: string | null;
  state: LicenseStockItem["state"];
  reserved_order_id: string | null;
  consumed_order_id: string | null;
  reserved_at: Date | string | null;
  consumed_at: Date | string | null;
  created_at: Date | string;
}

export interface RetentionLinkRow extends QueryResultRow {
  order_id: string;
  telegram_user_id: string | null;
  expires_at: Date | string | null;
  purged_at: Date | string | null;
  created_at: Date | string;
}

export interface AdminUserRow extends QueryResultRow {
  telegram_user_id: string;
  created_at: Date | string;
}

export interface BotSettingRow extends QueryResultRow {
  key: string;
  value_json: unknown;
  updated_at: Date | string;
}

export function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    title: row.title,
    shortDescription: row.short_description,
    type: row.type,
    pricingMode: row.pricing_mode,
    fixedPriceAtomic: row.fixed_price_atomic ? toBigInt(row.fixed_price_atomic) : null,
    usdPriceCents: row.usd_price_cents,
    active: row.active,
    encryptedPayload: row.encrypted_payload,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at)
  };
}

export function mapSnapshot(row: ProductSnapshotRow): ProductSnapshot {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    title: row.title,
    shortDescription: row.short_description,
    type: row.type,
    pricingMode: row.pricing_mode,
    quotedAmountAtomic: toBigInt(row.quoted_amount_atomic),
    quotedAmountXmr: row.quoted_amount_xmr,
    usdReferenceCents: row.usd_reference_cents,
    encryptedPayloadSnapshot: row.encrypted_payload_snapshot,
    payloadReference: row.payload_reference,
    createdAt: toDate(row.created_at)
  };
}

export function mapOrder(row: OrderRow): Order {
  return {
    id: row.id,
    productId: row.product_id,
    state: row.state,
    prePurgeState: row.pre_purge_state,
    pricingMode: row.pricing_mode,
    quotedAmountAtomic: toBigInt(row.quoted_amount_atomic),
    quotedAmountXmr: row.quoted_amount_xmr,
    usdReferenceCents: row.usd_reference_cents,
    paymentAddress: row.payment_address,
    accountIndex: row.account_index,
    subaddressIndex: row.subaddress_index,
    quoteExpiresAt: toDate(row.quote_expires_at),
    paymentTxHash: row.payment_tx_hash,
    paymentReceivedAtomic: row.payment_received_atomic ? toBigInt(row.payment_received_atomic) : null,
    paymentSeenAt: row.payment_seen_at ? toDate(row.payment_seen_at) : null,
    confirmedAt: row.confirmed_at ? toDate(row.confirmed_at) : null,
    fulfilledAt: row.fulfilled_at ? toDate(row.fulfilled_at) : null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at)
  };
}

export function mapPayment(row: PaymentEventRow): PaymentEvent {
  return {
    id: row.id,
    orderId: row.order_id,
    txHash: row.tx_hash,
    amountAtomic: toBigInt(row.amount_atomic),
    confirmations: row.confirmations,
    category: row.category,
    firstSeenAt: toDate(row.first_seen_at),
    lastSeenAt: toDate(row.last_seen_at),
    confirmedAt: row.confirmed_at ? toDate(row.confirmed_at) : null
  };
}

export function mapFulfillment(row: FulfillmentRow): FulfillmentRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    deliveryType: row.delivery_type,
    status: row.status,
    attempts: row.attempts,
    lastErrorCode: row.last_error_code,
    deliveredAt: row.delivered_at ? toDate(row.delivered_at) : null,
    lastAttemptAt: row.last_attempt_at ? toDate(row.last_attempt_at) : null,
    receiptMessageId: row.receipt_message_id
  };
}

export function mapLicenseStock(row: LicenseStockRow): LicenseStockItem {
  return {
    id: row.id,
    productId: row.product_id,
    encryptedSecret: row.encrypted_secret,
    secretFingerprint: row.secret_fingerprint,
    state: row.state,
    reservedOrderId: row.reserved_order_id,
    consumedOrderId: row.consumed_order_id,
    reservedAt: row.reserved_at ? toDate(row.reserved_at) : null,
    consumedAt: row.consumed_at ? toDate(row.consumed_at) : null,
    createdAt: toDate(row.created_at)
  };
}

export function mapRetentionLink(row: RetentionLinkRow): RetentionLink {
  return {
    orderId: row.order_id,
    telegramUserId: row.telegram_user_id ? toBigInt(row.telegram_user_id) : null,
    expiresAt: row.expires_at ? toDate(row.expires_at) : null,
    purgedAt: row.purged_at ? toDate(row.purged_at) : null,
    createdAt: toDate(row.created_at)
  };
}

export function mapAdminUser(row: AdminUserRow): AdminUser {
  return {
    telegramUserId: toBigInt(row.telegram_user_id),
    createdAt: toDate(row.created_at)
  };
}

export function mapSetting(row: BotSettingRow): BotSetting {
  return {
    key: row.key,
    valueJson: row.value_json,
    updatedAt: toDate(row.updated_at)
  };
}
