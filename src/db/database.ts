import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<R>>;
}

export class Database implements Queryable {
  private readonly pool: Pool;

  public constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString
    });
  }

  public async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

  public async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withClient(async (client) => {
      try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  public async withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
