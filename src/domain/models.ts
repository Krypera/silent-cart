export const productTypes = [
  "file",
  "text",
  "download_link",
  "license_key"
] as const;

export type ProductType = (typeof productTypes)[number];

export const pricingModes = ["fixed_xmr", "usd_anchored"] as const;

export type PricingMode = (typeof pricingModes)[number];

export const orderStates = [
  "created",
  "awaiting_payment",
  "payment_seen",
  "confirmed",
  "fulfilled",
  "underpaid",
  "expired",
  "purged"
] as const;

export type OrderState = (typeof orderStates)[number];

export const fulfillmentStatuses = [
  "pending",
  "processing",
  "delivered",
  "failed",
  "manual_review"
] as const;

export type FulfillmentStatus = (typeof fulfillmentStatuses)[number];

export const licenseStockStates = [
  "available",
  "reserved",
  "consumed"
] as const;

export type LicenseStockState = (typeof licenseStockStates)[number];

export interface Product {
  id: string;
  title: string;
  shortDescription: string;
  type: ProductType;
  pricingMode: PricingMode;
  fixedPriceAtomic: bigint | null;
  usdPriceCents: number | null;
  active: boolean;
  encryptedPayload: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductSnapshot {
  id: string;
  orderId: string;
  productId: string;
  title: string;
  shortDescription: string;
  type: ProductType;
  pricingMode: PricingMode;
  quotedAmountAtomic: bigint;
  quotedAmountXmr: string;
  usdReferenceCents: number | null;
  encryptedPayloadSnapshot: string | null;
  payloadReference: string | null;
  createdAt: Date;
}

export interface Order {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentEvent {
  id: string;
  orderId: string;
  txHash: string;
  amountAtomic: bigint;
  confirmations: number;
  category: "qualifying" | "underpaid";
  firstSeenAt: Date;
  lastSeenAt: Date;
  confirmedAt: Date | null;
}

export interface FulfillmentRecord {
  id: string;
  orderId: string;
  deliveryType: ProductType;
  status: FulfillmentStatus;
  attempts: number;
  lastErrorCode: string | null;
  deliveredAt: Date | null;
  lastAttemptAt: Date | null;
  receiptMessageId: number | null;
}

export interface LicenseStockItem {
  id: string;
  productId: string;
  encryptedSecret: string;
  secretFingerprint: string | null;
  state: LicenseStockState;
  reservedOrderId: string | null;
  consumedOrderId: string | null;
  reservedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface BotSetting {
  key: string;
  valueJson: unknown;
  updatedAt: Date;
}

export interface RetentionLink {
  orderId: string;
  telegramUserId: bigint | null;
  expiresAt: Date | null;
  purgedAt: Date | null;
  createdAt: Date;
}

export interface AdminUser {
  telegramUserId: bigint;
  createdAt: Date;
}

export interface FilePayload {
  kind: "file";
  telegramFileId: string;
  fileName?: string;
  caption?: string;
}

export interface TextPayload {
  kind: "text";
  content: string;
}

export interface DownloadLinkPayload {
  kind: "download_link";
  url: string;
  label?: string;
  note?: string;
}

export interface LicenseProductPayload {
  kind: "license_key";
  note?: string;
}

export type ProductPayload =
  | FilePayload
  | TextPayload
  | DownloadLinkPayload
  | LicenseProductPayload;

export interface LicenseReservationReference {
  stockItemId: string;
}

export interface QuoteResult {
  pricingMode: PricingMode;
  quotedAmountAtomic: bigint;
  quotedAmountXmr: string;
  usdReferenceCents: number | null;
  usdPerXmr: number | null;
}

export interface PublicProductView {
  id: string;
  title: string;
  shortDescription: string;
  type: ProductType;
  pricingMode: PricingMode;
  active: boolean;
  xmrAmount: string;
  usdReference: string | null;
}
