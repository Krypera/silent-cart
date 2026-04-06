import { Markup } from "telegraf";
import type { AppServices } from "../../app/services.js";
import type { PricingMode, ProductType } from "../../domain/models.js";
import type { BotContext } from "../session.js";
import type { ButtonRow } from "./types.js";

export function adminMenuKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Products", "admin:products"), Markup.button.callback("Orders", "admin:orders")],
    [Markup.button.callback("Stock", "admin:stock"), Markup.button.callback("Wallet", "admin:wallet")],
    [Markup.button.callback("Stats", "admin:stats"), Markup.button.callback("Settings", "admin:settings")],
    [Markup.button.callback("Add Product", "admin:product:add")]
  ]);
}

export function cancelKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([[Markup.button.callback("Cancel Current Action", "admin:cancel")]]);
}

export function addCancelRow(rows: ButtonRow[]): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([...rows, [Markup.button.callback("Cancel Current Action", "admin:cancel")]]);
}

export function formatProductType(type: ProductType): string {
  switch (type) {
    case "file":
      return "File delivery";
    case "text":
      return "Text/code delivery";
    case "download_link":
      return "Download link delivery";
    case "license_key":
      return "License key delivery";
  }
}

export function formatPricingMode(mode: PricingMode): string {
  return mode === "fixed_xmr" ? "Fixed XMR" : "USD anchored";
}

export function parseUsdInput(input: string): number {
  const value = Number.parseFloat(input.trim());
  if (Number.isNaN(value) || value <= 0) {
    throw new Error("Send a positive USD price, for example 12.50.");
  }

  return Math.round(value * 100);
}

export function hasDocumentMessage(
  ctx: BotContext
): ctx is BotContext & {
  message: {
    document: {
      file_id: string;
      file_name?: string;
    };
  };
} {
  return Boolean(ctx.message && "document" in ctx.message && ctx.message.document);
}

export function getMessageText(ctx: BotContext): string | null {
  if (!ctx.message || !("text" in ctx.message)) {
    return null;
  }

  return ctx.message.text;
}

export function getMatchValue(match: RegExpExecArray, index = 1): string | null {
  return match[index] ?? null;
}

export async function assertAdmin(ctx: BotContext, services: AppServices): Promise<boolean> {
  if (!ctx.from || !ctx.chat) {
    return false;
  }

  try {
    await services.adminAuthorizationService.assertAdminPrivateChat(BigInt(ctx.from.id), ctx.chat.type);
    return true;
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Admin authorization failed.");
    return false;
  }
}

export function clearAdminAction(ctx: BotContext): void {
  ctx.session.adminAction = undefined;
}

export async function cancelAdminAction(ctx: BotContext): Promise<void> {
  if (!ctx.session.adminAction) {
    await ctx.reply("There is no active admin action to cancel.", adminMenuKeyboard());
    return;
  }

  clearAdminAction(ctx);
  await ctx.reply("The current admin action was canceled.", adminMenuKeyboard());
}
