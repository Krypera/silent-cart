import { Markup, type Telegraf } from "telegraf";
import type { AppServices } from "../../app/services.js";
import type { Product } from "../../domain/models.js";
import type { BotContext } from "../session.js";
import { buildCatalogEntry, customerErrorMessage, getMatchValue, productTypeLabel } from "./common.js";
import { sendOpenCheckoutsList, sendCheckoutInstructions } from "./checkoutHandlers.js";

const PROJECT_GITHUB_URL = "https://github.com/Krypera/silent-cart";

async function buildCatalogMessage(services: AppServices): Promise<{
  text: string;
  keyboard: ReturnType<typeof Markup.inlineKeyboard>;
}> {
  const products = await services.catalogService.listActiveProducts();

  if (products.length === 0) {
    return {
      text:
        "SilentCart is online, but there are no active products right now.\n\nUse /guide to read the Monero guide.",
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback("Monero Guide", "guide:open")],
        [Markup.button.callback("Open Checkouts", "checkout:list")],
        [Markup.button.callback("My Deliveries", "delivery:list")],
        [Markup.button.url("GitHub", PROJECT_GITHUB_URL)]
      ])
    };
  }

  const productViews = await Promise.all(products.map((product) => buildCatalogEntry(services, product)));

  const lines = [
    "SilentCart",
    "",
    "Digital products. Monero only.",
    "Prices settle in Monero. USD is shown only as a reference.",
    ""
  ];

  for (const view of productViews) {
    lines.push(
      view.title,
      view.pricingAvailable && view.xmrAmount
        ? `${view.xmrAmount} XMR${view.usdReference ? `  -  ~${view.usdReference}` : ""}`
        : "Pricing temporarily unavailable",
      productTypeLabel(view.type),
      ""
    );
  }

  const rows: Array<Array<ReturnType<typeof Markup.button.callback> | ReturnType<typeof Markup.button.url>>> =
    productViews
    .filter((product) => product.pricingAvailable)
    .map((product) => [Markup.button.callback(product.title, `catalog:view:${product.id}`)]);
  rows.push([Markup.button.callback("Open Checkouts", "checkout:list")]);
  rows.push([Markup.button.callback("My Deliveries", "delivery:list")]);
  rows.push([Markup.button.callback("Monero Guide", "guide:open")]);
  rows.push([Markup.button.url("GitHub", PROJECT_GITHUB_URL)]);

  return {
    text: lines.join("\n").trim(),
    keyboard: Markup.inlineKeyboard(rows)
  };
}

export async function showCatalog(ctx: BotContext, services: AppServices): Promise<void> {
  try {
    const message = await buildCatalogMessage(services);
    await ctx.reply(message.text, message.keyboard);
  } catch (error) {
    await ctx.reply(customerErrorMessage(error));
  }
}

async function showProductDetail(
  ctx: BotContext,
  services: AppServices,
  product: Product
): Promise<void> {
  const view = await buildCatalogEntry(services, product);
  const lines = [
    view.title,
    "",
    product.shortDescription,
    "",
    `Delivery type: ${productTypeLabel(product.type)}`
  ];

  if (view.pricingAvailable && view.xmrAmount) {
    lines.push(`Price: ${view.xmrAmount} XMR`);
    if (view.usdReference) {
      lines.push(`USD reference: ~${view.usdReference}`);
    }
  } else {
    lines.push("Pricing is temporarily unavailable for this product. Please try again later.");
  }

  lines.push(
    "",
    "Prices settle in Monero. USD is shown only as a reference.",
    `The Telegram identity link needed for delivery and re-delivery is temporary and later severed after ${services.env.retentionDays} days.`
  );

  const rows =
    view.pricingAvailable && view.xmrAmount
      ? [
          [Markup.button.callback("Buy with Monero", `catalog:buy:${product.id}`)],
          [Markup.button.url("GitHub", PROJECT_GITHUB_URL)],
          [Markup.button.callback("Back to Catalog", "catalog:back")]
        ]
      : [
          [Markup.button.url("GitHub", PROJECT_GITHUB_URL)],
          [Markup.button.callback("Back to Catalog", "catalog:back")]
        ];

  await ctx.reply(lines.join("\n"), Markup.inlineKeyboard(rows));
}

export function registerCatalogHandlers(bot: Telegraf<BotContext>, services: AppServices): void {
  bot.start(async (ctx) => showCatalog(ctx, services));
  bot.command("catalog", async (ctx) => showCatalog(ctx, services));

  bot.action(/^catalog:view:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const productId = getMatchValue(ctx.match);
      if (!productId) {
        await ctx.reply("That product is not available.");
        return;
      }

      const product = await services.catalogService.getProductById(productId);
      if (!product.active) {
        await ctx.reply("That product is not currently active.");
        return;
      }

      await showProductDetail(ctx, services, product);
    } catch (error) {
      await ctx.reply(customerErrorMessage(error));
    }
  });

  bot.action("catalog:back", async (ctx) => {
    await ctx.answerCbQuery();
    await showCatalog(ctx, services);
  });

  bot.action(/^catalog:buy:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.from) {
      return;
    }

    try {
      const productId = getMatchValue(ctx.match);
      if (!productId) {
        await ctx.reply("That product is not available.");
        return;
      }

      const order = await services.orderService.createOrder(productId, BigInt(ctx.from.id));
      const snapshot = await services.store.snapshots.findByOrderId(order.id);
      await sendCheckoutInstructions(
        ctx,
        services,
        order,
        snapshot?.title ?? "SilentCart product",
        [
          "The order was created, but the QR preview could not be generated.",
          "Use /checkout to reopen the payment instructions later if needed."
        ].join("\n")
      );
    } catch (error) {
      await ctx.reply(customerErrorMessage(error));
    }
  });

  bot.action("checkout:list", async (ctx) => {
    await ctx.answerCbQuery();
    await sendOpenCheckoutsList(ctx, services);
  });
}
