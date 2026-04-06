import type { Telegram } from "telegraf";
import { describe, expect, it, vi } from "vitest";
import { TelegramDeliveryMessenger } from "../../src/bot/telegramMessenger.js";

describe("TelegramDeliveryMessenger", () => {
  it("retries transient sendMessage failures", async () => {
    const telegram = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce({
          response: {
            error_code: 429,
            parameters: {
              retry_after: 0
            }
          }
        })
        .mockResolvedValue({
          message_id: 42
        }),
      sendDocument: vi.fn()
    } as unknown as Telegram;

    const messenger = new TelegramDeliveryMessenger(telegram, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 2
    });

    await expect(messenger.sendMessage(1n, "hello")).resolves.toEqual({
      messageId: 42
    });
    expect(telegram.sendMessage).toHaveBeenCalledTimes(2);
  });
});
