import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync as SQLiteDatabase } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll } from "vitest";
import { nativePostgresUrl } from "../testing/postgres-native";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

function applyMigration(sqlite: SQLiteDatabase, name: string): void {
  const sql = readMigration(name);
  const statements = sql.split("--> statement-breakpoint");
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (trimmed) sqlite.prepare(trimmed).run();
  }
}

function exec(sqlite: SQLiteDatabase, sql: string): void {
  sqlite.prepare(sql).run();
}

function createPre0191SchemaDatabase(): SQLiteDatabase {
  const sqlite = new SQLiteDatabase(":memory:");
  exec(sqlite, "CREATE TABLE categories (id text PRIMARY KEY)");
  exec(sqlite, "CREATE TABLE tax_classes (id text PRIMARY KEY)");
  exec(sqlite, "CREATE TABLE brands (id text PRIMARY KEY)");
  exec(sqlite, "CREATE TABLE warranty_policies (id text PRIMARY KEY)");
  exec(sqlite, "CREATE TABLE shipping_profiles (id text PRIMARY KEY)");
  exec(sqlite, "CREATE TABLE product_media (id text PRIMARY KEY)");
  exec(sqlite, `CREATE TABLE products (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_minor integer NOT NULL DEFAULT 0,
    category_id text REFERENCES categories(id) ON DELETE set null,
    slug text NOT NULL UNIQUE,
    is_active integer NOT NULL DEFAULT 1,
    deleted_at integer,
    created_at integer NOT NULL DEFAULT (unixepoch()),
    updated_at integer NOT NULL DEFAULT (unixepoch()),
    discount_bps integer NOT NULL DEFAULT 0,
    discount_type text DEFAULT 'percentage',
    discount_amount_minor integer NOT NULL DEFAULT 0,
    free_delivery integer NOT NULL DEFAULT 0,
    tax_class_id text REFERENCES tax_classes(id) ON DELETE set null,
    tax_classification_version integer NOT NULL DEFAULT 1,
    is_gift_card integer NOT NULL DEFAULT 0,
    customization_schema text,
    brand_id text REFERENCES brands(id) ON DELETE set null,
    page_template text,
    emi_eligible integer NOT NULL DEFAULT 1,
    warranty_policy_id text REFERENCES warranty_policies(id) ON DELETE set null,
    shipping_profile_id text REFERENCES shipping_profiles(id) ON DELETE set null,
    CHECK (is_gift_card IN (0, 1)),
    CHECK (is_active IN (0, 1)),
    CHECK (emi_eligible IN (0, 1))
  )`);
  exec(sqlite, `CREATE TABLE orders (
    id text PRIMARY KEY,
    total_amount_minor integer NOT NULL DEFAULT 0,
    paid_amount_minor integer NOT NULL DEFAULT 0,
    balance_due_minor integer NOT NULL DEFAULT 0,
    currency_code text NOT NULL,
    currency_decimal_places integer NOT NULL,
    version integer NOT NULL DEFAULT 1
  )`);
  exec(sqlite, `CREATE TABLE payment_plans (
    id text PRIMARY KEY,
    order_id text NOT NULL REFERENCES orders(id) ON DELETE cascade UNIQUE,
    total_amount_minor integer NOT NULL DEFAULT 0,
    deposit_amount_minor integer NOT NULL DEFAULT 0,
    balance_due_minor integer NOT NULL DEFAULT 0,
    deposit_paid_at integer,
    balance_paid_at integer,
    balance_due_date text,
    status text NOT NULL DEFAULT 'pending',
    kind text NOT NULL DEFAULT 'online',
    instructions text,
    percent integer,
    contact_snapshot text,
    cancelled_at integer,
    created_at integer NOT NULL DEFAULT (unixepoch()),
    updated_at integer NOT NULL DEFAULT (unixepoch()),
    CHECK (kind IN ('online', 'manual')),
    CHECK ((percent IS NULL) OR (percent BETWEEN 1 AND 99))
  )`);
  exec(sqlite, `CREATE TABLE checkout_authority (
    id text PRIMARY KEY DEFAULT 'default',
    revision integer NOT NULL DEFAULT 1,
    updated_at integer NOT NULL DEFAULT (unixepoch()),
    CHECK (id = 'default'),
    CHECK (revision >= 1)
  )`);
  exec(sqlite, "INSERT INTO checkout_authority (id, revision, updated_at) VALUES ('default', 1, (unixepoch()))");
  exec(sqlite, `CREATE TABLE scalius_schema_migrations (
    version integer PRIMARY KEY,
    name text NOT NULL UNIQUE,
    source_sha256 text NOT NULL,
    applied_at integer NOT NULL DEFAULT (unixepoch())
  )`);
  exec(sqlite, "INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (190, '0190_striped_puppet_master', '0000000000000000000000000000000000000000000000000000000000000000')");
  return sqlite;
}

/**
 * The production product fence, as installed by 0048 and recreated by 0084.
 * 0192 only adds the deposit policy to the fenced product writes, so the
 * fixture recreates the legacy triggers: the checkout authority must be
 * bumped exactly once per product write, never twice.
 */
function createLegacyCheckoutAuthorityTriggers(sqlite: SQLiteDatabase): void {
  exec(sqlite, `CREATE TRIGGER products_checkout_authority_insert
    AFTER INSERT ON products
    BEGIN
      UPDATE checkout_authority SET revision = revision + 1, updated_at = unixepoch() WHERE id = 'default';
    END;`);
  exec(sqlite, `CREATE TRIGGER products_checkout_authority_update
    AFTER UPDATE ON products
    WHEN NEW.name IS NOT OLD.name
      OR NEW.price_minor IS NOT OLD.price_minor
      OR NEW.category_id IS NOT OLD.category_id
      OR NEW.deleted_at IS NOT OLD.deleted_at
      OR NEW.is_active IS NOT OLD.is_active
      OR NEW.discount_bps IS NOT OLD.discount_bps
      OR NEW.discount_type IS NOT OLD.discount_type
      OR NEW.discount_amount_minor IS NOT OLD.discount_amount_minor
      OR NEW.free_delivery IS NOT OLD.free_delivery
      OR NEW.tax_class_id IS NOT OLD.tax_class_id
      OR NEW.tax_classification_version IS NOT OLD.tax_classification_version
      OR NEW.is_gift_card IS NOT OLD.is_gift_card
      OR NEW.customization_schema IS NOT OLD.customization_schema
    BEGIN
      UPDATE checkout_authority SET revision = revision + 1, updated_at = unixepoch() WHERE id = 'default';
    END;`);
  exec(sqlite, `CREATE TRIGGER products_checkout_authority_delete
    AFTER DELETE ON products
    BEGIN
      UPDATE checkout_authority SET revision = revision + 1, updated_at = unixepoch() WHERE id = 'default';
    END;`);
}

describe("migration 0191_product_cod_deposit_policy", () => {
  it("adds cod_deposit_policy column with default 'inherit' to existing products", () => {
    const sqlite = createPre0191SchemaDatabase();
    exec(sqlite, "INSERT INTO products (id, name, price_minor, slug, is_active) VALUES ('prod_1', 'Test Product', 10000, 'test-product', 1)");

    applyMigration(sqlite, "0191_product_cod_deposit_policy.sql");

    const row = sqlite
      .prepare("SELECT cod_deposit_policy FROM products WHERE id = 'prod_1'")
      .get() as Record<string, string>;
    expect(row.cod_deposit_policy).toBe("inherit");

    const info = sqlite.prepare("PRAGMA table_info(products)").all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const col = info.find((c) => c.name === "cod_deposit_policy");
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(1);
    expect(col!.dflt_value).toBe("'inherit'");
  });

  it("rejects invalid cod_deposit_policy values", () => {
    const sqlite = createPre0191SchemaDatabase();
    applyMigration(sqlite, "0191_product_cod_deposit_policy.sql");

    exec(sqlite, "INSERT INTO products (id, name, price_minor, slug, cod_deposit_policy, is_active) VALUES ('prod_valid', 'Valid', 10000, 'valid', 'inherit', 1)");

    // SQLite and PostgreSQL enforce the CHECK constraint on new inserts.
    expect(() => {
      exec(sqlite, "INSERT INTO products (id, name, price_minor, slug, cod_deposit_policy, is_active) VALUES ('prod_bad', 'Bad', 10000, 'bad', 'invalid_policy', 1)");
    }).toThrow();
  });

  it("rejects null cod_deposit_policy", () => {
    const sqlite = createPre0191SchemaDatabase();
    applyMigration(sqlite, "0191_product_cod_deposit_policy.sql");

    // NOT NULL is enforced by SQLite even on ALTER TABLE ADD COLUMN.
    expect(() => {
      exec(sqlite, "INSERT INTO products (id, name, price_minor, slug, cod_deposit_policy, is_active) VALUES ('prod_null', 'Null', 10000, 'null', NULL, 1)");
    }).toThrow();
  });

  it("accepts valid cod_deposit_policy values", () => {
    const sqlite = createPre0191SchemaDatabase();
    applyMigration(sqlite, "0191_product_cod_deposit_policy.sql");

    exec(sqlite, "INSERT INTO products (id, name, price_minor, slug, cod_deposit_policy, is_active) VALUES ('p1', 'P1', 10000, 'p1', 'required', 1), ('p2', 'P2', 20000, 'p2', 'exempt', 1), ('p3', 'P3', 30000, 'p3', 'inherit', 1)");

    const rows = sqlite.prepare("SELECT id, cod_deposit_policy FROM products ORDER BY id").all() as Array<{ id: string; cod_deposit_policy: string }>;
    expect(rows).toEqual([
      { id: "p1", cod_deposit_policy: "required" },
      { id: "p2", cod_deposit_policy: "exempt" },
      { id: "p3", cod_deposit_policy: "inherit" },
    ]);
  });
});

describe("migration 0192_product_checkout_authority_fence", () => {
  it("adds a single deposit policy trigger to the product fence", () => {
    const sqlite = createPre0191SchemaDatabase();
    applyMigration(sqlite, "0191_product_cod_deposit_policy.sql");
    applyMigration(sqlite, "0192_product_checkout_authority_fence.sql");

    // The legacy fence (0048, 0084) already watches every price-relevant
    // product write. 0192 adds the deposit policy to that fence, so it must
    // not add a second set of product triggers: a duplicate trigger bumps the
    // checkout authority twice for one write.
    const triggers = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'products' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(triggers.map((trigger) => trigger.name)).toEqual([
      "products_cod_deposit_policy_checkout_authority_update",
    ]);
  });

  it("bumps the checkout authority once per product write next to the legacy fence", () => {
    const sqlite = createPre0191SchemaDatabase();
    createLegacyCheckoutAuthorityTriggers(sqlite);
    applyMigration(sqlite, "0191_product_cod_deposit_policy.sql");
    applyMigration(sqlite, "0192_product_checkout_authority_fence.sql");

    const revision = () =>
      (sqlite.prepare("SELECT revision FROM checkout_authority WHERE id='default'").get() as Record<string, number>).revision;
    expect(revision()).toBe(1);

    // The legacy insert trigger fences the insert: one bump.
    exec(sqlite, "INSERT INTO products (id, name, price_minor, slug, is_active) VALUES ('p1', 'P1', 10000, 'p1', 1)");
    expect(revision()).toBe(2);

    // A fenced column change bumps once through the legacy trigger.
    exec(sqlite, "UPDATE products SET price_minor = 11000 WHERE id = 'p1'");
    expect(revision()).toBe(3);

    // A column the fence does not watch leaves the revision alone.
    exec(sqlite, "UPDATE products SET page_template = 'grid' WHERE id = 'p1'");
    expect(revision()).toBe(3);

    // The deposit policy is fenced by 0192 alone: one bump, never two.
    exec(sqlite, "UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p1'");
    expect(revision()).toBe(4);

    exec(sqlite, "UPDATE products SET cod_deposit_policy = 'exempt' WHERE id = 'p1'");
    expect(revision()).toBe(5);

    // The legacy delete trigger fences the delete: one bump.
    exec(sqlite, "DELETE FROM products WHERE id = 'p1'");
    expect(revision()).toBe(6);
  });

  it("does not bump revision on unrelated table changes", () => {
    const sqlite = createPre0191SchemaDatabase();
    applyMigration(sqlite, "0191_product_cod_deposit_policy.sql");
    applyMigration(sqlite, "0192_product_checkout_authority_fence.sql");

    // Insert an order (unrelated table) should not bump checkout_authority
    exec(sqlite, "INSERT INTO orders (id, total_amount_minor, paid_amount_minor, balance_due_minor, currency_code, currency_decimal_places) VALUES ('o1', 10000, 0, 10000, 'BDT', 2)");
    const rev = sqlite.prepare("SELECT revision FROM checkout_authority WHERE id='default'").get() as Record<string, number>;
    expect(rev.revision).toBe(1);
  });
});

describe("migration 0193_payment_plan_cod_deposit_snapshot", () => {
  it("adds qualifying_merchandise_minor and qualifying_product_ids columns", () => {
    const sqlite = createPre0191SchemaDatabase();
    applyMigration(sqlite, "0191_product_cod_deposit_policy.sql");
    applyMigration(sqlite, "0192_product_checkout_authority_fence.sql");
    applyMigration(sqlite, "0193_payment_plan_cod_deposit_snapshot.sql");

    exec(sqlite, "INSERT INTO orders (id, total_amount_minor, paid_amount_minor, balance_due_minor, currency_code, currency_decimal_places) VALUES ('o1', 10000, 0, 10000, 'BDT', 2)");
    exec(sqlite, "INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor, balance_due_minor, kind, status, qualifying_merchandise_minor, qualifying_product_ids, created_at, updated_at) VALUES ('plan_1', 'o1', 10000, 2000, 8000, 'manual', 'pending', 5000, '[\"prod_1\"]', 1780000000, 1780000000)");

    const row = sqlite
      .prepare("SELECT qualifying_merchandise_minor, qualifying_product_ids FROM payment_plans WHERE id = 'plan_1'")
      .get() as Record<string, unknown>;
    expect(row.qualifying_merchandise_minor).toBe(5000);
    expect(row.qualifying_product_ids).toBe('["prod_1"]');
  });

  it("qualifying_merchandise_minor defaults to 0 and qualifying_product_ids defaults to NULL", () => {
    const sqlite = createPre0191SchemaDatabase();
    applyMigration(sqlite, "0191_product_cod_deposit_policy.sql");
    applyMigration(sqlite, "0192_product_checkout_authority_fence.sql");
    applyMigration(sqlite, "0193_payment_plan_cod_deposit_snapshot.sql");

    exec(sqlite, "INSERT INTO orders (id, total_amount_minor, paid_amount_minor, balance_due_minor, currency_code, currency_decimal_places) VALUES ('o2', 10000, 0, 10000, 'BDT', 2)");
    exec(sqlite, "INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor, balance_due_minor, kind, status, created_at, updated_at) VALUES ('plan_2', 'o2', 10000, 0, 10000, 'online', 'pending', 1780000000, 1780000000)");

    const row = sqlite
      .prepare("SELECT qualifying_merchandise_minor, qualifying_product_ids FROM payment_plans WHERE id = 'plan_2'")
      .get() as Record<string, unknown>;
    expect(row.qualifying_merchandise_minor).toBe(0);
    expect(row.qualifying_product_ids).toBe(null);
  });

  it("rejects negative qualifying_merchandise_minor", () => {
    const sqlite = createPre0191SchemaDatabase();
    applyMigration(sqlite, "0191_product_cod_deposit_policy.sql");
    applyMigration(sqlite, "0192_product_checkout_authority_fence.sql");
    applyMigration(sqlite, "0193_payment_plan_cod_deposit_snapshot.sql");

    exec(sqlite, "INSERT INTO orders (id, total_amount_minor, paid_amount_minor, balance_due_minor, currency_code, currency_decimal_places) VALUES ('o3', 10000, 0, 10000, 'BDT', 2)");

    // SQLite enforces CHECK constraints on ALTER TABLE ADD COLUMN (SQLite 3.38+).
    // Constraint enforcement is verified on both SQLite and PostgreSQL.
    expect(() => {
      exec(sqlite, "INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor, balance_due_minor, kind, status, qualifying_merchandise_minor, created_at, updated_at) VALUES ('plan_neg', 'o3', 10000, 0, 10000, 'manual', 'pending', -1, 1780000000, 1780000000)");
    }).toThrow();
  });
});

describe.skipIf(!nativePostgresUrl())("migrations 0191-0193 PostgreSQL", () => {
  const client = new Client({ connectionString: nativePostgresUrl() });

  beforeAll(async () => {
    await client.connect();
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS scalius_compat;
      CREATE TEMP TABLE products (
        id text PRIMARY KEY,
        name text NOT NULL,
        slug text NOT NULL UNIQUE,
        is_active boolean NOT NULL DEFAULT true,
        price_minor bigint NOT NULL DEFAULT 0,
        category_id text,
        deleted_at bigint,
        discount_bps integer NOT NULL DEFAULT 0,
        discount_type text,
        discount_amount_minor bigint NOT NULL DEFAULT 0,
        free_delivery boolean NOT NULL DEFAULT false,
        tax_class_id text,
        tax_classification_version integer NOT NULL DEFAULT 1,
        is_gift_card boolean NOT NULL DEFAULT false,
        customization_schema text,
        brand_id text,
        page_template text
      );
      CREATE TEMP TABLE orders (id text PRIMARY KEY);
      CREATE TEMP TABLE payment_plans (id text PRIMARY KEY, order_id text REFERENCES orders(id), kind text NOT NULL DEFAULT 'online', status text NOT NULL DEFAULT 'pending');
      CREATE TEMP TABLE checkout_authority (id text PRIMARY KEY DEFAULT 'default', revision integer NOT NULL DEFAULT 1, updated_at bigint NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()));
      CREATE TEMP TABLE scalius_schema_migrations (version integer PRIMARY KEY, name text, source_sha256 text);
      INSERT INTO checkout_authority (id, revision) VALUES ('default', 1);
      CREATE OR REPLACE FUNCTION scalius_compat."products_checkout_authority_insert_fn"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $trigger_function$
      BEGIN
        UPDATE "checkout_authority" SET "revision" = "revision" + 1, "updated_at" = EXTRACT(EPOCH FROM NOW())::bigint WHERE "id" = 'default';
        RETURN NEW;
      END
      $trigger_function$;
      CREATE TRIGGER products_checkout_authority_insert
      AFTER INSERT ON products
      FOR EACH ROW EXECUTE FUNCTION scalius_compat."products_checkout_authority_insert_fn"();
      CREATE OR REPLACE FUNCTION scalius_compat."products_checkout_authority_update_fn"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $trigger_function$
      BEGIN
        IF NOT coalesce((NEW."name" IS DISTINCT FROM OLD."name"
          OR NEW."price_minor" IS DISTINCT FROM OLD."price_minor"
          OR NEW."category_id" IS DISTINCT FROM OLD."category_id"
          OR NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
          OR NEW."is_active" IS DISTINCT FROM OLD."is_active"
          OR NEW."discount_bps" IS DISTINCT FROM OLD."discount_bps"
          OR NEW."discount_type" IS DISTINCT FROM OLD."discount_type"
          OR NEW."discount_amount_minor" IS DISTINCT FROM OLD."discount_amount_minor"
          OR NEW."free_delivery" IS DISTINCT FROM OLD."free_delivery"
          OR NEW."tax_class_id" IS DISTINCT FROM OLD."tax_class_id"
          OR NEW."tax_classification_version" IS DISTINCT FROM OLD."tax_classification_version"
          OR NEW."is_gift_card" IS DISTINCT FROM OLD."is_gift_card"
          OR NEW."customization_schema" IS DISTINCT FROM OLD."customization_schema"), false) THEN
          RETURN NEW;
        END IF;
        UPDATE "checkout_authority" SET "revision" = "revision" + 1, "updated_at" = EXTRACT(EPOCH FROM NOW())::bigint WHERE "id" = 'default';
        RETURN NEW;
      END
      $trigger_function$;
      CREATE TRIGGER products_checkout_authority_update
      AFTER UPDATE ON products
      FOR EACH ROW EXECUTE FUNCTION scalius_compat."products_checkout_authority_update_fn"();
    `);
    for (const file of ["0191_product_cod_deposit_policy.sql", "0192_product_checkout_authority_fence.sql", "0193_payment_plan_cod_deposit_snapshot.sql"]) {
      const migration = readFileSync(join(__dirname, "..", "..", "migrations", "postgres", file), "utf8");
      await client.query(migration);
    }
  });
  afterAll(() => client.end());

  it("adds cod_deposit_policy column to products", async () => {
    const result = await client.query(
      "SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()) AND table_name = 'products' AND column_name = 'cod_deposit_policy'",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].column_name).toBe("cod_deposit_policy");
    expect(result.rows[0].is_nullable).toBe("NO");
    expect(result.rows[0].column_default).toBe("'inherit'::text");
  });

  it("adds qualifying columns to payment_plans", async () => {
    const result = await client.query(
      "SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()) AND table_name = 'payment_plans' AND column_name IN ('qualifying_merchandise_minor', 'qualifying_product_ids') ORDER BY column_name",
    );
    expect(result.rows).toHaveLength(2);
    const qm = result.rows.find((r) => r.column_name === "qualifying_merchandise_minor");
    expect(qm.is_nullable).toBe("NO");
    expect(qm.column_default).toBe("0");
    const qp = result.rows.find((r) => r.column_name === "qualifying_product_ids");
    expect(qp.is_nullable).toBe("YES");
  });

  it("enforces cod_deposit_policy check constraint", async () => {
    await client.query("INSERT INTO products (id, name, slug, cod_deposit_policy) VALUES ('p1', 'P1', 'p1', 'inherit')");
    await expect(
      client.query("INSERT INTO products (id, name, slug, cod_deposit_policy) VALUES ('p2', 'P2', 'p2', 'invalid')"),
    ).rejects.toMatchObject({ constraint: "products_cod_deposit_policy_check" });
  });

  it("bumps the checkout authority once per product write next to the legacy fence", async () => {
    const readRevision = async () => {
      const result = await client.query("SELECT revision FROM checkout_authority WHERE id = 'default'");
      return Number(result.rows[0].revision);
    };
    const startRevision = await readRevision();

    // The legacy product insert fence bumps the revision once.
    await client.query("INSERT INTO products (id, name, slug) VALUES ('p_fence', 'Fence', 'p_fence')");
    expect(await readRevision()).toBe(startRevision + 1);

    // A price change is fenced by the legacy update trigger, once.
    await client.query("UPDATE products SET price_minor = 500 WHERE id = 'p_fence'");
    expect(await readRevision()).toBe(startRevision + 2);

    // A column the legacy fence does not watch leaves the revision alone.
    await client.query("UPDATE products SET page_template = 'grid' WHERE id = 'p_fence'");
    expect(await readRevision()).toBe(startRevision + 2);

    // The deposit policy change bumps the revision exactly once.
    await client.query("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_fence'");
    expect(await readRevision()).toBe(startRevision + 3);

    // Changing the policy back bumps it once more, never twice.
    await client.query("UPDATE products SET cod_deposit_policy = 'inherit' WHERE id = 'p_fence'");
    expect(await readRevision()).toBe(startRevision + 4);
  });

  it("stores the deposit snapshot money columns as 64 bit integers", async () => {
    const result = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()) AND table_name = 'payment_plans' AND column_name IN ('qualifying_merchandise_minor', 'cod_deposit_amount') ORDER BY column_name",
    );
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      expect(row.data_type).toBe("bigint");
    }
  });

  it("adds cod_deposit_amount with a non-negative default", async () => {
    const result = await client.query(
      "SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()) AND table_name = 'payment_plans' AND column_name = 'cod_deposit_amount'",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].column_name).toBe("cod_deposit_amount");
    expect(result.rows[0].is_nullable).toBe("NO");
    expect(result.rows[0].column_default).toBe("0");
  });

  it("rejects negative deposit snapshots on PostgreSQL", async () => {
    await client.query("INSERT INTO orders (id) VALUES ('o_pg_snapshot')");
    await client.query(
      "INSERT INTO payment_plans (id, order_id, kind, status, cod_deposit_amount) VALUES ('plan_pg_snapshot', 'o_pg_snapshot', 'manual', 'pending', 5000)",
    );

    const stored = await client.query(
      "SELECT cod_deposit_amount, qualifying_merchandise_minor FROM payment_plans WHERE id = 'plan_pg_snapshot'",
    );
    // PostgreSQL returns 64 bit integers as strings.
    expect(Number(stored.rows[0].cod_deposit_amount)).toBe(5000);
    expect(Number(stored.rows[0].qualifying_merchandise_minor)).toBe(0);

    await expect(
      client.query(
        "INSERT INTO payment_plans (id, order_id, kind, status, cod_deposit_amount) VALUES ('plan_pg_negative', 'o_pg_snapshot', 'manual', 'pending', -1)",
      ),
    ).rejects.toThrow();

    await expect(
      client.query(
        "INSERT INTO payment_plans (id, order_id, kind, status, qualifying_merchandise_minor) VALUES ('plan_pg_negative_basis', 'o_pg_snapshot', 'manual', 'pending', -1)",
      ),
    ).rejects.toThrow();
  });
});
