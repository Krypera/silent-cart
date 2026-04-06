import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "../config/env.js";
import { Database } from "./database.js";
import { runMigrations } from "./migrationRunner.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

async function run() {
  const env = loadEnvConfig();
  const database = new Database(env.databaseUrl);

  try {
    const migrationDir = path.join(currentDir, "migrations");
    await runMigrations(database, migrationDir);
  } finally {
    await database.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
