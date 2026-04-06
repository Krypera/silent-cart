import { logger } from "../logger/logger.js";
import type { SilentCartStore } from "../repositories/store.js";

export interface TextMessenger {
  sendMessage(chatId: bigint, text: string): Promise<{ messageId: number }>;
}

export class UserNotificationService {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly messenger: TextMessenger
  ) {}

  public async notifyPaymentSeen(orderId: string): Promise<void> {
    await this.sendToOrderOwner(
      orderId,
      "Payment seen.",
      "SilentCart detected your transfer and is waiting for 1 confirmation before delivery."
    );
  }

  public async notifyPaymentConfirmed(orderId: string): Promise<void> {
    await this.sendToOrderOwner(
      orderId,
      "Payment confirmed.",
      "Delivery is being prepared now. If Telegram is temporarily slow, use /deliveries or /checkout in a moment."
    );
  }

  public async notifyUnderpaid(orderId: string): Promise<void> {
    await this.sendToOrderOwner(
      orderId,
      "Order marked underpaid.",
      "This checkout was not fulfilled because the quoted amount was not met before the quote ended. Underpaid orders are final in v1."
    );
  }

  public async notifyExpired(orderId: string): Promise<void> {
    await this.sendToOrderOwner(
      orderId,
      "Quote expired.",
      "No qualifying payment was confirmed before the quote ended. If you already paid on time, keep the order ID and contact the operator if needed."
    );
  }

  private async sendToOrderOwner(orderId: string, title: string, body: string): Promise<void> {
    try {
      const retentionLink = await this.store.retention.findByOrderId(orderId);
      if (!retentionLink?.telegramUserId) {
        return;
      }

      const order = await this.store.orders.findById(orderId);
      const snapshot = await this.store.snapshots.findByOrderId(orderId);
      if (!order) {
        return;
      }

      const lines = [
        title,
        "",
        `Order ID: ${order.id}`,
        `Product: ${snapshot?.title ?? "SilentCart product"}`,
        body
      ];

      await this.messenger.sendMessage(retentionLink.telegramUserId, lines.join("\n"));
    } catch (error) {
      logger.warn("User notification failed.", {
        orderId,
        error: error instanceof Error ? error.message : "unknown_error"
      });
    }
  }
}
