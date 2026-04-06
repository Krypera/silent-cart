import {
  ConflictError,
  ExternalServiceError,
  NotFoundError,
  UnauthorizedError,
  ValidationError
} from "../domain/errors.js";
import type { BotContext } from "./session.js";

function formatBotErrorMessage(error: unknown): string {
  if (
    error instanceof ValidationError ||
    error instanceof NotFoundError ||
    error instanceof ConflictError ||
    error instanceof UnauthorizedError
  ) {
    return error.message;
  }

  if (error instanceof ExternalServiceError) {
    return "A required upstream service is temporarily unavailable. Please try again shortly.";
  }

  return "The bot hit an unexpected error. Please try again.";
}

export async function sendBotErrorFeedback(ctx: BotContext, error: unknown): Promise<void> {
  const message = formatBotErrorMessage(error);

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery(message.slice(0, 180), {
      show_alert: true
    }).catch(() => undefined);
    return;
  }

  if (ctx.chat) {
    await ctx.reply(message).catch(() => undefined);
  }
}
