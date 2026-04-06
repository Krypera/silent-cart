import type { Queryable } from "../../db/database.js";
import type { SilentCartStore } from "../store.js";
import { mapPayment, type PaymentEventRow, requireRow } from "./shared.js";

export function createPaymentsRepository(executor: Queryable): SilentCartStore["payments"] {
  return {
    upsert: async (input) => {
      const result = await executor.query<PaymentEventRow>(
        `
          insert into payment_events (
            id, order_id, tx_hash, amount_atomic, confirmations,
            category, first_seen_at, last_seen_at, confirmed_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          on conflict (order_id, tx_hash)
          do update set
            amount_atomic = excluded.amount_atomic,
            confirmations = excluded.confirmations,
            category = excluded.category,
            last_seen_at = excluded.last_seen_at,
            confirmed_at = excluded.confirmed_at
          returning *
        `,
        [
          input.id,
          input.orderId,
          input.txHash,
          input.amountAtomic.toString(),
          input.confirmations,
          input.category,
          input.firstSeenAt,
          input.lastSeenAt,
          input.confirmedAt
        ]
      );

      return mapPayment(requireRow(result.rows[0], "payment event"));
    },
    findByOrderId: async (orderId) => {
      const result = await executor.query<PaymentEventRow>(
        `
          select * from payment_events
          where order_id = $1
          order by first_seen_at asc
        `,
        [orderId]
      );
      return result.rows.map(mapPayment);
    },
    findByTxHash: async (txHash) => {
      const result = await executor.query<PaymentEventRow>(
        `
          select * from payment_events
          where tx_hash = $1
          order by first_seen_at asc
        `,
        [txHash]
      );
      return result.rows.map(mapPayment);
    },
    listRecent: async (limit) => {
      const result = await executor.query<PaymentEventRow>(
        `
          select * from payment_events
          order by last_seen_at desc
          limit $1
        `,
        [limit]
      );
      return result.rows.map(mapPayment);
    }
  };
}
