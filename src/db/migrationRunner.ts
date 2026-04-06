import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { Database } from "./database.js";

const MIGRATION_LOCK_ID = 848_376_221;

interface MigrationFile {
  version: number;
  filename: string;
  name: string;
  checksum: string;
  sql: string;
}

interface AppliedMigrationRow {
  version: string;
  filename: string;
  checksum: string;
}

function parseMigrationVersion(filename: string): number {
  const match = /^(\d+)_([a-z0-9_]+)\.sql$/i.exec(filename);
  if (!match) {
    throw new Error(`Invalid migration filename "${filename}". Expected 001_name.sql format.`);
  }

  const versionText = match[1];
  if (!versionText) {
    throw new Error(`Invalid migration filename "${filename}". Missing migration version.`);
  }

  return Number.parseInt(versionText, 10);
}

function parseMigrationName(filename: string): string {
  const match = /^(\d+)_([a-z0-9_]+)\.sql$/i.exec(filename);
  if (!match) {
    throw new Error(`Invalid migration filename "${filename}". Expected 001_name.sql format.`);
  }

  const name = match[2];
  if (!name) {
    throw new Error(`Invalid migration filename "${filename}". Missing migration name.`);
  }

  return name;
}

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function loadMigrationFiles(migrationDir: string): Promise<MigrationFile[]> {
  const filenames = (await readdir(migrationDir))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(path.join(migrationDir, filename), "utf8");
      return {
        version: parseMigrationVersion(filename),
        filename,
        name: parseMigrationName(filename),
        checksum: checksum(sql),
        sql
      };
    })
  );
}

async function ensureSchemaMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      version bigint primary key,
      filename text not null unique,
      name text not null,
      checksum text not null,
      executed_at timestamptz not null default now()
    )
  `);
}

async function getAppliedMigrations(client: PoolClient): Promise<Map<number, AppliedMigrationRow>> {
  const result = await client.query<AppliedMigrationRow>(`
    select version::text as version, filename, checksum
    from schema_migrations
    order by version asc
  `);

  return new Map(
    result.rows.map((row) => [Number.parseInt(row.version, 10), row] as const)
  );
}

async function runSingleMigration(client: PoolClient, migration: MigrationFile): Promise<void> {
  try {
    await client.query("BEGIN");
    await client.query(migration.sql);
    await client.query(
      `
        insert into schema_migrations (version, filename, name, checksum)
        values ($1, $2, $3, $4)
      `,
      [migration.version, migration.filename, migration.name, migration.checksum]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runMigrations(database: Database, migrationDir: string): Promise<void> {
  const migrationFiles = await loadMigrationFiles(migrationDir);

  await database.withClient(async (client) => {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    try {
      await ensureSchemaMigrationsTable(client);
      const appliedMigrations = await getAppliedMigrations(client);

      for (const migration of migrationFiles) {
        const applied = appliedMigrations.get(migration.version);
        if (applied) {
          if (applied.checksum !== migration.checksum) {
            throw new Error(
              `Migration checksum mismatch for ${migration.filename}. Refuse to continue because an applied migration changed.`
            );
          }
          continue;
        }

        await runSingleMigration(client, migration);
      }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    }
  });
}
