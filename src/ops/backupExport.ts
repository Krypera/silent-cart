import { createCipheriv, randomBytes } from "node:crypto";

export interface BackupExportPayload {
  metadata: {
    exportedAt: string;
    includeIdentityLinks: boolean;
    nodeEnv: string;
    schemaVersion: number;
  };
  data: {
    products: unknown[];
    orders: unknown[];
    productSnapshots: unknown[];
    paymentEvents: unknown[];
    fulfillmentRecords: unknown[];
    licenseStockItems: unknown[];
    retentionLinks: unknown[];
    botSettings: unknown[];
    adminUsers: unknown[];
  };
}

export interface BackupEnvelope {
  version: "silentcart-backup-v1";
  algorithm: "aes-256-gcm";
  createdAt: string;
  ivHex: string;
  authTagHex: string;
  ciphertextBase64: string;
}

export function buildBackupEnvelope(payload: BackupExportPayload, keyHex: string): BackupEnvelope {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("Backup key must be 32 bytes (64 hex characters).");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: "silentcart-backup-v1",
    algorithm: "aes-256-gcm",
    createdAt: new Date().toISOString(),
    ivHex: iv.toString("hex"),
    authTagHex: authTag.toString("hex"),
    ciphertextBase64: ciphertext.toString("base64")
  };
}
