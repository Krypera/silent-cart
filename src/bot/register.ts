import { session, Telegraf } from "telegraf";
import type { AppServices } from "../app/services.js";
import { logger } from "../logger/logger.js";
import { createAdminDraftPersistenceMiddleware } from "./adminDraftPersistence.js";
import { sendBotErrorFeedback } from "./errorFeedback.js";
import { registerAdminHandlers } from "./handlers/adminHandlers.js";
import { registerCustomerHandlers } from "./handlers/customerHandlers.js";
import type { BotContext, BotSessionData } from "./session.js";

export function createBot(botToken: string): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(botToken);

  bot.use(
    session({
      defaultSession: (): BotSessionData => ({})
    })
  );

  bot.catch((error, ctx) => {
    logger.error("Unhandled bot error.", {
      error: error instanceof Error ? error.message : "unknown_error"
    });

    if (ctx) {
      void sendBotErrorFeedback(ctx, error);
    }
  });

  return bot;
}

export function registerBotHandlers(bot: Telegraf<BotContext>, services: AppServices): void {
  bot.use(createAdminDraftPersistenceMiddleware(services));
  registerCustomerHandlers(bot, services);
  registerAdminHandlers(bot, services);
}
