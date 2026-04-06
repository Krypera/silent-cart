import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { logger } from "../logger/logger.js";
import type { Queryable } from "../db/database.js";

interface AdvisoryLockClient extends Queryable {}

interface AdvisoryLockConnectionProvider {
  withClient<T>(callback: (client: AdvisoryLockClient) => Promise<T>): Promise<T>;
}

interface AdvisoryLockRow extends QueryResultRow {
  acquired: boolean;
}

interface AdvisoryUnlockRow extends QueryResultRow {
  released: boolean;
}

export class DatabaseTaskCoordinator {
  public constructor(private readonly provider: AdvisoryLockConnectionProvider) {}

  public async runExclusively(taskName: string, task: () => Promise<void>): Promise<boolean> {
    const [keyA, keyB] = advisoryLockKey(taskName);

    return this.provider.withClient(async (client) => {
      const lockResult = await client.query<AdvisoryLockRow>(
        `select pg_try_advisory_lock($1, $2) as acquired`,
        [keyA, keyB]
      );
      const acquired = lockResult.rows[0]?.acquired ?? false;
      if (!acquired) {
        logger.info("Skipping background task iteration because another replica holds the lock.", {
          task: taskName
        });
        return false;
      }

      try {
        await task();
        return true;
      } finally {
        const unlockResult = await client.query<AdvisoryUnlockRow>(
          `select pg_advisory_unlock($1, $2) as released`,
          [keyA, keyB]
        );
        if (!(unlockResult.rows[0]?.released ?? false)) {
          logger.warn("Background task advisory lock was not released cleanly.", {
            task: taskName
          });
        }
      }
    });
  }
}

export function advisoryLockKey(taskName: string): [number, number] {
  const digest = createHash("sha256").update(taskName).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export type { AdvisoryLockConnectionProvider };
