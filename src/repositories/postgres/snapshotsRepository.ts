import type { Queryable } from "../../db/database.js";
import type { SilentCartStore } from "../store.js";
import { mapSnapshot, type ProductSnapshotRow, requireRow } from "./shared.js";

export function createSnapshotsRepository(executor: Queryable): SilentCartStore["snapshots"] {
  return {
    create: async (input) => {
      const result = await executor.query<ProductSnapshotRow>(
        `
          insert into product_snapshots (
            id, order_id, product_id, title, short_description, type, pricing_mode,
            quoted_amount_atomic, quoted_amount_xmr, usd_reference_cents,
            encrypted_payload_snapshot, payload_reference
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          returning *
        `,
        [
          input.id,
          input.orderId,
          input.productId,
          input.title,
          input.shortDescription,
          input.type,
          input.pricingMode,
          input.quotedAmountAtomic.toString(),
          input.quotedAmountXmr,
          input.usdReferenceCents,
          input.encryptedPayloadSnapshot,
          input.payloadReference
        ]
      );

      return mapSnapshot(requireRow(result.rows[0], "product snapshot"));
    },
    findByOrderId: async (orderId) => {
      const result = await executor.query<ProductSnapshotRow>(
        `select * from product_snapshots where order_id = $1`,
        [orderId]
      );
      return result.rows[0] ? mapSnapshot(result.rows[0]) : null;
    },
    update: async (orderId, patch) => {
      const fields: string[] = [];
      const params: unknown[] = [orderId];
      let index = 2;

      const setField = (column: string, value: unknown) => {
        fields.push(`${column} = $${index}`);
        params.push(value);
        index += 1;
      };

      if (patch.payloadReference !== undefined) {
        setField("payload_reference", patch.payloadReference);
      }

      const result = await executor.query<ProductSnapshotRow>(
        `
          update product_snapshots
          set ${fields.join(", ")}
          where order_id = $1
          returning *
        `,
        params
      );

      return mapSnapshot(requireRow(result.rows[0], "product snapshot"));
    }
  };
}
