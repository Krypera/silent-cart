import { logger } from "../logger/logger.js";
import type { SilentCartStore } from "../repositories/store.js";

export class ExpiredReservationReleaseWorker {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly releaseDelayMinutes: number
  ) {}

  public async runOnce(now = new Date()): Promise<void> {
    const expiredOrders = await this.store.orders.listByStates(["expired"]);
    const releaseBefore = now.getTime() - this.releaseDelayMinutes * 60 * 1000;

    for (const order of expiredOrders) {
      const retentionLink = await this.store.retention.findByOrderId(order.id);
      const expiredAt = retentionLink?.expiresAt;
      if (!expiredAt || expiredAt.getTime() > releaseBefore) {
        continue;
      }

      try {
        await this.store.licenseStock.releaseReservation(order.id);
      } catch (error) {
        logger.error("Expired reservation release failed for order.", {
          orderId: order.id,
          error: error instanceof Error ? error.message : "unknown_error"
        });
      }
    }
  }
}
