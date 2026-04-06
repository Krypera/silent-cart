import { Markup, type Telegraf } from "telegraf";
import type { AppServices } from "../../app/services.js";
import { orderStates, type PricingMode, type ProductType } from "../../domain/models.js";
import {
  addCancelRow,
  adminMenuKeyboard,
  assertAdmin,
  cancelAdminAction,
  cancelKeyboard,
  getMatchValue
} from "../admin/common.js";
import {
  isAdminOrderFilter,
  parseNonNegativeInt,
  sendAdminHome,
  sendPagedOrderList,
  sendPagedProductList,
  sendSettingsView,
  sendStatsView,
  sendStockList,
  sendWalletView,
  showOrderDetail,
  showProductDetail
} from "../admin/views.js";
import {
  buildPayloadPrompt,
  finalizeProductCreation,
  handleAdminMessage,
  promptAddProductTitle,
  startTextEdit
} from "../admin/wizard.js";
import type { BotContext } from "../session.js";

function getCommandArg(ctx: BotContext): string {
  if (!ctx.message || !("text" in ctx.message)) {
    return "";
  }

  const text = ctx.message.text.trim();
  const firstSpace = text.indexOf(" ");
  if (firstSpace < 0) {
    return "";
  }

  return text.slice(firstSpace + 1).trim();
}

async function runOrderRecovery(ctx: BotContext, services: AppServices, orderId: string): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const order = await services.orderService.getOrder(orderId);
  const fulfillment = await services.store.fulfillments.findByOrderId(orderId);

  if (fulfillment?.status === "manual_review") {
    await services.fulfillmentEngine.resolveManualReview(orderId, BigInt(ctx.from.id), true);
    await ctx.reply("Manual review recovery completed.", Markup.inlineKeyboard([[Markup.button.callback("View Order", `admin:order:view:${orderId}`)]]));
    return;
  }

  if (order.state === "confirmed") {
    const record = await services.fulfillmentEngine.fulfillOrder(orderId);
    await ctx.reply(
      record?.status === "delivered"
        ? "Fulfillment retry completed successfully."
        : "Recovery ran but delivery is still not complete. Check order details for status.",
      Markup.inlineKeyboard([[Markup.button.callback("View Order", `admin:order:view:${orderId}`)]])
    );
    return;
  }

  if (order.state === "fulfilled") {
    await services.fulfillmentEngine.redeliver(orderId, BigInt(ctx.from.id), true);
    await ctx.reply(
      "Order is already fulfilled. Re-delivery has been sent.",
      Markup.inlineKeyboard([[Markup.button.callback("View Order", `admin:order:view:${orderId}`)]])
    );
    return;
  }

  await ctx.reply(
    `No automatic recovery action is available from state "${order.state}".`,
    Markup.inlineKeyboard([[Markup.button.callback("View Order", `admin:order:view:${orderId}`)]])
  );
}

async function findProductByTerm(ctx: BotContext, services: AppServices, rawTerm: string): Promise<void> {
  const term = rawTerm.trim().toLowerCase();
  if (!term) {
    await ctx.reply("Usage: /findproduct <title part or product id>");
    return;
  }

  const products = await services.catalogService.listAllProducts();
  const matches = products.filter((product) =>
    product.id === rawTerm.trim() || product.title.toLowerCase().includes(term)
  );

  if (matches.length === 0) {
    await ctx.reply("No products matched that query.");
    return;
  }

  const rows = matches.slice(0, 10).map((product) => [
    Markup.button.callback(`${product.active ? "Active" : "Paused"} - ${product.title}`, `admin:product:view:${product.id}`)
  ]);
  rows.push([Markup.button.callback("Back to Products", "admin:products")]);

  await ctx.reply(
    `Found ${matches.length} matching product(s).`,
    Markup.inlineKeyboard(rows)
  );
}

async function findOrderByTerm(ctx: BotContext, services: AppServices, rawTerm: string): Promise<void> {
  const term = rawTerm.trim();
  if (!term) {
    await ctx.reply("Usage: /findorder <order id, tx hash, or product title part>");
    return;
  }

  const exactOrder = await services.store.orders.findById(term);
  if (exactOrder) {
    await showOrderDetail(ctx, services, exactOrder.id);
    return;
  }

  const txMatches = await services.store.payments.findByTxHash(term);
  if (txMatches.length > 0) {
    const rows = txMatches.slice(0, 10).map((payment) => [
      Markup.button.callback(`Order ${payment.orderId.slice(0, 8)} - tx match`, `admin:order:view:${payment.orderId}`)
    ]);
    rows.push([Markup.button.callback("Back to Orders", "admin:orders")]);
    await ctx.reply(`Found ${txMatches.length} order(s) with that tx hash.`, Markup.inlineKeyboard(rows));
    return;
  }

  const allOrders = await services.store.orders.listByStates([...orderStates], 500);
  const lowered = term.toLowerCase();
  const candidates: Array<{ id: string; state: string; title: string; amount: string }> = [];

  for (const order of allOrders) {
    const snapshot = await services.store.snapshots.findByOrderId(order.id);
    const title = snapshot?.title ?? "Unknown product";
    if (
      order.id.toLowerCase().includes(lowered) ||
      title.toLowerCase().includes(lowered) ||
      (order.paymentTxHash?.toLowerCase().includes(lowered) ?? false)
    ) {
      candidates.push({
        id: order.id,
        state: order.state,
        title,
        amount: order.quotedAmountXmr
      });
    }
  }

  if (candidates.length === 0) {
    await ctx.reply("No orders matched that query.");
    return;
  }

  const rows = candidates.slice(0, 10).map((order) => [
    Markup.button.callback(`${order.state} - ${order.title} - ${order.amount} XMR`, `admin:order:view:${order.id}`)
  ]);
  rows.push([Markup.button.callback("Back to Orders", "admin:orders")]);

  await ctx.reply(`Found ${candidates.length} matching order(s).`, Markup.inlineKeyboard(rows));
}

export function registerAdminHandlers(bot: Telegraf<BotContext>, services: AppServices): void {
  bot.command("admin", async (ctx) => {
    if (await assertAdmin(ctx, services)) {
      await sendAdminHome(ctx, services);
    }
  });

  bot.command("cancel", async (ctx) => {
    if (await assertAdmin(ctx, services)) {
      await cancelAdminAction(ctx);
    }
  });

  bot.command("products", async (ctx) => {
    if (await assertAdmin(ctx, services)) {
      await sendPagedProductList(ctx, services, 0);
    }
  });

  bot.command("addproduct", async (ctx) => {
    if (await assertAdmin(ctx, services)) {
      await promptAddProductTitle(ctx);
    }
  });

  bot.command("orders", async (ctx) => {
    if (await assertAdmin(ctx, services)) {
      await sendPagedOrderList(ctx, services, "all", 0);
    }
  });

  bot.command("findproduct", async (ctx) => {
    if (!(await assertAdmin(ctx, services))) {
      return;
    }
    await findProductByTerm(ctx, services, getCommandArg(ctx));
  });

  bot.command("findorder", async (ctx) => {
    if (!(await assertAdmin(ctx, services))) {
      return;
    }
    await findOrderByTerm(ctx, services, getCommandArg(ctx));
  });

  bot.command("recover", async (ctx) => {
    if (!(await assertAdmin(ctx, services))) {
      return;
    }

    const orderId = getCommandArg(ctx);
    if (!orderId) {
      await ctx.reply("Usage: /recover <order-id>");
      return;
    }

    await runOrderRecovery(ctx, services, orderId);
  });

  bot.command("stock", async (ctx) => {
    if (await assertAdmin(ctx, services)) {
      await sendStockList(ctx, services);
    }
  });

  bot.command("wallet", async (ctx) => {
    if (await assertAdmin(ctx, services)) {
      await sendWalletView(ctx, services);
    }
  });

  bot.command("stats", async (ctx) => {
    if (await assertAdmin(ctx, services)) {
      await sendStatsView(ctx, services);
    }
  });

  bot.command("settings", async (ctx) => {
    if (await assertAdmin(ctx, services)) {
      await sendSettingsView(ctx, services);
    }
  });

  bot.action("admin:menu", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await sendAdminHome(ctx, services);
    }
  });

  bot.action("admin:cancel", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await cancelAdminAction(ctx);
    }
  });

  bot.action("admin:product:add", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await promptAddProductTitle(ctx);
    }
  });

  bot.action("admin:products", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await sendPagedProductList(ctx, services, 0);
    }
  });

  bot.action("admin:orders", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await sendPagedOrderList(ctx, services, "all", 0);
    }
  });

  bot.action(/^admin:products:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await assertAdmin(ctx, services))) {
      return;
    }

    const page = parseNonNegativeInt(getMatchValue(ctx.match));
    await sendPagedProductList(ctx, services, page);
  });

  bot.action(
    /^admin:orders:(all|manual_review|created|awaiting_payment|payment_seen|confirmed|fulfilled|underpaid|expired|purged):(\d+)$/,
    async (ctx) => {
      await ctx.answerCbQuery();
      if (!(await assertAdmin(ctx, services))) {
        return;
      }

      const filterValue = getMatchValue(ctx.match);
      const page = parseNonNegativeInt(getMatchValue(ctx.match, 2));
      if (!isAdminOrderFilter(filterValue)) {
        await ctx.reply("That order filter is invalid.", adminMenuKeyboard());
        return;
      }

      await sendPagedOrderList(ctx, services, filterValue, page);
    }
  );

  bot.action("admin:stock", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await sendStockList(ctx, services);
    }
  });

  bot.action("admin:wallet", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await sendWalletView(ctx, services);
    }
  });

  bot.action("admin:stats", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await sendStatsView(ctx, services);
    }
  });

  bot.action("admin:settings", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await sendSettingsView(ctx, services);
    }
  });

  bot.action(/^admin:product:view:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await assertAdmin(ctx, services))) {
      return;
    }

    const productId = getMatchValue(ctx.match);
    if (!productId) {
      await ctx.reply("That product reference is invalid.", adminMenuKeyboard());
      return;
    }

    await showProductDetail(ctx, services, productId);
  });

  bot.action(/^admin:product:toggle:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await assertAdmin(ctx, services))) {
      return;
    }

    const productId = getMatchValue(ctx.match);
    if (!productId) {
      await ctx.reply("That product reference is invalid.", adminMenuKeyboard());
      return;
    }

    const product = await services.catalogService.getProductById(productId);
    await services.catalogService.setActive(product.id, !product.active);
    await showProductDetail(ctx, services, product.id);
  });

  bot.action(/^admin:product:edit:title:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = getMatchValue(ctx.match);
    if ((await assertAdmin(ctx, services)) && productId) {
      await startTextEdit(ctx, { kind: "edit_title", productId }, "Send the new product title.");
    }
  });

  bot.action(/^admin:product:edit:description:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = getMatchValue(ctx.match);
    if ((await assertAdmin(ctx, services)) && productId) {
      await startTextEdit(
        ctx,
        { kind: "edit_description", productId },
        "Send the new short description."
      );
    }
  });

  bot.action(/^admin:product:edit:price:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await assertAdmin(ctx, services))) {
      return;
    }

    const productId = getMatchValue(ctx.match);
    if (!productId) {
      await ctx.reply("That product reference is invalid.", adminMenuKeyboard());
      return;
    }

    const product = await services.catalogService.getProductById(productId);
    await startTextEdit(
      ctx,
      { kind: "edit_price", productId },
      product.pricingMode === "fixed_xmr"
        ? "Send the new fixed XMR price."
        : "Send the new USD price in dollars, for example 12.50."
    );
  });

  bot.action(/^admin:product:edit:payload:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await assertAdmin(ctx, services))) {
      return;
    }

    const productId = getMatchValue(ctx.match);
    if (!productId) {
      await ctx.reply("That product reference is invalid.", adminMenuKeyboard());
      return;
    }

    const product = await services.catalogService.getProductById(productId);
    await startTextEdit(
      ctx,
      { kind: "edit_payload", productId },
      product.type === "file"
        ? "Send the replacement file as a Telegram document."
        : product.type === "download_link"
          ? "Send the replacement URL. You can add an optional note on the next line."
          : product.type === "license_key"
            ? "Send the replacement license delivery note, or send /skip for no note."
            : "Send the replacement text or code payload."
    );
  });

  bot.action(/^admin:order:view:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await assertAdmin(ctx, services))) {
      return;
    }

    const orderId = getMatchValue(ctx.match);
    if (!orderId) {
      await ctx.reply("That order reference is invalid.", adminMenuKeyboard());
      return;
    }

    await showOrderDetail(ctx, services, orderId);
  });

  bot.action(/^admin:order:recover:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await assertAdmin(ctx, services))) {
      return;
    }

    const orderId = getMatchValue(ctx.match);
    if (!orderId) {
      await ctx.reply("That order reference is invalid.", adminMenuKeyboard());
      return;
    }

    await runOrderRecovery(ctx, services, orderId);
  });

  bot.action(/^admin:order:redeliver:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await assertAdmin(ctx, services)) || !ctx.from) {
      return;
    }

    const orderId = getMatchValue(ctx.match);
    if (!orderId) {
      await ctx.reply("That order reference is invalid.", adminMenuKeyboard());
      return;
    }

    await services.fulfillmentEngine.redeliver(orderId, BigInt(ctx.from.id), true);
    await ctx.reply(
      "The original payload has been sent again while the temporary delivery link is still active.",
      Markup.inlineKeyboard([[Markup.button.callback("Back to Orders", "admin:orders")]])
    );
  });

  bot.action(/^admin:order:resolve:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await assertAdmin(ctx, services)) || !ctx.from) {
      return;
    }

    const orderId = getMatchValue(ctx.match);
    if (!orderId) {
      await ctx.reply("That order reference is invalid.", adminMenuKeyboard());
      return;
    }

    await services.fulfillmentEngine.resolveManualReview(orderId, BigInt(ctx.from.id), true);
    await ctx.reply(
      "The manual review order was re-processed. Check the order detail again to confirm delivery status.",
      Markup.inlineKeyboard([[Markup.button.callback("Back to Orders", "admin:orders")]])
    );
  });

  bot.action(/^admin:stock:add:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = getMatchValue(ctx.match);
    if ((await assertAdmin(ctx, services)) && productId) {
      await startTextEdit(ctx, { kind: "add_stock", productId }, "Paste one license key per line.");
    }
  });

  bot.action("admin:settings:editwhy", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await startTextEdit(
        ctx,
        { kind: "edit_why_monero" },
        "Send the short custom 'Why I accept Monero' message."
      );
    }
  });

  bot.action(/^admin:addproduct:type:(file|text|download_link|license_key)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await assertAdmin(ctx, services))) {
      return;
    }

    const action = ctx.session.adminAction;
    const nextType = getMatchValue(ctx.match) as ProductType | null;
    if (!action || !("draft" in action) || !nextType) {
      await ctx.reply("The product draft is missing. Start again with /addproduct.", adminMenuKeyboard());
      return;
    }

    ctx.session.adminAction = {
      kind: "add_product_price",
      draft: {
        ...action.draft,
        type: nextType
      }
    };

    await ctx.reply(
      "Step 3 of 5\nChoose the pricing mode.",
      addCancelRow([
        [Markup.button.callback("Fixed XMR", "admin:addproduct:pricing:fixed_xmr")],
        [Markup.button.callback("USD Anchored", "admin:addproduct:pricing:usd_anchored")]
      ])
    );
  });

  bot.action(/^admin:addproduct:pricing:(fixed_xmr|usd_anchored)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await assertAdmin(ctx, services))) {
      return;
    }

    const action = ctx.session.adminAction;
    const pricingMode = getMatchValue(ctx.match) as PricingMode | null;
    if (!action || action.kind !== "add_product_price" || !pricingMode) {
      await ctx.reply("The product draft is missing. Start again with /addproduct.", adminMenuKeyboard());
      return;
    }

    ctx.session.adminAction = {
      kind: "add_product_price",
      draft: {
        ...action.draft,
        pricingMode
      }
    };

    await ctx.reply(
      pricingMode === "fixed_xmr"
        ? "Step 4 of 5\nSend the fixed XMR price."
        : "Step 4 of 5\nSend the USD price in dollars, for example 12.50.",
      cancelKeyboard()
    );
  });

  bot.action("admin:addproduct:confirm", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await finalizeProductCreation(ctx, services);
    }
  });

  bot.action("admin:addproduct:restart", async (ctx) => {
    await ctx.answerCbQuery();
    if (await assertAdmin(ctx, services)) {
      await promptAddProductTitle(ctx);
    }
  });

  bot.on("message", async (ctx) => {
    if (!ctx.session.adminAction) {
      return;
    }

    if (!(await assertAdmin(ctx, services))) {
      return;
    }

    await handleAdminMessage(ctx, services);
  });
}
