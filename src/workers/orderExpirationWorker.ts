import { logger } from "../logger/logger.js";
import type { SilentCartStore } from "../repositories/store.js";
import { OrderService } from "../services/orderService.js";
import { UserNotificationService } from "../services/userNotificationService.js";

export class OrderExpirationWorker {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly orderService: OrderService,
    private readonly graceMs: number,
    private readonly userNotificationService: UserNotificationService
  ) {}

  public async runOnce(now = new Date()): Promise<void> {
    const orders = await this.store.orders.listByStates(["awaiting_payment"]);
    for (const order of orders) {
      if (order.quoteExpiresAt.getTime() + this.graceMs <= now.getTime()) {
        try {
          await this.orderService.expireOrder(order.id, now);
          await this.userNotificationService.notifyExpired(order.id);
        } catch (error) {
          logger.error("Order expiry worker failed for order.", {
            orderId: order.id,
            error: error instanceof Error ? error.message : "unknown_error"
          });
        }
      }
    }
  }
}
