/**
 * Migration runner — 执行 packages/db/drizzle/*.sql（按文件名序，一次性事务）。
 * 幂等：已在 schema_migrations 登记的跳过。
 * 用法: pnpm --filter @kidboard/db migrate:sql
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import "dotenv/config";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "drizzle");

const url =
  process.env.DATABASE_URL ??
  "postgresql://kidboard:kidboard@localhost:5432/kidboard";

const sql = postgres(url, { max: 1 });

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const applied = new Set(
    (await sql`SELECT name FROM schema_migrations`).map((r) => r.name as string),
  );
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const content = await readFile(join(migrationsDir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    console.warn(`applied: ${file}`);
  }
  console.warn("migrations complete");
  await sql.end();
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
