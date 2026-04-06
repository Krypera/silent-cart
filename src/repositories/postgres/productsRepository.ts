import type { Queryable } from "../../db/database.js";
import type { SilentCartStore } from "../store.js";
import { mapProduct, type ProductRow, requireRow } from "./shared.js";

export function createProductsRepository(executor: Queryable): SilentCartStore["products"] {
  return {
    create: async (input) => {
      const result = await executor.query<ProductRow>(
        `
          insert into products (
            id, title, short_description, type, pricing_mode, fixed_price_atomic,
            usd_price_cents, encrypted_payload, active
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          returning *
        `,
        [
          input.id,
          input.title,
          input.shortDescription,
          input.type,
          input.pricingMode,
          input.fixedPriceAtomic?.toString() ?? null,
          input.usdPriceCents,
          input.encryptedPayload,
          input.active
        ]
      );

      return mapProduct(requireRow(result.rows[0], "product"));
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

      if (patch.title !== undefined) setField("title", patch.title);
      if (patch.shortDescription !== undefined) {
        setField("short_description", patch.shortDescription);
      }
      if (patch.pricingMode !== undefined) setField("pricing_mode", patch.pricingMode);
      if (patch.fixedPriceAtomic !== undefined) {
        setField("fixed_price_atomic", patch.fixedPriceAtomic?.toString() ?? null);
      }
      if (patch.usdPriceCents !== undefined) setField("usd_price_cents", patch.usdPriceCents);
      if (patch.encryptedPayload !== undefined) {
        setField("encrypted_payload", patch.encryptedPayload);
      }
      if (patch.active !== undefined) setField("active", patch.active);

      const result = await executor.query<ProductRow>(
        `
          update products
          set ${fields.join(", ")}, updated_at = now()
          where id = $1
          returning *
        `,
        params
      );

      return mapProduct(requireRow(result.rows[0], "product"));
    },
    findById: async (id) => {
      const result = await executor.query<ProductRow>(`select * from products where id = $1`, [id]);
      return result.rows[0] ? mapProduct(result.rows[0]) : null;
    },
    listActive: async () => {
      const result = await executor.query<ProductRow>(
        `select * from products where active = true order by created_at asc`
      );
      return result.rows.map(mapProduct);
    },
    listAll: async () => {
      const result = await executor.query<ProductRow>(`select * from products order by created_at asc`);
      return result.rows.map(mapProduct);
    },
    listLicenseProducts: async () => {
      const result = await executor.query<ProductRow>(
        `select * from products where type = 'license_key' order by created_at asc`
      );
      return result.rows.map(mapProduct);
    }
  };
}
