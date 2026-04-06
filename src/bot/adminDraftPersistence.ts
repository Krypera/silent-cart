import type { MiddlewareFn } from "telegraf";
import type { AppServices } from "../app/services.js";
import { logger } from "../logger/logger.js";
import type { BotContext } from "./session.js";

function serializeDraft(value: BotContext["session"]["adminAction"]): string {
  return JSON.stringify(value ?? null);
}

export function createAdminDraftPersistenceMiddleware(
  services: Pick<AppServices, "adminAuthorizationService" | "adminDraftService">
): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (!ctx.from || !ctx.chat) {
      await next();
      return;
    }

    const userId = BigInt(ctx.from.id);
    try {
      await services.adminAuthorizationService.assertAdminPrivateChat(userId, ctx.chat.type);
    } catch {
      await next();
      return;
    }

    const persistedDraft = await services.adminDraftService.getDraft(userId);
    ctx.session.adminAction = persistedDraft ?? undefined;
    const before = serializeDraft(ctx.session.adminAction);

    try {
      await next();
    } finally {
      const after = serializeDraft(ctx.session.adminAction);
      if (after === before) {
        return;
      }

      try {
        if (ctx.session.adminAction) {
          await services.adminDraftService.setDraft(userId, ctx.session.adminAction);
        } else {
          await services.adminDraftService.clearDraft(userId);
        }
      } catch (error) {
        logger.warn("Failed to persist admin draft state.", {
          adminUserId: userId.toString(),
          error: error instanceof Error ? error.message : "unknown_error"
        });
      }
    }
  };
}
