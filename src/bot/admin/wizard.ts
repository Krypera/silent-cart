import { Markup } from "telegraf";
import type { AppServices } from "../../app/services.js";
import type { ProductPayload, ProductType } from "../../domain/models.js";
import { formatUsdCents, xmrToAtomic } from "../../utils/money.js";
import { sanitizePlainText, validateUrl } from "../../utils/validation.js";
import type { AdminDraftProduct, BotContext, PendingAdminAction } from "../session.js";
import {
  addCancelRow,
  adminMenuKeyboard,
  cancelKeyboard,
  clearAdminAction,
  formatPricingMode,
  formatProductType,
  getMessageText,
  hasDocumentMessage,
  parseUsdInput
} from "./common.js";
import { sendSettingsView, showProductDetail } from "./views.js";
import type { CompleteDraftProduct, ButtonRow } from "./types.js";

export function isDraftComplete(draft: AdminDraftProduct): draft is CompleteDraftProduct {
  return Boolean(
    draft.title &&
      draft.shortDescription &&
      draft.type &&
      draft.pricingMode &&
      draft.payload &&
      (
        (draft.pricingMode === "fixed_xmr" && draft.fixedXmrAmount) ||
        (draft.pricingMode === "usd_anchored" && draft.usdPriceCents !== undefined)
      )
  );
}

function renderDraftSummary(draft: CompleteDraftProduct): string {
  const lines = [
    "Review Product",
    "",
    `Title: ${draft.title}`,
    `Short description: ${draft.shortDescription}`,
    `Delivery type: ${formatProductType(draft.type)}`,
    `Pricing mode: ${formatPricingMode(draft.pricingMode)}`
  ];

  if (draft.pricingMode === "fixed_xmr") {
    lines.push(`Price: ${draft.fixedXmrAmount} XMR`);
  } else {
    lines.push(`Price: ${formatUsdCents(draft.usdPriceCents)}`);
  }

  if (draft.payload.kind === "file") {
    lines.push(`Payload: Telegram file ${draft.payload.fileName ?? draft.payload.telegramFileId}`);
  } else if (draft.payload.kind === "text") {
    lines.push(`Payload: Text/code (${draft.payload.content.length} characters)`);
  } else if (draft.payload.kind === "download_link") {
    lines.push(`Payload: Link ${draft.payload.url}`);
  } else {
    lines.push(`Payload: License delivery note${draft.payload.note ? " included" : " not set"}`);
  }

  lines.push("", "Press Confirm Product to create it, or Start Over to rewrite the draft.");
  return lines.join("\n");
}

export async function promptAddProductTitle(ctx: BotContext): Promise<void> {
  ctx.session.adminAction = {
    kind: "add_product_title",
    draft: {}
  };
  await ctx.reply(
    [
      "New Product Wizard",
      "",
      "Step 1 of 5",
      "Send the product title."
    ].join("\n"),
    cancelKeyboard()
  );
}

export function buildPayloadPrompt(type: ProductType): string {
  switch (type) {
    case "file":
      return "Step 5 of 5\nSend the delivery file as a Telegram document.";
    case "text":
      return "Step 5 of 5\nSend the text or code payload.";
    case "download_link":
      return "Step 5 of 5\nSend the download URL. You can add an optional note on the next line.";
    case "license_key":
      return "Step 5 of 5\nSend the license delivery note, or send /skip for no note.";
  }
}

export async function sendReviewStep(ctx: BotContext, draft: CompleteDraftProduct): Promise<void> {
  ctx.session.adminAction = {
    kind: "review_product",
    draft
  };

  await ctx.reply(
    renderDraftSummary(draft),
    Markup.inlineKeyboard([
      [Markup.button.callback("Confirm Product", "admin:addproduct:confirm")],
      [Markup.button.callback("Start Over", "admin:addproduct:restart")],
      [Markup.button.callback("Cancel Current Action", "admin:cancel")]
    ])
  );
}

export async function finalizeProductCreation(ctx: BotContext, services: AppServices): Promise<void> {
  const action = ctx.session.adminAction;
  if (!action || action.kind !== "review_product" || !isDraftComplete(action.draft)) {
    await ctx.reply("The product draft is incomplete. Start again with /addproduct.", adminMenuKeyboard());
    clearAdminAction(ctx);
    return;
  }

  const product = await services.catalogService.createProduct({
    title: action.draft.title,
    shortDescription: action.draft.shortDescription,
    type: action.draft.type,
    pricingMode: action.draft.pricingMode,
    fixedXmrAmount: action.draft.fixedXmrAmount,
    usdPriceCents: action.draft.usdPriceCents,
    payload: action.draft.payload
  });

  clearAdminAction(ctx);

  const rows: ButtonRow[] = [[Markup.button.callback("View Product", `admin:product:view:${product.id}`)]];
  if (product.type === "license_key") {
    rows.push([Markup.button.callback("Add License Keys", `admin:stock:add:${product.id}`)]);
  }
  rows.push([Markup.button.callback("Back to Admin", "admin:menu")]);

  await ctx.reply(
    product.type === "license_key"
      ? `Product created: ${product.title}\n\nAdd stock next so paid orders can be fulfilled.`
      : `Product created: ${product.title}`,
    Markup.inlineKeyboard(rows)
  );
}

export async function startTextEdit(
  ctx: BotContext,
  action: PendingAdminAction,
  prompt: string
): Promise<void> {
  ctx.session.adminAction = action;
  await ctx.reply(prompt, cancelKeyboard());
}

export async function handleAdminMessage(ctx: BotContext, services: AppServices): Promise<void> {
  const action = ctx.session.adminAction;
  if (!action) {
    return;
  }

  const text = getMessageText(ctx);

  try {
    if (action.kind === "add_product_title") {
      if (!text) {
        await ctx.reply("Send the product title as text.", cancelKeyboard());
        return;
      }

      ctx.session.adminAction = {
        kind: "add_product_description",
        draft: {
          ...action.draft,
          title: sanitizePlainText(text, 120)
        }
      };

      await ctx.reply("Step 2 of 5\nSend the short description.", cancelKeyboard());
      return;
    }

    if (action.kind === "add_product_description") {
      if (!text) {
        await ctx.reply("Send the short description as text.", cancelKeyboard());
        return;
      }

      ctx.session.adminAction = {
        kind: "add_product_description",
        draft: {
          ...action.draft,
          shortDescription: sanitizePlainText(text, 500)
        }
      };

      await ctx.reply(
        "Choose the product type.",
        addCancelRow([
          [Markup.button.callback("File", "admin:addproduct:type:file")],
          [Markup.button.callback("Text / Code", "admin:addproduct:type:text")],
          [Markup.button.callback("Download Link", "admin:addproduct:type:download_link")],
          [Markup.button.callback("License Key", "admin:addproduct:type:license_key")]
        ])
      );
      return;
    }

    if (action.kind === "add_product_price") {
      const draft = action.draft;
      if (!draft.title || !draft.shortDescription || !draft.type || !draft.pricingMode || !text) {
        await ctx.reply("The product draft is incomplete. Start again with /addproduct.", adminMenuKeyboard());
        clearAdminAction(ctx);
        return;
      }

      if (draft.pricingMode === "fixed_xmr") {
        xmrToAtomic(text.trim());
        draft.fixedXmrAmount = text.trim();
      } else {
        draft.usdPriceCents = parseUsdInput(text);
      }

      ctx.session.adminAction = {
        kind: "add_product_payload",
        draft
      };

      await ctx.reply(buildPayloadPrompt(draft.type), cancelKeyboard());
      return;
    }

    if (action.kind === "add_product_payload") {
      const draft = action.draft;
      if (!draft.title || !draft.shortDescription || !draft.type || !draft.pricingMode) {
        await ctx.reply("The product draft is incomplete. Start again with /addproduct.", adminMenuKeyboard());
        clearAdminAction(ctx);
        return;
      }

      let payload: ProductPayload;
      if (draft.type === "file") {
        if (!hasDocumentMessage(ctx)) {
          await ctx.reply("Send the delivery file as a Telegram document.", cancelKeyboard());
          return;
        }

        payload = {
          kind: "file",
          telegramFileId: ctx.message.document.file_id,
          fileName: ctx.message.document.file_name
        };
      } else if (draft.type === "text") {
        if (!text) {
          await ctx.reply("Send the text or code payload.", cancelKeyboard());
          return;
        }

        payload = {
          kind: "text",
          content: text
        };
      } else if (draft.type === "download_link") {
        if (!text) {
          await ctx.reply("Send the URL as text.", cancelKeyboard());
          return;
        }

        const [url, ...noteLines] = text.split("\n");
        if (!url) {
          await ctx.reply("The first line must be a valid URL.", cancelKeyboard());
          return;
        }

        payload = {
          kind: "download_link",
          url: validateUrl(url),
          note: noteLines.length > 0 ? sanitizePlainText(noteLines.join("\n"), 500) : undefined
        };
      } else {
        payload = {
          kind: "license_key",
          note: text && text !== "/skip" ? sanitizePlainText(text, 500) : undefined
        };
      }

      draft.payload = payload;
      if (!isDraftComplete(draft)) {
        await ctx.reply("The product draft is incomplete. Start again with /addproduct.", adminMenuKeyboard());
        clearAdminAction(ctx);
        return;
      }

      await sendReviewStep(ctx, draft);
      return;
    }

    if (action.kind === "edit_title") {
      if (!text) {
        await ctx.reply("Send the new product title as text.", cancelKeyboard());
        return;
      }

      await services.catalogService.updateProduct(action.productId, {
        title: text
      });
      clearAdminAction(ctx);
      await showProductDetail(ctx, services, action.productId);
      return;
    }

    if (action.kind === "edit_description") {
      if (!text) {
        await ctx.reply("Send the new short description as text.", cancelKeyboard());
        return;
      }

      await services.catalogService.updateProduct(action.productId, {
        shortDescription: text
      });
      clearAdminAction(ctx);
      await showProductDetail(ctx, services, action.productId);
      return;
    }

    if (action.kind === "edit_price") {
      if (!text) {
        await ctx.reply("Send the new price as text.", cancelKeyboard());
        return;
      }

      const product = await services.catalogService.getProductById(action.productId);
      await services.catalogService.updateProduct(action.productId, {
        fixedXmrAmountAtomic: product.pricingMode === "fixed_xmr" ? xmrToAtomic(text.trim()) : undefined,
        usdPriceCents: product.pricingMode === "usd_anchored" ? parseUsdInput(text) : undefined
      });
      clearAdminAction(ctx);
      await showProductDetail(ctx, services, action.productId);
      return;
    }

    if (action.kind === "edit_payload") {
      const product = await services.catalogService.getProductById(action.productId);
      let payload: ProductPayload;

      if (product.type === "file") {
        if (!hasDocumentMessage(ctx)) {
          await ctx.reply("Send the replacement file as a Telegram document.", cancelKeyboard());
          return;
        }

        payload = {
          kind: "file",
          telegramFileId: ctx.message.document.file_id,
          fileName: ctx.message.document.file_name
        };
      } else if (product.type === "text") {
        if (!text) {
          await ctx.reply("Send the replacement text or code.", cancelKeyboard());
          return;
        }

        payload = {
          kind: "text",
          content: text
        };
      } else if (product.type === "download_link") {
        if (!text) {
          await ctx.reply("Send the replacement URL as text.", cancelKeyboard());
          return;
        }

        const [url, ...noteLines] = text.split("\n");
        if (!url) {
          await ctx.reply("The first line must be a valid URL.", cancelKeyboard());
          return;
        }

        payload = {
          kind: "download_link",
          url: validateUrl(url),
          note: noteLines.length > 0 ? sanitizePlainText(noteLines.join("\n"), 500) : undefined
        };
      } else {
        payload = {
          kind: "license_key",
          note: text && text !== "/skip" ? sanitizePlainText(text, 500) : undefined
        };
      }

      await services.catalogService.updateProduct(action.productId, { payload });
      clearAdminAction(ctx);
      await showProductDetail(ctx, services, action.productId);
      return;
    }

    if (action.kind === "add_stock") {
      if (!text) {
        await ctx.reply("Paste one license key per line.", cancelKeyboard());
        return;
      }

      const count = await services.catalogService.addLicenseStock(action.productId, text.split("\n"));
      clearAdminAction(ctx);
      await ctx.reply(
        `Added ${count} license keys.`,
        Markup.inlineKeyboard([
          [Markup.button.callback("Back to Stock", "admin:stock")],
          [Markup.button.callback("View Product", `admin:product:view:${action.productId}`)]
        ])
      );
      return;
    }

    if (action.kind === "edit_why_monero") {
      if (!text) {
        await ctx.reply("Send the replacement message as text.", cancelKeyboard());
        return;
      }

      await services.guideService.setWhyAcceptMoneroMessage(sanitizePlainText(text, 500));
      clearAdminAction(ctx);
      await sendSettingsView(ctx, services);
      return;
    }
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "The admin action failed.", cancelKeyboard());
  }
}
