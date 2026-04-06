import QRCode from "qrcode";
import { Markup, type Telegraf } from "telegraf";
import type { AppServices } from "../../app/services.js";
import { NotFoundError } from "../../domain/errors.js";
import { formatUsdCents } from "../../utils/money.js";
import type { BotContext } from "../session.js";
import { customerErrorMessage, getMatchValue } from "./common.js";

export function buildCheckoutCaption(
  order: {
    id: string;
    quotedAmountXmr: string;
    usdReferenceCents: number | null;
    paymentAddress: string;
    quoteExpiresAt: Date;
    state: string;
  },
  title: string,
  retentionDays: number
): string {
  const lines = [
    `Order ${order.id}`,
    "",
    title,
    "",
    `Order status: ${order.state}`,
    `Send exactly: ${order.quotedAmountXmr} XMR`
  ];

  if (order.usdReferenceCents !== null) {
    lines.push(`USD reference at quote time: ${formatUsdCents(order.usdReferenceCents)}`);
  }

  lines.push(
    `Payment address: ${order.paymentAddress}`,
    `Quote expires at: ${order.quoteExpiresAt.toISOString()}`,
    "",
    "Payment policy",
    "Send the exact amount if possible.",
    "Underpaid transfers do not unlock fulfillment.",
    "A later standalone qualifying payment can still be accepted before the quote expires.",
    "Overpayments are not refunded.",
    "Payments are final.",
    "Fulfillment happens after 1 confirmation.",
    "",
    `The Telegram delivery link is temporary. By default it is severed ${retentionDays} days after fulfillment.`
  );

  return lines.join("\n");
}

export async function sendCheckoutInstructions(
  ctx: BotContext,
  services: AppServices,
  order: {
    id: string;
    quotedAmountXmr: string;
    usdReferenceCents: number | null;
    paymentAddress: string;
    quoteExpiresAt: Date;
    state: string;
  },
  title: string,
  qrFailurePrefix?: string
): Promise<void> {
  const caption = buildCheckoutCaption(order, title, services.env.retentionDays);
  const moneroUri = `monero:${order.paymentAddress}?tx_amount=${order.quotedAmountXmr}`;

  try {
    const qrBuffer = await QRCode.toBuffer(moneroUri, { margin: 1, width: 512 });
    await ctx.replyWithPhoto(
      { source: qrBuffer },
      {
        caption
      }
    );
  } catch {
    const fallback = qrFailurePrefix ? `${qrFailurePrefix}\n\n${caption}` : caption;
    await ctx.reply(fallback);
  }
}

export async function sendDeliveriesList(ctx: BotContext, services: AppServices): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const links = await services.store.retention.listByTelegramUserId(BigInt(ctx.from.id));
  const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
  const lines = ["Eligible Re-deliveries", ""];

  for (const link of links) {
    const order = await services.store.orders.findById(link.orderId);
    const snapshot = await services.store.snapshots.findByOrderId(link.orderId);
    if (!order || order.state !== "fulfilled" || !snapshot) {
      continue;
    }

    lines.push(`${snapshot.title} - ${order.id}`);
    rows.push([Markup.button.callback(snapshot.title, `delivery:redeliver:${order.id}`)]);
  }

  if (rows.length === 0) {
    await ctx.reply(
      "There are no active re-deliveries tied to this Telegram account. If the retention window ended, the bot no longer keeps the identity link needed to resend the purchase."
    );
    return;
  }

  await ctx.reply(lines.join("\n"), Markup.inlineKeyboard(rows));
}

export async function sendOpenCheckoutsList(ctx: BotContext, services: AppServices): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const links = await services.store.retention.listByTelegramUserId(BigInt(ctx.from.id));
  const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
  const lines = ["Open Checkouts", ""];

  for (const link of links) {
    const order = await services.store.orders.findById(link.orderId);
    const snapshot = await services.store.snapshots.findByOrderId(link.orderId);
    if (!order || !snapshot || order.state === "fulfilled" || order.state === "purged") {
      continue;
    }

    lines.push(`${snapshot.title} - ${order.state} - ${order.id}`);
    rows.push([Markup.button.callback(snapshot.title, `checkout:view:${order.id}`)]);
  }

  if (rows.length === 0) {
    await ctx.reply(
      "There are no open checkouts tied to this Telegram account. Completed orders move to My Deliveries while the temporary link is still active."
    );
    return;
  }

  rows.push([Markup.button.callback("Back to Catalog", "catalog:back")]);
  await ctx.reply(lines.join("\n"), Markup.inlineKeyboard(rows));
}

async function showCheckoutDetail(ctx: BotContext, services: AppServices, orderId: string): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const order = await services.orderService.getOrder(orderId);
  const link = await services.store.retention.findByOrderId(orderId);
  if (!link?.telegramUserId || link.telegramUserId !== BigInt(ctx.from.id)) {
    throw new NotFoundError("That checkout is not available.");
  }

  const snapshot = await services.store.snapshots.findByOrderId(orderId);
  const title = snapshot?.title ?? "SilentCart product";

  if (order.state === "awaiting_payment" || order.state === "payment_seen") {
    await sendCheckoutInstructions(ctx, services, order, title);
    return;
  }

  if (order.state === "confirmed") {
    await ctx.reply(
      [
        `Order ${order.id}`,
        "",
        title,
        "",
        "Payment is confirmed.",
        "Delivery is being finalized. If the bot is temporarily delayed, check My Deliveries again shortly."
      ].join("\n")
    );
    return;
  }

  if (order.state === "expired") {
    await ctx.reply(
      [
        `Order ${order.id}`,
        "",
        title,
        "",
        "This checkout expired before a qualifying payment was confirmed.",
        "If you already paid on time, contact the operator and provide the order ID."
      ].join("\n")
    );
    return;
  }

  if (order.state === "underpaid") {
    await ctx.reply(
      [
        `Order ${order.id}`,
        "",
        title,
        "",
        "This checkout was marked underpaid and was not fulfilled.",
        "A later standalone qualifying payment is only accepted before the quote expires."
      ].join("\n")
    );
    return;
  }

  await ctx.reply("That checkout is no longer available.");
}

export function registerCheckoutHandlers(bot: Telegraf<BotContext>, services: AppServices): void {
  bot.command("checkout", async (ctx) => sendOpenCheckoutsList(ctx, services));
  bot.command("deliveries", async (ctx) => sendDeliveriesList(ctx, services));

  bot.action(/^checkout:view:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    try {
      const orderId = getMatchValue(ctx.match);
      if (!orderId) {
        await ctx.reply("That checkout is not available.");
        return;
      }

      await showCheckoutDetail(ctx, services, orderId);
    } catch (error) {
      await ctx.reply(customerErrorMessage(error));
    }
  });

  bot.action("delivery:list", async (ctx) => {
    await ctx.answerCbQuery();
    await sendDeliveriesList(ctx, services);
  });

  bot.action(/^delivery:redeliver:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) {
      return;
    }

    try {
      const orderId = getMatchValue(ctx.match);
      if (!orderId) {
        await ctx.reply("That order is not available for re-delivery.");
        return;
      }

      await services.fulfillmentEngine.redeliver(orderId, BigInt(ctx.from.id));
      await ctx.reply("The original delivery has been sent again while the temporary Telegram link is still active.");
    } catch (error) {
      await ctx.reply(customerErrorMessage(error));
    }
  });
}
