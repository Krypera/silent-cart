import type { Telegram } from "telegraf";
import type { DeliveryMessenger } from "../services/fulfillment/fulfillmentEngine.js";
import { logger } from "../logger/logger.js";

export class TelegramDeliveryMessenger implements DeliveryMessenger {
  public constructor(
    private readonly telegram: Telegram,
    private readonly options: {
      maxAttempts: number;
      baseDelayMs: number;
      maxDelayMs: number;
    }
  ) {}

  public async sendMessage(chatId: bigint, text: string): Promise<{ messageId: number }> {
    const message = await this.withRetry("sendMessage", () =>
      this.telegram.sendMessage(chatId.toString(), text)
    );
    return {
      messageId: message.message_id
    };
  }

  public async sendDocument(
    chatId: bigint,
    fileId: string,
    caption?: string
  ): Promise<{ messageId: number }> {
    const message = await this.withRetry("sendDocument", () =>
      this.telegram.sendDocument(chatId.toString(), fileId, {
        caption
      })
    );

    return {
      messageId: message.message_id
    };
  }

  private async withRetry<T>(operation: string, callback: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        return await callback();
      } catch (error) {
        lastError = error;
        const delayMs = this.nextDelay(error, attempt);
        if (delayMs === null || attempt >= this.options.maxAttempts) {
          throw error;
        }

        logger.warn("Telegram API call failed. Retrying.", {
          operation,
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : "unknown_error"
        });
        await sleep(delayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Telegram API call failed.");
  }

  private nextDelay(error: unknown, attempt: number): number | null {
    const retryAfterSeconds = readRetryAfterSeconds(error);
    if (retryAfterSeconds !== null) {
      return retryAfterSeconds * 1000;
    }

    if (!isRetryableTelegramError(error)) {
      return null;
    }

    return Math.min(this.options.baseDelayMs * 2 ** (attempt - 1), this.options.maxDelayMs);
  }
}

function readRetryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as {
    response?: {
      parameters?: {
        retry_after?: number;
      };
    };
    parameters?: {
      retry_after?: number;
    };
  };

  return candidate.response?.parameters?.retry_after ?? candidate.parameters?.retry_after ?? null;
}

function isRetryableTelegramError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: number | string;
    status?: number;
    response?: {
      error_code?: number;
    };
    message?: string;
  };

  const statusCode =
    candidate.response?.error_code ??
    (typeof candidate.status === "number" ? candidate.status : null) ??
    (typeof candidate.code === "number" ? candidate.code : null);

  if (statusCode !== null && [429, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  if (
    typeof candidate.code === "string" &&
    ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND"].includes(candidate.code)
  ) {
    return true;
  }

  const message = candidate.message?.toLowerCase() ?? "";
  return message.includes("timeout") || message.includes("network") || message.includes("temporarily");
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
