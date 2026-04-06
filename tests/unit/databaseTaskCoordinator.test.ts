import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import {
  DatabaseTaskCoordinator,
  type AdvisoryLockConnectionProvider
} from "../../src/workers/databaseTaskCoordinator.js";

type FakeRow = QueryResultRow;

function createQueryResult<R extends FakeRow>(row: R): QueryResult<R> {
  return {
    command: "SELECT",
    rowCount: 1,
    oid: 0,
    fields: [],
    rows: [row]
  };
}

class FakeClient {
  public released = true;

  public constructor(private readonly acquired: boolean) {}

  public async query<R extends FakeRow = FakeRow>(text: string): Promise<QueryResult<R>> {
    if (text.includes("pg_try_advisory_lock")) {
      this.released = false;
      return createQueryResult({ acquired: this.acquired } as unknown as R);
    }

    if (text.includes("pg_advisory_unlock")) {
      this.released = true;
      return createQueryResult({ released: true } as unknown as R);
    }

    throw new Error(`Unexpected query: ${text}`);
  }
}

describe("DatabaseTaskCoordinator", () => {
  it("runs the task only when it acquires the advisory lock", async () => {
    const client = new FakeClient(true);
    const provider: AdvisoryLockConnectionProvider = {
      withClient: async (callback) => callback(client)
    };
    const coordinator = new DatabaseTaskCoordinator(provider);

    let ran = false;
    const result = await coordinator.runExclusively("payment-scan", async () => {
      ran = true;
    });

    expect(result).toBe(true);
    expect(ran).toBe(true);
    expect(client.released).toBe(true);
  });

  it("skips the task when another replica already holds the advisory lock", async () => {
    const client = new FakeClient(false);
    const provider: AdvisoryLockConnectionProvider = {
      withClient: async (callback) => callback(client)
    };
    const coordinator = new DatabaseTaskCoordinator(provider);

    let ran = false;
    const result = await coordinator.runExclusively("payment-scan", async () => {
      ran = true;
    });

    expect(result).toBe(false);
    expect(ran).toBe(false);
    expect(client.released).toBe(false);
  });
});
