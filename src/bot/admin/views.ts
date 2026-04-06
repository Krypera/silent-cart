import { Markup } from "telegraf";
import type { AppServices } from "../../app/services.js";
import type { OrderState } from "../../domain/models.js";
import { atomicToXmr, formatUsdCents } from "../../utils/money.js";
import type { BotContext } from "../session.js";
import {
  addCancelRow,
  adminMenuKeyboard,
  formatPricingMode,
  formatProductType
} from "./common.js";
import {
  ADMIN_ORDERS_PAGE_SIZE,
  ADMIN_PRODUCTS_PAGE_SIZE,
  type AdminOrderFilter,
  type ButtonRow
} from "./types.js";

export async function sendAdminHome(ctx: BotContext, services: AppServices): Promise<void> {
  const stats = await services.statsService.getBasicStats();
  const pendingAction = ctx.session.adminAction ? `Active draft: ${ctx.session.adminAction.kind}` : "No active draft.";

  await ctx.reply(
    [
      "SilentCart Admin",
      "",
      "Use the buttons below to manage catalog, orders, wallet health, stock, and settings.",
      "Use /cancel at any time to stop a guided admin action.",
      "",
      `Active products: ${stats.activeProducts}`,
      `Awaiting payment: ${stats.awaitingPayment}`,
      `Underpaid: ${stats.underpaid}`,
      `Fulfilled: ${stats.fulfilled}`,
      pendingAction
    ].join("\n"),
    adminMenuKeyboard()
  );
}

async function sendEmptyProductList(ctx: BotContext): Promise<void> {
  await ctx.reply(
    [
      "Products",
      "",
      "There are no products yet.",
      "Press Add Product to start the guided wizard."
    ].join("\n"),
    addCancelRow([
      [Markup.button.callback("Add Product", "admin:product:add")],
      [Markup.button.callback("Back to Admin", "admin:menu")]
    ])
  );
}

function clampPage(page: number, totalItems: number, pageSize: number): number {
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  return Math.min(Math.max(0, page), pageCount - 1);
}

export function parseNonNegativeInt(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function formatOrderFilter(filter: AdminOrderFilter): string {
  switch (filter) {
    case "all":
      return "All recent orders";
    case "manual_review":
      return "Needs review";
    case "awaiting_payment":
      return "Awaiting payment";
    case "payment_seen":
      return "Payment seen";
    case "confirmed":
      return "Confirmed";
    case "fulfilled":
      return "Fulfilled";
    case "underpaid":
      return "Underpaid";
    case "expired":
      return "Expired";
    case "purged":
      return "Purged";
    case "created":
      return "Created";
  }
}

export async function sendPagedProductList(
  ctx: BotContext,
  services: AppServices,
  requestedPage = 0
): Promise<void> {
  const products = await services.catalogService.listAllProducts();
  if (products.length === 0) {
    await sendEmptyProductList(ctx);
    return;
  }

  const page = clampPage(requestedPage, products.length, ADMIN_PRODUCTS_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(products.length / ADMIN_PRODUCTS_PAGE_SIZE));
  const start = page * ADMIN_PRODUCTS_PAGE_SIZE;
  const pageItems = products.slice(start, start + ADMIN_PRODUCTS_PAGE_SIZE);

  const rows: ButtonRow[] = pageItems.map((product) => [
    Markup.button.callback(
      `${product.active ? "Active" : "Paused"} - ${product.title}`,
      `admin:product:view:${product.id}`
    )
  ]);

  const navRow: ButtonRow = [];
  if (page > 0) {
    navRow.push(Markup.button.callback("Previous", `admin:products:${page - 1}`));
  }
  if (page < pageCount - 1) {
    navRow.push(Markup.button.callback("Next", `admin:products:${page + 1}`));
  }
  if (navRow.length > 0) {
    rows.push(navRow);
  }
  rows.push([Markup.button.callback("Add Product", "admin:product:add")]);
  rows.push([Markup.button.callback("Back to Admin", "admin:menu")]);

  await ctx.reply(
    [
      "Products",
      "",
      `${products.length} products in catalog.`,
      `Page ${page + 1} of ${pageCount}.`,
      "Choose one to inspect or edit."
    ].join("\n"),
    Markup.inlineKeyboard(rows)
  );
}

async function loadOrdersForFilter(
  services: AppServices,
  filter: AdminOrderFilter,
  page: number
): Promise<{ orders: Awaited<ReturnType<typeof services.store.orders.listRecent>>; totalItems: number }> {
  const offset = page * ADMIN_ORDERS_PAGE_SIZE;

  if (filter === "manual_review") {
    const records = await services.store.fulfillments.listByStatus("manual_review");
    const orderedRecords = [...records].sort((left, right) => {
      const leftTime = left.lastAttemptAt?.getTime() ?? 0;
      const rightTime = right.lastAttemptAt?.getTime() ?? 0;
      return rightTime - leftTime;
    });
    const pageRecords = orderedRecords.slice(offset, offset + ADMIN_ORDERS_PAGE_SIZE);
    const orders = (
      await Promise.all(pageRecords.map((record) => services.store.orders.findById(record.orderId)))
    ).filter((order): order is NonNullable<typeof order> => Boolean(order));
    return {
      orders,
      totalItems: orderedRecords.length
    };
  }

  const states = filter === "all" ? undefined : [filter];
  const [orders, totalItems] = await Promise.all([
    services.store.orders.listRecent(ADMIN_ORDERS_PAGE_SIZE, offset, states),
    services.store.orders.countMatching(states)
  ]);

  return {
    orders,
    totalItems
  };
}

function buildOrderFilterRows(filter: AdminOrderFilter): ButtonRow[] {
  const groups: AdminOrderFilter[][] = [
    ["all", "manual_review", "created", "awaiting_payment"],
    ["payment_seen", "confirmed", "fulfilled"],
    ["underpaid", "expired", "purged"]
  ];

  return groups.map((group) =>
    group.map((item) =>
      Markup.button.callback(
        item === filter ? `[${formatOrderFilter(item)}]` : formatOrderFilter(item),
        `admin:orders:${item}:0`
      )
    )
  );
}

export async function sendPagedOrderList(
  ctx: BotContext,
  services: AppServices,
  filter: AdminOrderFilter = "all",
  requestedPage = 0
): Promise<void> {
  const initial = await loadOrdersForFilter(services, filter, 0);
  if (initial.totalItems === 0) {
    const rows = buildOrderFilterRows(filter);
    rows.push([Markup.button.callback("Back to Admin", "admin:menu")]);
    await ctx.reply(
      [
        "Orders",
        "",
        `Filter: ${formatOrderFilter(filter)}`,
        "There are no matching orders right now."
      ].join("\n"),
      Markup.inlineKeyboard(rows)
    );
    return;
  }

  const page = clampPage(requestedPage, initial.totalItems, ADMIN_ORDERS_PAGE_SIZE);
  const { orders, totalItems } = await loadOrdersForFilter(services, filter, page);
  const pageCount = Math.max(1, Math.ceil(totalItems / ADMIN_ORDERS_PAGE_SIZE));
  const rows: ButtonRow[] = buildOrderFilterRows(filter);

  for (const order of orders) {
    rows.push([
      Markup.button.callback(
        `${order.state} - ${order.id.slice(0, 8)} - ${order.quotedAmountXmr} XMR`,
        `admin:order:view:${order.id}`
      )
    ]);
  }

  const navRow: ButtonRow = [];
  if (page > 0) {
    navRow.push(Markup.button.callback("Previous", `admin:orders:${filter}:${page - 1}`));
  }
  if (page < pageCount - 1) {
    navRow.push(Markup.button.callback("Next", `admin:orders:${filter}:${page + 1}`));
  }
  if (navRow.length > 0) {
    rows.push(navRow);
  }
  rows.push([Markup.button.callback("Back to Admin", "admin:menu")]);

  await ctx.reply(
    [
      "Orders",
      "",
      `Filter: ${formatOrderFilter(filter)}`,
      `${totalItems} matching orders.`,
      `Page ${page + 1} of ${pageCount}.`,
      "Choose an order to inspect or trigger a recovery action when it is eligible."
    ].join("\n"),
    Markup.inlineKeyboard(rows)
  );
}

export async function sendStockList(ctx: BotContext, services: AppServices): Promise<void> {
  const products = await services.catalogService.listLicenseProducts();
  if (products.length === 0) {
    await ctx.reply(
      [
        "License Stock",
        "",
        "There are no license-key products yet."
      ].join("\n"),
      adminMenuKeyboard()
    );
    return;
  }

  const rows: ButtonRow[] = [];
  const lines = ["License Stock", ""];

  for (const product of products) {
    const summary = await services.catalogService.getLicenseStockSummary(product.id);
    lines.push(
      `${product.title}`,
      `Available: ${summary.available} - Reserved: ${summary.reserved} - Consumed: ${summary.consumed}`,
      ""
    );
    rows.push([Markup.button.callback(`Add keys to ${product.title}`, `admin:stock:add:${product.id}`)]);
  }

  rows.push([Markup.button.callback("Back to Admin", "admin:menu")]);

  await ctx.reply(lines.join("\n").trim(), Markup.inlineKeyboard(rows));
}

export async function sendWalletView(ctx: BotContext, services: AppServices): Promise<void> {
  const health = await services.walletHealthService.getHealth();
  const lines = [
    "Wallet Health",
    "",
    `wallet-rpc reachable: ${health.walletRpcReachable ? "yes" : "no"}`,
    `Wallet height: ${health.walletHeight ?? "unknown"}`,
    `Daemon height: ${health.daemonHeight ?? "unknown"}`,
    `Daemon target height: ${health.daemonTargetHeight ?? "unknown"}`,
    `Daemon synchronized: ${
      health.daemonSynchronized === null ? "unknown" : health.daemonSynchronized ? "yes" : "no"
    }`,
    `Last successful scan: ${health.lastSuccessfulScanAt ?? "never"}`,
    `Pending orders: ${health.pendingOrderCount}`,
    `Underpaid orders: ${health.underpaidOrderCount}`,
    "",
    "Recent detection activity"
  ];

  if (health.recentDetectionActivity.length === 0) {
    lines.push("No recent payment events.");
  } else {
    for (const event of health.recentDetectionActivity) {
      lines.push(`${event.txHash} - ${event.orderId} - confirmations=${event.confirmations}`);
    }
  }

  await ctx.reply(
    lines.join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback("Refresh Wallet View", "admin:wallet")],
      [Markup.button.callback("Back to Admin", "admin:menu")]
    ])
  );
}

export async function sendStatsView(ctx: BotContext, services: AppServices): Promise<void> {
  const stats = await services.statsService.getBasicStats();
  await ctx.reply(
    [
      "Basic Sales Stats",
      "",
      `Active products: ${stats.activeProducts}`,
      `Total products: ${stats.totalProducts}`,
      `Awaiting payment: ${stats.awaitingPayment}`,
      `Underpaid: ${stats.underpaid}`,
      `Fulfilled: ${stats.fulfilled}`,
      `Total settled: ${stats.totalSettledXmr} XMR`
    ].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback("Refresh Stats", "admin:stats")],
      [Markup.button.callback("Back to Admin", "admin:menu")]
    ])
  );
}

export async function sendSettingsView(ctx: BotContext, services: AppServices): Promise<void> {
  const sections = await services.guideService.getSections();
  const why = sections.find((section) => section.key === "why_seller")?.body ?? "Not configured.";

  await ctx.reply(
    [
      "Settings",
      "",
      `Retention window: ${services.env.retentionDays} days after fulfillment`,
      "",
      "Why I accept Monero",
      why
    ].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback("Edit Why I Accept Monero", "admin:settings:editwhy")],
      [Markup.button.callback("Back to Admin", "admin:menu")]
    ])
  );
}

export async function showProductDetail(
  ctx: BotContext,
  services: AppServices,
  productId: string
): Promise<void> {
  const product = await services.catalogService.getProductById(productId);
  const summary =
    product.type === "license_key"
      ? await services.catalogService.getLicenseStockSummary(product.id)
      : null;

  const lines = [
    product.title,
    "",
    product.shortDescription,
    "",
    `Delivery type: ${formatProductType(product.type)}`,
    `Pricing mode: ${formatPricingMode(product.pricingMode)}`
  ];

  if (product.fixedPriceAtomic !== null) {
    lines.push(`Fixed XMR: ${atomicToXmr(product.fixedPriceAtomic)} XMR`);
  }

  if (product.usdPriceCents !== null) {
    lines.push(`USD anchor: ${formatUsdCents(product.usdPriceCents)}`);
  }

  lines.push(`Status: ${product.active ? "Active" : "Paused"}`);

  if (summary) {
    lines.push(
      "",
      `License stock - available ${summary.available}, reserved ${summary.reserved}, consumed ${summary.consumed}`
    );
  }

  const rows: ButtonRow[] = [
    [Markup.button.callback(product.active ? "Deactivate Product" : "Activate Product", `admin:product:toggle:${product.id}`)],
    [Markup.button.callback("Edit Title", `admin:product:edit:title:${product.id}`)],
    [Markup.button.callback("Edit Description", `admin:product:edit:description:${product.id}`)],
    [Markup.button.callback("Edit Price", `admin:product:edit:price:${product.id}`)],
    [Markup.button.callback("Edit Payload", `admin:product:edit:payload:${product.id}`)]
  ];

  if (product.type === "license_key") {
    rows.push([Markup.button.callback("Add License Keys", `admin:stock:add:${product.id}`)]);
  }

  rows.push([Markup.button.callback("Back to Products", "admin:products")]);

  await ctx.reply(lines.join("\n"), Markup.inlineKeyboard(rows));
}

export async function showOrderDetail(
  ctx: BotContext,
  services: AppServices,
  orderId: string
): Promise<void> {
  const order = await services.orderService.getOrder(orderId);
  const snapshot = await services.store.snapshots.findByOrderId(orderId);
  const link = await services.store.retention.findByOrderId(orderId);
  const fulfillment = await services.store.fulfillments.findByOrderId(orderId);

  const lines = [
    `Order ${order.id}`,
    "",
    `Product: ${snapshot?.title ?? "Unknown"}`,
    `State: ${order.state}`,
    `Quoted amount: ${order.quotedAmountXmr} XMR`,
    `USD reference: ${formatUsdCents(order.usdReferenceCents) ?? "not shown"}`,
    `Payment address: ${order.paymentAddress}`,
    `Quote expiry: ${order.quoteExpiresAt.toISOString()}`,
    `Payment tx: ${order.paymentTxHash ?? "not seen"}`,
    `Retention link active: ${link?.telegramUserId ? "yes" : "no"}`,
    `Fulfillment status: ${fulfillment?.status ?? "not started"}`
  ];

  if (fulfillment?.lastErrorCode) {
    lines.push(`Fulfillment note: ${fulfillment.lastErrorCode}`);
  }

  const rows: ButtonRow[] = [];
  if (order.state === "fulfilled" && link?.telegramUserId) {
    rows.push([Markup.button.callback("Manual Re-delivery", `admin:order:redeliver:${order.id}`)]);
  }
  if (fulfillment?.status === "manual_review" && link?.telegramUserId) {
    rows.push([Markup.button.callback("Resolve Manual Review", `admin:order:resolve:${order.id}`)]);
  }
  rows.push([Markup.button.callback("Back to Orders", "admin:orders")]);

  await ctx.reply(lines.join("\n"), Markup.inlineKeyboard(rows));
}

export function isAdminOrderFilter(value: string | null): value is AdminOrderFilter {
  if (!value) {
    return false;
  }

  const filters: AdminOrderFilter[] = [
    "all",
    "manual_review",
    "created",
    "awaiting_payment",
    "payment_seen",
    "confirmed",
    "fulfilled",
    "underpaid",
    "expired",
    "purged"
  ];

  return filters.includes(value as AdminOrderFilter);
}

export type { AdminOrderFilter, OrderState };
