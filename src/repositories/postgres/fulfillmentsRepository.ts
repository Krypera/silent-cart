import type { Queryable } from "../../db/database.js";
import type { SilentCartStore } from "../store.js";
import { mapFulfillment, type FulfillmentRow, requireRow } from "./shared.js";

export function createFulfillmentsRepository(executor: Queryable): SilentCartStore["fulfillments"] {
  return {
    createOrUpdate: async (input) => {
      const result = await executor.query<FulfillmentRow>(
        `
          insert into fulfillment_records (
            id, order_id, delivery_type, status, attempts,
            last_error_code, delivered_at, last_attempt_at, receipt_message_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          on conflict (order_id)
          do update set
            delivery_type = excluded.delivery_type,
            status = excluded.status,
            attempts = excluded.attempts,
            last_error_code = excluded.last_error_code,
            delivered_at = excluded.delivered_at,
            last_attempt_at = excluded.last_attempt_at,
            receipt_message_id = excluded.receipt_message_id
          returning *
        `,
        [
          input.id,
          input.orderId,
          input.deliveryType,
          input.status,
          input.attempts,
          input.lastErrorCode,
          input.deliveredAt,
          input.lastAttemptAt,
          input.receiptMessageId
        ]
      );

      return mapFulfillment(requireRow(result.rows[0], "fulfillment"));
    },
    findByOrderId: async (orderId) => {
      const result = await executor.query<FulfillmentRow>(
        `select * from fulfillment_records where order_id = $1`,
        [orderId]
      );
      return result.rows[0] ? mapFulfillment(result.rows[0]) : null;
    },
    listByStatus: async (status) => {
      const result = await executor.query<FulfillmentRow>(
        `select * from fulfillment_records where status = $1 order by last_attempt_at asc nulls first`,
        [status]
      );
      return result.rows.map(mapFulfillment);
    }
  };
}
