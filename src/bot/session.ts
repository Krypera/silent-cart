import type { Context } from "telegraf";
import type { ProductPayload, ProductType, PricingMode } from "../domain/models.js";

export type AdminDraftProduct = {
  title?: string;
  shortDescription?: string;
  type?: ProductType;
  pricingMode?: PricingMode;
  fixedXmrAmount?: string;
  usdPriceCents?: number;
  payload?: ProductPayload;
};

export type PendingAdminAction =
  | { kind: "add_product_title"; draft: AdminDraftProduct }
  | { kind: "add_product_description"; draft: AdminDraftProduct }
  | { kind: "add_product_price"; draft: AdminDraftProduct }
  | { kind: "add_product_payload"; draft: AdminDraftProduct }
  | { kind: "review_product"; draft: AdminDraftProduct }
  | { kind: "edit_title"; productId: string }
  | { kind: "edit_description"; productId: string }
  | { kind: "edit_price"; productId: string }
  | { kind: "edit_payload"; productId: string }
  | { kind: "add_stock"; productId: string }
  | { kind: "edit_why_monero" };

export interface BotSessionData {
  adminAction?: PendingAdminAction;
}

export type BotContext = Context & {
  session: BotSessionData;
};
