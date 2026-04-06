import type { Queryable } from "../../db/database.js";
import type { SilentCartStore } from "../store.js";
import { mapOrder, requireRow, toBigInt, type OrderRow } from "./shared.js";

export function createOrdersRepository(executor: Queryable): SilentCartStore["orders"] {
  return {
    create: async (input) => {
      const result = await executor.query<OrderRow>(
        `
          insert into orders (
            id, product_id, state, pre_purge_state, pricing_mode, quoted_amount_atomic,
            quoted_amount_xmr, usd_reference_cents, payment_address, account_index,
            subaddress_index, quote_expires_at, payment_tx_hash, payment_received_atomic,
            payment_seen_at, confirmed_at, fulfilled_at
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15, $16, $17
          )
          returning *
        `,
        [
          input.id,
          input.productId,
          input.state,
          input.prePurgeState,
          input.pricingMode,
          input.quotedAmountAtomic.toString(),
          input.quotedAmountXmr,
          input.usdReferenceCents,
          input.paymentAddress,
          input.accountIndex,
          input.subaddressIndex,
          input.quoteExpiresAt,
          input.paymentTxHash,
          input.paymentReceivedAtomic?.toString() ?? null,
          input.paymentSeenAt,
          input.confirmedAt,
          input.fulfilledAt
        ]
      );

      return mapOrder(requireRow(result.rows[0], "order"));
    },
    update: async (id, patch) => {
      const fields: string[] = [];
      const params: unknown[] = [id];
      let index = 2;

      const setField = (column: string, value: unknown) => {
        fields.push(`${column} = $${index}`);
        params.push(value);
        index += 1;
      };

      if (patch.state !== undefined) setField("state", patch.state);
      if (patch.prePurgeState !== undefined) setField("pre_purge_state", patch.prePurgeState);
      if (patch.paymentTxHash !== undefined) setField("payment_tx_hash", patch.paymentTxHash);
      if (patch.paymentReceivedAtomic !== undefined) {
        setField("payment_received_atomic", patch.paymentReceivedAtomic?.toString() ?? null);
      }
      if (patch.paymentSeenAt !== undefined) setField("payment_seen_at", patch.paymentSeenAt);
      if (patch.confirmedAt !== undefined) setField("confirmed_at", patch.confirmedAt);
      if (patch.fulfilledAt !== undefined) setField("fulfilled_at", patch.fulfilledAt);

      const result = await executor.query<OrderRow>(
        `
          update orders
          set ${fields.join(", ")}, updated_at = now()
          where id = $1
          returning *
        `,
        params
      );

      return mapOrder(requireRow(result.rows[0], "order"));
    },
    findById: async (id) => {
      const result = await executor.query<OrderRow>(`select * from orders where id = $1`, [id]);
      return result.rows[0] ? mapOrder(result.rows[0]) : null;
    },
    listByStates: async (states, limit, offset) => {
      const params: unknown[] = [states];
      const clauses: string[] = [];

      if (limit !== undefined) {
        params.push(limit);
        clauses.push(`limit $${params.length}`);
      }

      if (offset !== undefined && offset > 0) {
        params.push(offset);
        clauses.push(`offset $${params.length}`);
      }

      const result = await executor.query<OrderRow>(
        `
          select * from orders
          where state = any($1::text[])
          order by created_at asc
          ${clauses.join(" ")}
        `,
        params
      );
      return result.rows.map(mapOrder);
    },
    listRecent: async (limit, offset = 0, states) => {
      const params: unknown[] = [];
      const whereClause = states ? `where state = any($1::text[])` : "";
      if (states) {
        params.push(states);
      }
      params.push(limit);
      params.push(offset);
      const result = await executor.query<OrderRow>(
        `
          select * from orders
          ${whereClause}
          order by created_at desc
          limit $${states ? 2 : 1}
          offset $${states ? 3 : 2}
        `,
        params
      );
      return result.rows.map(mapOrder);
    },
    countMatching: async (states) => {
      if (states && states.length > 0) {
        const result = await executor.query<{ count: string }>(
          `
            select count(*)::text as count
            from orders
            where state = any($1::text[])
          `,
          [states]
        );
        return Number(requireRow(result.rows[0], "matching order count").count);
      }

      const result = await executor.query<{ count: string }>(
        `
          select count(*)::text as count
          from orders
        `
      );
      return Number(requireRow(result.rows[0], "order count").count);
    },
    countByState: async (state) => {
      const result = await executor.query<{ count: string }>(
        `select count(*)::text as count from orders where state = $1`,
        [state]
      );
      return Number(requireRow(result.rows[0], "order count").count);
    },
    countHistoricallyFulfilled: async () => {
      const result = await executor.query<{ count: string }>(
        `
          select count(*)::text as count
          from orders
          where state = 'fulfilled'
             or pre_purge_state = 'fulfilled'
        `
      );
      return Number(requireRow(result.rows[0], "historical fulfilled count").count);
    },
    countOpenOrders: async () => {
      const result = await executor.query<{ count: string }>(
        `
          select count(*)::text as count
          from orders
          where state = any($1::text[])
        `,
        [["awaiting_payment", "payment_seen", "confirmed"]]
      );
      return Number(requireRow(result.rows[0], "open order count").count);
    },
    sumSettledAtomic: async () => {
      const result = await executor.query<{ sum_atomic: string | null }>(
        `
          select sum(quoted_amount_atomic)::text as sum_atomic
          from orders
          where state = 'fulfilled'
             or pre_purge_state = 'fulfilled'
        `
      );
      const row = requireRow(result.rows[0], "settled amount");
      return row.sum_atomic ? toBigInt(row.sum_atomic) : 0n;
    }
  };
}
