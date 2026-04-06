import { describe, expect, it, vi } from "vitest";
import type { OrderState } from "../../src/domain/models.js";
import { InMemoryStore } from "../../src/repositories/inMemoryStore.js";

async function createOrder(
  store: InMemoryStore,
  id: string,
  state: OrderState,
  subaddressIndex: number
): Promise<void> {
  await store.orders.create({
    id,
    productId: "product-1",
    state,
    prePurgeState: null,
    pricingMode: "fixed_xmr",
    quotedAmountAtomic: 1n,
    quotedAmountXmr: "0.000000000001",
    usdReferenceCents: null,
    paymentAddress: `4SilentCartSubaddress${subaddressIndex}`,
    accountIndex: 0,
    subaddressIndex,
    quoteExpiresAt: new Date("2026-01-02T00:00:00.000Z"),
    paymentTxHash: null,
    paymentReceivedAtomic: null,
    paymentSeenAt: null,
    confirmedAt: null,
    fulfilledAt: null
  });
}

describe("InMemoryStore order pagination", () => {
  it("counts and pages recent orders with optional state filters", async () => {
    vi.useFakeTimers();

    try {
      const store = new InMemoryStore();

      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      await createOrder(store, "order-1", "created", 1);

      vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
      await createOrder(store, "order-2", "confirmed", 2);

      vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));
      await createOrder(store, "order-3", "expired", 3);

      vi.setSystemTime(new Date("2026-01-01T00:03:00.000Z"));
      await createOrder(store, "order-4", "awaiting_payment", 4);

      const secondPage = await store.orders.listRecent(2, 1);
      const filtered = await store.orders.listRecent(5, 0, ["created", "confirmed"]);
      const filteredCount = await store.orders.countMatching(["created", "confirmed"]);

      expect(secondPage.map((order) => order.id)).toEqual(["order-3", "order-2"]);
      expect(filtered.map((order) => order.id)).toEqual(["order-2", "order-1"]);
      expect(filteredCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
