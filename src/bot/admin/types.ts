import { Markup } from "telegraf";
import type { OrderState, ProductPayload } from "../../domain/models.js";
import type { AdminDraftProduct } from "../session.js";

export type CallbackButton = ReturnType<typeof Markup.button.callback>;
export type ButtonRow = CallbackButton[];

export interface CompleteDraftProduct extends Required<Omit<AdminDraftProduct, "payload">> {
  payload: ProductPayload;
}

export type AdminOrderFilter = "all" | OrderState | "manual_review";

export const ADMIN_PRODUCTS_PAGE_SIZE = 8;
export const ADMIN_ORDERS_PAGE_SIZE = 8;
