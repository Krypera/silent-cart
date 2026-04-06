import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import type { QueryResultRow } from "pg";
import { loadEnvConfig } from "../config/env.js";
import { Database } from "../db/database.js";
import { buildBackupEnvelope, type BackupExportPayload } from "./backupExport.js";

loadEnv();

const exportSchema = z.object({
  BACKUP_EXPORT_KEY: z
    .string()
    .regex(/^[A-Fa-f0-9]{64}$/)
    .optional(),
  BACKUP_INCLUDE_IDENTITY_LINKS: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  BACKUP_EXPORT_OUTPUT_DIR: z.string().optional().default("backups"),
  BACKUP_EXPORT_FILE_NAME: z.string().optional()
});

interface GenericRow extends QueryResultRow {
  [key: string]: unknown;
}

async function loadRows(database: Database, table: string): Promise<GenericRow[]> {
  const result = await database.query<GenericRow>(`select * from ${table}`);
  return result.rows;
}

function buildFileName(customName: string | undefined): string {
  if (customName && customName.trim().length > 0) {
    return customName.trim();
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `silentcart-backup-${stamp}.json.enc`;
}

async function main(): Promise<void> {
  const env = loadEnvConfig();
  const backupConfig = exportSchema.parse(process.env);
  const database = new Database(env.databaseUrl);
  const keyHex = backupConfig.BACKUP_EXPORT_KEY ?? env.fulfillmentEncryptionKey;

  try {
    const [
      products,
      orders,
      productSnapshots,
      paymentEvents,
      fulfillmentRecords,
      licenseStockItems,
      retentionLinks,
      botSettings,
      adminUsers
    ] = await Promise.all([
      loadRows(database, "products"),
      loadRows(database, "orders"),
      loadRows(database, "product_snapshots"),
      loadRows(database, "payment_events"),
      loadRows(database, "fulfillment_records"),
      loadRows(database, "license_stock_items"),
      loadRows(database, "retention_links"),
      loadRows(database, "bot_settings"),
      loadRows(database, "admin_users")
    ]);

    const sanitizedRetentionLinks = retentionLinks.map((row) => {
      if (backupConfig.BACKUP_INCLUDE_IDENTITY_LINKS) {
        return row;
      }

      const { telegram_user_id, ...rest } = row;
      return {
        ...rest,
        telegram_user_id: null,
        had_identity_link: telegram_user_id !== null
      };
    });

    const payload: BackupExportPayload = {
      metadata: {
        exportedAt: new Date().toISOString(),
        includeIdentityLinks: backupConfig.BACKUP_INCLUDE_IDENTITY_LINKS,
        nodeEnv: env.nodeEnv,
        schemaVersion: 1
      },
      data: {
        products,
        orders,
        productSnapshots,
        paymentEvents,
        fulfillmentRecords,
        licenseStockItems,
        retentionLinks: sanitizedRetentionLinks,
        botSettings,
        adminUsers
      }
    };

    const envelope = buildBackupEnvelope(payload, keyHex);
    const outputDir = path.resolve(process.cwd(), backupConfig.BACKUP_EXPORT_OUTPUT_DIR);
    await mkdir(outputDir, { recursive: true });
    const fileName = buildFileName(backupConfig.BACKUP_EXPORT_FILE_NAME);
    const outputPath = path.join(outputDir, fileName);
    await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

    console.log("[SilentCart] Encrypted backup export completed.");
    console.log(`Output file: ${outputPath}`);
    console.log(`Included identity links: ${backupConfig.BACKUP_INCLUDE_IDENTITY_LINKS ? "yes" : "no"}`);
    console.log("Backup key source: " + (backupConfig.BACKUP_EXPORT_KEY ? "BACKUP_EXPORT_KEY" : "FULFILLMENT_ENCRYPTION_KEY"));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
