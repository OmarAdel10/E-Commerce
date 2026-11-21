#!/usr/bin/env node
/**
 * Manually provision the local D1 SQLite database for E2E testing.
 * Creates the database at the path Wrangler expects, applies all needed
 * migrations, and records them in scalius_schema_migrations.
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
  existingFiles = readdirSync(DB_DIR).filter(function(f) { return f.endsWith(".sqlite"); });
} catch (e) {}
const DB_FILE = join(DB_DIR, existingFiles[0] || "local-" + createHash("md5").update(Date.now().toString()).digest("hex").slice(0,16) + ".sqlite");

async function main() {
  const db = new DatabaseSync(DB_FILE);

  // Performance pragmas
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = OFF;");

  // Create migrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS scalius_schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      applied_at INTEGER DEFAULT (cast(strftime('%s','now') as int)) NOT NULL
    );
  `);

  // Get already applied migrations
  var appliedRows = db.prepare("SELECT version FROM scalius_schema_migrations").all();
  var applied = new Set();
  for (var i = 0; i < appliedRows.length; i++) {
    applied.add(appliedRows[i].version);
  }

  var files = readdirSync(MIGRATIONS_DIR).filter(function(f) { return f.endsWith(".sql") && !f.includes("/postgres/"); }).sort();

  var appliedCount = 0;
  var skippedCount = 0;
  var errorCount = 0;

  for (var fi = 0; fi < files.length; fi++) {
    var file = files[fi];
    var version = parseInt(file.match(/^(\d+)/)[1], 10);

    if (applied.has(version)) {
      skippedCount++;
      continue;
    }

    try {
      var sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      var statements = sql.split("--> statement-breakpoint");

      db.exec("BEGIN TRANSACTION;");
      try {
        for (var si = 0; si < statements.length; si++) {
          var trimmed = statements[si].trim();
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
      console.error("  ERROR v" + version + " " + file + ": " + e.message.substring(0, 150));
    }
  }

  // Report final state
  var count = db.prepare("SELECT COUNT(*) as c FROM scalius_schema_migrations").get();
  var maxVer = db.prepare("SELECT MAX(version) as v FROM scalius_schema_migrations").get();
  console.log("Done: " + appliedCount + " applied, " + skippedCount + " skipped, " + errorCount + " errors. Total: " + count.c + ", Max version: " + maxVer.v);

  // Verify key tables
  var tables = ["categories", "products", "payment_plans", "settings", "checkout_authority", "product_variants", "orders", "delivery_zones"];
  for (var ti = 0; ti < tables.length; ti++) {
    var t = tables[ti];
    var exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
    console.log(exists ? "OK  " : "MISS", t);
  }

  // Check key columns
  var productsCols = db.prepare("SELECT name FROM pragma_table_info('products')").all().map(function(r) { return r.name; });
  console.log("Products has cod_deposit_policy:", productsCols.includes("cod_deposit_policy"));

  var plansCols = db.prepare("SELECT name FROM pragma_table_info('payment_plans')").all().map(function(r) { return r.name; });
  console.log("Payment plans has cod_deposit_amount:", plansCols.includes("cod_deposit_amount"));
  console.log("Payment plans has qualifying_merchandise_minor:", plansCols.includes("qualifying_merchandise_minor"));

  var settingsCols = db.prepare("SELECT name FROM pragma_table_info('settings')").all().map(function(r) { return r.name; });
  console.log("Settings has revision:", settingsCols.includes("revision"));

  db.close();
  console.log("Database file:", DB_FILE);
}

main().catch(function(e) {
  console.error("Fatal:", e);
  process.exit(1);
});
