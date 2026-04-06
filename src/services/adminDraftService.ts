import { z } from "zod";
import { pricingModes, productTypes } from "../domain/models.js";
import type { SilentCartStore } from "../repositories/store.js";
import type { PendingAdminAction } from "../bot/session.js";

const filePayloadSchema = z.object({
  kind: z.literal("file"),
  telegramFileId: z.string().min(1),
  fileName: z.string().min(1).optional(),
  caption: z.string().min(1).optional()
});

const textPayloadSchema = z.object({
  kind: z.literal("text"),
  content: z.string().min(1)
});

const downloadLinkPayloadSchema = z.object({
  kind: z.literal("download_link"),
  url: z.string().url(),
  label: z.string().min(1).optional(),
  note: z.string().min(1).optional()
});

const licenseKeyPayloadSchema = z.object({
  kind: z.literal("license_key"),
  note: z.string().min(1).optional()
});

const productPayloadSchema = z.union([
  filePayloadSchema,
  textPayloadSchema,
  downloadLinkPayloadSchema,
  licenseKeyPayloadSchema
]);

const adminDraftProductSchema = z.object({
  title: z.string().min(1).optional(),
  shortDescription: z.string().min(1).optional(),
  type: z.enum(productTypes).optional(),
  pricingMode: z.enum(pricingModes).optional(),
  fixedXmrAmount: z.string().min(1).optional(),
  usdPriceCents: z.number().int().positive().optional(),
  payload: productPayloadSchema.optional()
});

const pendingAdminActionSchema = z.union([
  z.object({ kind: z.literal("add_product_title"), draft: adminDraftProductSchema }),
  z.object({ kind: z.literal("add_product_description"), draft: adminDraftProductSchema }),
  z.object({ kind: z.literal("add_product_price"), draft: adminDraftProductSchema }),
  z.object({ kind: z.literal("add_product_payload"), draft: adminDraftProductSchema }),
  z.object({ kind: z.literal("review_product"), draft: adminDraftProductSchema }),
  z.object({ kind: z.literal("edit_title"), productId: z.string().min(1) }),
  z.object({ kind: z.literal("edit_description"), productId: z.string().min(1) }),
  z.object({ kind: z.literal("edit_price"), productId: z.string().min(1) }),
  z.object({ kind: z.literal("edit_payload"), productId: z.string().min(1) }),
  z.object({ kind: z.literal("add_stock"), productId: z.string().min(1) }),
  z.object({ kind: z.literal("edit_why_monero") })
]);

export class AdminDraftService {
  public constructor(private readonly store: SilentCartStore) {}

  public async getDraft(telegramUserId: bigint): Promise<PendingAdminAction | null> {
    const value = await this.store.settings.get<unknown>(this.settingKey(telegramUserId));
    if (!value) {
      return null;
    }

    const parsed = pendingAdminActionSchema.safeParse(value);
    if (!parsed.success) {
      await this.clearDraft(telegramUserId);
      return null;
    }

    return parsed.data as PendingAdminAction;
  }

  public async setDraft(telegramUserId: bigint, draft: PendingAdminAction): Promise<void> {
    await this.store.settings.set(this.settingKey(telegramUserId), draft);
  }

  public async clearDraft(telegramUserId: bigint): Promise<void> {
    await this.store.settings.delete(this.settingKey(telegramUserId));
  }

  private settingKey(telegramUserId: bigint): string {
    return `admin_draft:${telegramUserId.toString()}`;
  }
}
