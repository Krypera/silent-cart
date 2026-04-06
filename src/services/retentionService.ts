import type { SilentCartStore } from "../repositories/store.js";
import { assertOrderTransition } from "./orderStateMachine.js";

export class RetentionService {
  public constructor(
    private readonly store: SilentCartStore,
    private readonly retentionDays: number
  ) {}

  public async activateForFulfilledOrder(orderId: string, fulfilledAt: Date): Promise<void> {
    const expiresAt = new Date(fulfilledAt.getTime() + this.retentionDays * 24 * 60 * 60 * 1000);
    await this.store.retention.update(orderId, {
      expiresAt
    });
  }

  public async expireLinkNow(orderId: string, now: Date): Promise<void> {
    await this.store.retention.update(orderId, {
      expiresAt: now
    });
  }

  public async purgeExpiredLinks(now: Date): Promise<number> {
    const expiredLinks = await this.store.retention.listExpired(now);

    for (const link of expiredLinks) {
      await this.store.withTransaction(async (tx) => {
        const order = await tx.orders.findById(link.orderId);
        if (!order) {
          return;
        }

        if (order.state !== "purged") {
          assertOrderTransition(order.state, "purged");
          await tx.orders.update(order.id, {
            state: "purged",
            prePurgeState: order.state
          });
        }

        await tx.retention.update(order.id, {
          telegramUserId: null,
          purgedAt: now
        });
      });
    }

    return expiredLinks.length;
  }
}
