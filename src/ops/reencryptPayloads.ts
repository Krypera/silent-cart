import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { Database } from "../db/database.js";
import { reencryptStoredPayloads } from "./reencryptionService.js";

loadEnv();

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  FULFILLMENT_ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Fa-f0-9]{64}$/, "FULFILLMENT_ENCRYPTION_KEY must be 64 hex chars"),
  REENCRYPTION_TARGET_KEY: z
    .string()
    .regex(/^[A-Fa-f0-9]{64}$/, "REENCRYPTION_TARGET_KEY must be 64 hex chars"),
  REENCRYPTION_APPLY: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

async function main(): Promise<void> {
  const config = configSchema.parse(process.env);
  const database = new Database(config.DATABASE_URL);

  try {
    const summary = await reencryptStoredPayloads({
      database,
      currentKeyHex: config.FULFILLMENT_ENCRYPTION_KEY,
      targetKeyHex: config.REENCRYPTION_TARGET_KEY,
      apply: config.REENCRYPTION_APPLY
    });

    const modeLabel = summary.apply ? "apply" : "dry-run";
    console.log(`[SilentCart] Re-encryption ${modeLabel} completed.`);
    console.log(`Products: ${summary.products}`);
    console.log(`Product snapshots: ${summary.snapshots}`);
    console.log(`License stock items: ${summary.licenseStockItems}`);
    console.log(`Total records: ${summary.totalRecords}`);

    if (!summary.apply) {
      console.log("No rows were modified. Set REENCRYPTION_APPLY=true to commit the rotation.");
    }
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
