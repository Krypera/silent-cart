import { describe, expect, it } from "vitest";
import type { Database } from "../../src/db/database.js";
import type { Queryable } from "../../src/db/database.js";
import { EncryptionService } from "../../src/crypto/encryption.js";
import { reencryptStoredPayloads } from "../../src/ops/reencryptionService.js";
import type { QueryResult, QueryResultRow } from "pg";

interface FakeState {
  products: Array<{ id: string; encrypted_payload: string | null }>;
  snapshots: Array<{ order_id: string; encrypted_payload_snapshot: string | null }>;
  licenses: Array<{ id: string; encrypted_secret: string }>;
  settings: Map<string, unknown>;
}

function createFakeDatabase(state: FakeState) {
  const result = <R extends QueryResultRow>(rows: R[]): QueryResult<R> =>
    ({
      command: "SELECT",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    }) as QueryResult<R>;

  const executor: Queryable = {
    query: async <R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => {
      if (text.includes("select id, encrypted_payload") && text.includes("from products")) {
        return result(state.products as unknown as R[]);
      }

      if (text.includes("update products")) {
        const id = params?.[0] as string;
        const encryptedPayload = params?.[1] as string;
        const row = state.products.find((product) => product.id === id);
        if (row) {
          row.encrypted_payload = encryptedPayload;
        }
        return result<R>([]);
      }

      if (text.includes("select order_id, encrypted_payload_snapshot")) {
        return result(state.snapshots as unknown as R[]);
      }

      if (text.includes("update product_snapshots")) {
        const orderId = params?.[0] as string;
        const encryptedPayload = params?.[1] as string;
        const row = state.snapshots.find((snapshot) => snapshot.order_id === orderId);
        if (row) {
          row.encrypted_payload_snapshot = encryptedPayload;
        }
        return result<R>([]);
      }

      if (text.includes("select id, encrypted_secret")) {
        return result(state.licenses as unknown as R[]);
      }

      if (text.includes("update license_stock_items")) {
        const id = params?.[0] as string;
        const encryptedSecret = params?.[1] as string;
        const row = state.licenses.find((license) => license.id === id);
        if (row) {
          row.encrypted_secret = encryptedSecret;
        }
        return result<R>([]);
      }

      if (text.includes("insert into bot_settings")) {
        const key = params?.[0] as string;
        const valueJson = JSON.parse(params?.[1] as string) as unknown;
        state.settings.set(key, valueJson);
        return result<R>([]);
      }

      throw new Error(`Unexpected query in test: ${text}`);
    }
  };

  return {
    withTransaction: async <T>(callback: (client: Queryable) => Promise<T>) => callback(executor)
  };
}

describe("reencryptStoredPayloads", () => {
  it("supports dry-run and apply modes", async () => {
    const currentKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const nextKey = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const currentEncryption = new EncryptionService(currentKey);
    const nextEncryption = new EncryptionService(nextKey);
    const state: FakeState = {
      products: [
        {
          id: "product-1",
          encrypted_payload: currentEncryption.encryptJson({ kind: "text", content: "product" })
        }
      ],
      snapshots: [
        {
          order_id: "order-1",
          encrypted_payload_snapshot: currentEncryption.encryptJson({
            kind: "text",
            content: "snapshot"
          })
        }
      ],
      licenses: [
        {
          id: "license-1",
          encrypted_secret: currentEncryption.encryptJson({ key: "SECRET-1" })
        }
      ],
      settings: new Map()
    };

    const originalProductCiphertext = state.products[0]?.encrypted_payload ?? null;

    const dryRunSummary = await reencryptStoredPayloads({
      database: createFakeDatabase(state) as unknown as Database,
      currentKeyHex: currentKey,
      targetKeyHex: nextKey,
      apply: false
    });

    expect(dryRunSummary.totalRecords).toBe(3);
    expect(state.products[0]?.encrypted_payload).toBe(originalProductCiphertext);
    expect(state.settings.size).toBe(0);

    const applySummary = await reencryptStoredPayloads({
      database: createFakeDatabase(state) as unknown as Database,
      currentKeyHex: currentKey,
      targetKeyHex: nextKey,
      apply: true
    });

    expect(applySummary.totalRecords).toBe(3);
    expect(
      nextEncryption.decryptJson<{ kind: string; content: string }>(state.products[0]?.encrypted_payload ?? "")
        .content
    ).toBe("product");
    expect(
      nextEncryption.decryptJson<{ kind: string; content: string }>(
        state.snapshots[0]?.encrypted_payload_snapshot ?? ""
      ).content
    ).toBe("snapshot");
    expect(
      nextEncryption.decryptJson<{ key: string }>(state.licenses[0]?.encrypted_secret ?? "").key
    ).toBe("SECRET-1");
    expect(state.settings.has("crypto.reencryption_last_run")).toBe(true);
  });
});
