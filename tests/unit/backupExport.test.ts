import { createDecipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildBackupEnvelope, type BackupExportPayload } from "../../src/ops/backupExport.js";

function decryptEnvelope(envelope: ReturnType<typeof buildBackupEnvelope>, keyHex: string): BackupExportPayload {
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(envelope.ivHex, "hex");
  const authTag = Buffer.from(envelope.authTagHex, "hex");
  const ciphertext = Buffer.from(envelope.ciphertextBase64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as BackupExportPayload;
}

describe("backupExport", () => {
  it("builds an encrypted envelope that decrypts back to the original payload", () => {
    const payload: BackupExportPayload = {
      metadata: {
        exportedAt: "2026-04-06T00:00:00.000Z",
        includeIdentityLinks: false,
        nodeEnv: "production",
        schemaVersion: 1
      },
      data: {
        products: [{ id: "p1" }],
        orders: [{ id: "o1" }],
        productSnapshots: [],
        paymentEvents: [],
        fulfillmentRecords: [],
        licenseStockItems: [],
        retentionLinks: [{ order_id: "o1", telegram_user_id: null }],
        botSettings: [],
        adminUsers: []
      }
    };
    const keyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const envelope = buildBackupEnvelope(payload, keyHex);
    const decrypted = decryptEnvelope(envelope, keyHex);

    expect(envelope.version).toBe("silentcart-backup-v1");
    expect(envelope.algorithm).toBe("aes-256-gcm");
    expect(decrypted).toEqual(payload);
  });
});
