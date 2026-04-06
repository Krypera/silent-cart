import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const migrationDir = path.join(currentDir, "migrations");
const migrationPattern = /^(\d+)_([a-z0-9_]+)\.sql$/i;

function toSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function nextVersion(): Promise<number> {
  const files = await readdir(migrationDir);
  const versions = files
    .map((filename) => migrationPattern.exec(filename))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number.parseInt(match[1] ?? "0", 10));

  return (versions.length === 0 ? 0 : Math.max(...versions)) + 1;
}

async function run(): Promise<void> {
  const requestedName = process.argv.slice(2).join(" ");
  const slug = toSlug(requestedName);

  if (!slug) {
    throw new Error("Provide a migration name, for example: npm run migrate:create -- add order notes");
  }

  const version = await nextVersion();
  const filename = `${String(version).padStart(3, "0")}_${slug}.sql`;
  const targetPath = path.join(migrationDir, filename);
  const template = `-- ${slug.replace(/_/g, " ")}
-- Write forward-only SQL here. Applied migrations are tracked and checksummed.

`;

  await writeFile(targetPath, template, "utf8");
  console.log(`Created migration ${filename}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
