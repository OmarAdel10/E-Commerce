#!/usr/bin/env node
/**
 * Apply D1 migrations in small batches.
 * Usage: node scripts/apply-migrations-batch.js <start-version> <end-version>
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const DB_DIR = join(process.cwd(), ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const MIGRATIONS_DIR = join(process.cwd(), "packages/database/migrations");

let existingFiles = [];
try {
  existingFiles = readdirSync(DB_DIR).filter((f) => f.endsWith(".sqlite"));
} catch {}
const DB_FILE = join(DB_DIR, existingFiles[0] || "local-e2e-database.sqlite");

const startVersion = parseInt(process.argv[2], 10) || 0;
const endVersion = parseInt(process.argv[3], 10) || 999999;

async function main() {
  const db = new DatabaseSync(DB_FILE);

  db.exec(`
    CREATE TABLE IF NOT EXISTS scalius_schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      applied_at INTEGER DEFAULT (cast(strftime('%s','now') as int)) NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM scalius_schema_migrations")
      .all()
      .map((r) => r.version)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !f.includes("/postgres/"))
    .sort();

  let appliedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const version = parseInt(file.match(/^(\d+)/)[1], 10);

    if (version < startVersion || version > endVersion) continue;
    if (applied.has(version)) {
      skippedCount++;
      continue;
    }

    try {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const statements = sql.split("--> statement-breakpoint");

      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (trimmed) {
          db.exec(trimmed);
        }
      }

      const sha = createHash("sha256").update(sql).digest("hex");
      db.prepare(
        "INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (?, ?, ?)"
      ).run(version, file.replace(".sql", ""), sha);

      appliedCount++;
    } catch (e) {
      errorCount++;
      console.error(`ERROR applying ${file}: ${e.message.substring(0, 200)}`);
    }
  }

  console.log(
    `Batch ${startVersion}-${endVersion}: ${appliedCount} applied, ${skippedCount} skipped, ${errorCount} errors`
  );

  db.close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
