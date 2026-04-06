import type { Queryable } from "../../db/database.js";
import type { SilentCartStore } from "../store.js";
import { mapLicenseStock, type LicenseStockRow, requireRow } from "./shared.js";

export function createLicenseStockRepository(executor: Queryable): SilentCartStore["licenseStock"] {
  return {
    add: async (input) => {
      const result = await executor.query<LicenseStockRow>(
        `
          insert into license_stock_items (id, product_id, encrypted_secret, secret_fingerprint, state)
          values ($1, $2, $3, $4, 'available')
          returning *
        `,
        [input.id, input.productId, input.encryptedSecret, input.secretFingerprint]
      );

      return mapLicenseStock(requireRow(result.rows[0], "license stock"));
    },
    reserveAvailable: async (productId, orderId) => {
      const result = await executor.query<LicenseStockRow>(
        `
          with picked as (
            select id
            from license_stock_items
            where product_id = $1
              and state = 'available'
            order by created_at asc
            limit 1
            for update skip locked
          )
          update license_stock_items
          set state = 'reserved',
              reserved_order_id = $2,
              reserved_at = now()
          where id in (select id from picked)
          returning *
        `,
        [productId, orderId]
      );

      return result.rows[0] ? mapLicenseStock(result.rows[0]) : null;
    },
    releaseReservation: async (orderId) => {
      await executor.query(
        `
          update license_stock_items
          set state = 'available',
              reserved_order_id = null,
              reserved_at = null
          where reserved_order_id = $1
            and state = 'reserved'
        `,
        [orderId]
      );
    },
    finalizeReservation: async (orderId) => {
      const result = await executor.query<LicenseStockRow>(
        `
          update license_stock_items
          set state = 'consumed',
              consumed_order_id = $1,
              consumed_at = coalesce(consumed_at, now())
          where reserved_order_id = $1
            and state in ('reserved', 'consumed')
          returning *
        `,
        [orderId]
      );

      return result.rows[0] ? mapLicenseStock(result.rows[0]) : null;
    },
    findByConsumedOrderId: async (orderId) => {
      const result = await executor.query<LicenseStockRow>(
        `select * from license_stock_items where consumed_order_id = $1`,
        [orderId]
      );
      return result.rows[0] ? mapLicenseStock(result.rows[0]) : null;
    },
    findByReservedOrderId: async (orderId) => {
      const result = await executor.query<LicenseStockRow>(
        `select * from license_stock_items where reserved_order_id = $1`,
        [orderId]
      );
      return result.rows[0] ? mapLicenseStock(result.rows[0]) : null;
    },
    listByProductId: async (productId) => {
      const result = await executor.query<LicenseStockRow>(
        `
          select * from license_stock_items
          where product_id = $1
          order by created_at asc
        `,
        [productId]
      );
      return result.rows.map(mapLicenseStock);
    }
  };
}
