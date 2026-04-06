import { atomicToXmr } from "../utils/money.js";
import type { SilentCartStore } from "../repositories/store.js";

export class StatsService {
  public constructor(private readonly store: SilentCartStore) {}

  public async getBasicStats(): Promise<{
    activeProducts: number;
    totalProducts: number;
    awaitingPayment: number;
    underpaid: number;
    fulfilled: number;
    totalSettledXmr: string;
  }> {
    const [products, awaitingPayment, underpaid, fulfilled, totalSettledAtomic] = await Promise.all([
      this.store.products.listAll(),
      this.store.orders.countByState("awaiting_payment"),
      this.store.orders.countByState("underpaid"),
      this.store.orders.countHistoricallyFulfilled(),
      this.store.orders.sumSettledAtomic()
    ]);

    return {
      activeProducts: products.filter((product) => product.active).length,
      totalProducts: products.length,
      awaitingPayment,
      underpaid,
      fulfilled,
      totalSettledXmr: atomicToXmr(totalSettledAtomic)
    };
  }
}
