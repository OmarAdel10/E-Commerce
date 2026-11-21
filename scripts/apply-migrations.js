#!/usr/bin/env node
/**
 * Apply D1 migrations to a local SQLite database in small batches.
 * Used to provision the E2E test database.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const DB_DIR = join(process.cwd(), ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const MIGRATIONS_DIR = join(process.cwd(), "packages/database/migrations");

// Find or create the sqlite file
let existingFiles = [];
try {
  existingFiles = readdirSync(DB_DIR).filter((f) => f.endsWith(".sqlite"));
} catch {
  // Directory doesn't exist yet
}
const DB_FILE = join(DB_DIR, existingFiles[0] || "local-e2e-database.sqlite");

async function main() {
  const db = new DatabaseSync(DB_FILE);

  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS scalius_schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      applied_at INTEGER DEFAULT (cast(strftime('%s','now') as int)) NOT NULL
    );
  `);

  // Get already applied migrations
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

      // Compute sha256 of migration content
      const sha = createHash("sha256").update(sql).digest("hex");
      db.prepare(
        "INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (?, ?, ?)"
      ).run(version, file.replace(".sql", ""), sha);

      appliedCount++;
      if (appliedCount % 25 === 0) {
        console.log(`Applied ${appliedCount} migrations so far...`);
      }
    } catch (e) {
      errorCount++;
      console.error(`ERROR applying ${file}: ${e.message.substring(0, 200)}`);
    }
  }

  console.log(`\nDone: ${appliedCount} applied, ${skippedCount} skipped, ${errorCount} errors`);

  // Verify key tables
  const tables = [
    "categories",
    "products",
    "payment_plans",
    "settings",
    "checkout_authority",
    "product_variants",
    "orders",
    "delivery_zones",
  ];
  for (const t of tables) {
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(t);
    console.log(exists ? "OK  " : "MISS", t);
  }

  // Check key columns
  const productsCols = db
    .prepare("SELECT name FROM pragma_table_info('products')")
    .all()
    .map((r) => r.name);
  console.log("Products has cod_deposit_policy:", productsCols.includes("cod_deposit_policy"));

  const plansCols = db
    .prepare("SELECT name FROM pragma_table_info('payment_plans')")
    .all()
    .map((r) => r.name);
  console.log("Payment plans has cod_deposit_amount:", plansCols.includes("cod_deposit_amount"));
  console.log(
    "Payment plans has qualifying_merchandise_minor:",
    plansCols.includes("qualifying_merchandise_minor")
  );

  // Check settings rows
  const settingsCount = db.prepare("SELECT COUNT(*) as c FROM settings").get();
  console.log("Settings rows:", settingsCount.c);

  db.close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
