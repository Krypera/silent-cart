import type { QueryResultRow } from "pg";
import { createHash } from "node:crypto";
import { EncryptionService } from "../crypto/encryption.js";
import { Database } from "../db/database.js";

interface EncryptedProductRow extends QueryResultRow {
  id: string;
  encrypted_payload: string | null;
}

interface EncryptedSnapshotRow extends QueryResultRow {
  order_id: string;
  encrypted_payload_snapshot: string | null;
}

interface EncryptedLicenseRow extends QueryResultRow {
  id: string;
  encrypted_secret: string;
}

export interface ReencryptionSummary {
  products: number;
  snapshots: number;
  licenseStockItems: number;
  totalRecords: number;
  apply: boolean;
}

function fingerprintKey(hexKey: string): string {
  return createHash("sha256").update(hexKey).digest("hex");
}

export async function reencryptStoredPayloads(args: {
  database: Database;
  currentKeyHex: string;
  targetKeyHex: string;
  apply: boolean;
  now?: Date;
}): Promise<ReencryptionSummary> {
  if (args.currentKeyHex === args.targetKeyHex) {
    throw new Error("The target encryption key must be different from the current key.");
  }

  const currentEncryption = new EncryptionService(args.currentKeyHex);
  const targetEncryption = new EncryptionService(args.targetKeyHex);
  const summary: ReencryptionSummary = {
    products: 0,
    snapshots: 0,
    licenseStockItems: 0,
    totalRecords: 0,
    apply: args.apply
  };

  await args.database.withTransaction(async (client) => {
    const productRows = await client.query<EncryptedProductRow>(
      `
        select id, encrypted_payload
        from products
        where encrypted_payload is not null
        order by created_at asc
      `
    );

    for (const row of productRows.rows) {
      if (!row.encrypted_payload) {
        continue;
      }

      const payload = currentEncryption.decryptJson<unknown>(row.encrypted_payload);
      const reencrypted = targetEncryption.encryptJson(payload);

      if (args.apply) {
        await client.query(
          `
            update products
            set encrypted_payload = $2,
                updated_at = now()
            where id = $1
          `,
          [row.id, reencrypted]
        );
      }

      summary.products += 1;
    }

    const snapshotRows = await client.query<EncryptedSnapshotRow>(
      `
        select order_id, encrypted_payload_snapshot
        from product_snapshots
        where encrypted_payload_snapshot is not null
        order by created_at asc
      `
    );

    for (const row of snapshotRows.rows) {
      if (!row.encrypted_payload_snapshot) {
        continue;
      }

      const payload = currentEncryption.decryptJson<unknown>(row.encrypted_payload_snapshot);
      const reencrypted = targetEncryption.encryptJson(payload);

      if (args.apply) {
        await client.query(
          `
            update product_snapshots
            set encrypted_payload_snapshot = $2
            where order_id = $1
          `,
          [row.order_id, reencrypted]
        );
      }

      summary.snapshots += 1;
    }

    const licenseRows = await client.query<EncryptedLicenseRow>(
      `
        select id, encrypted_secret
        from license_stock_items
        order by created_at asc
      `
    );

    for (const row of licenseRows.rows) {
      const secret = currentEncryption.decryptJson<unknown>(row.encrypted_secret);
      const reencrypted = targetEncryption.encryptJson(secret);

      if (args.apply) {
        await client.query(
          `
            update license_stock_items
            set encrypted_secret = $2
            where id = $1
          `,
          [row.id, reencrypted]
        );
      }

      summary.licenseStockItems += 1;
    }

    summary.totalRecords = summary.products + summary.snapshots + summary.licenseStockItems;

    if (args.apply) {
      await client.query(
        `
          insert into bot_settings (key, value_json)
          values ($1, $2::jsonb)
          on conflict (key)
          do update set
            value_json = excluded.value_json,
            updated_at = now()
        `,
        [
          "crypto.reencryption_last_run",
          JSON.stringify({
            executedAt: (args.now ?? new Date()).toISOString(),
            sourceKeyFingerprint: fingerprintKey(args.currentKeyHex),
            targetKeyFingerprint: fingerprintKey(args.targetKeyHex),
            counts: {
              products: summary.products,
              snapshots: summary.snapshots,
              licenseStockItems: summary.licenseStockItems,
              totalRecords: summary.totalRecords
            }
          })
        ]
      );
    }
  });

  return summary;
}
