#!/usr/bin/env node
/**
 * Apply D1 migrations in small batches.
 * Migration files contain their own INSERT into scalius_schema_migrations,
 * so we just execute the SQL and track what succeeded.
 * Usage: node scripts/apply-migrations-v2.js <start-version> <end-version>
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

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

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = OFF;");

  // Ensure migrations table exists
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

      db.exec("BEGIN TRANSACTION;");
      try {
        for (const stmt of statements) {
          const trimmed = stmt.trim();
          if (trimmed) {
            db.exec(trimmed);
          }
        }
        db.exec("COMMIT;");
        appliedCount++;
      } catch (e) {
        db.exec("ROLLBACK;");
        throw e;
      }
    } catch (e) {
      errorCount++;
      console.error(`  ERROR v${version} ${file}: ${e.message.substring(0, 150)}`);
    }
  }

  // Report final state
  const finalCount = db
    .prepare("SELECT COUNT(*) as c FROM scalius_schema_migrations")
    .get();
  const maxVer = db
    .prepare("SELECT MAX(version) as v FROM scalius_schema_migrations")
    .get();
  console.log(
    `Batch ${startVersion}-${endVersion}: ${appliedCount} applied, ${skippedCount} skipped, ${errorCount} errors. Total in DB: ${finalCount.c}, Max version: ${maxVer.v}`
  );

  db.close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
