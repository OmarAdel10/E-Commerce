import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nativePostgresUrl } from "../testing/postgres-native";

describe.skipIf(!nativePostgresUrl())("manual COD PostgreSQL migration SQL", () => {
  const client = new Client({ connectionString: nativePostgresUrl() });

  beforeAll(async () => {
    await client.connect();
    // Migration inputs only. Temp tables keep this suite isolated from
    // other tests on the same disposable PostgreSQL server.
    await client.query(`
      CREATE TEMP TABLE payment_plans (id text PRIMARY KEY);
      CREATE TEMP TABLE orders (id text PRIMARY KEY);
      CREATE TEMP TABLE scalius_schema_migrations (version integer PRIMARY KEY, name text, source_sha256 text);
      INSERT INTO payment_plans (id) VALUES ('online-plan');
      INSERT INTO orders (id) VALUES ('legacy-order');
    `);
    for (const file of ["0189_magical_lucky_pierre.sql", "0190_striped_puppet_master.sql"]) {
      const migration = await readFile(new URL(`../../migrations/postgres/${file}`, import.meta.url), "utf8");
      await client.query(migration);
    }
  });
  afterAll(() => client.end());

  it("preserves old plans and adds nullable inventory recovery state", async () => {
    const plan = await client.query("SELECT kind, instructions, percent, contact_snapshot, cancelled_at FROM payment_plans");
    expect(plan.rows).toEqual([{ kind: "online", instructions: null, percent: null, contact_snapshot: null, cancelled_at: null }]);
    const order = await client.query("SELECT last_inventory_failure_at FROM orders WHERE id='legacy-order'");
    expect(order.rows).toEqual([{ last_inventory_failure_at: null }]);
    const ledger = await client.query("SELECT version FROM scalius_schema_migrations ORDER BY version");
    expect(ledger.rows).toEqual([{ version: 189 }, { version: 190 }]);
  });

  it("enforces the manual plan kind and percentage boundaries", async () => {
    await client.query("INSERT INTO payment_plans (id, kind, percent) VALUES ('first', 'manual', 1), ('last', 'manual', 99)");
    await expect(client.query("INSERT INTO payment_plans (id, kind, percent) VALUES ('invalid', 'manual', 100)"))
      .rejects.toMatchObject({ constraint: "payment_plans_percent_range" });
    await expect(client.query("INSERT INTO payment_plans (id, kind) VALUES ('invalid', 'unknown')"))
      .rejects.toMatchObject({ constraint: "payment_plans_kind_check" });
  });
});
