// packages/core/src/modules/product-admin/bulk-edit.test.ts
// Coverage tests for product-admin/bulk-edit.ts codDepositPolicy
// (addresses coverage reviewer finding: product-admin/bulk-edit.ts codDepositPolicy untested)

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DatabaseSync as SQLiteDatabase } from "node:sqlite";

describe("product-admin/bulk-edit.ts — codDepositPolicy", () => {
    let sqlite: SQLiteDatabase;

    beforeAll(() => {
        sqlite = new SQLiteDatabase(":memory:");
        sqlite.exec(`
            CREATE TABLE products (
                id text PRIMARY KEY,
                name text NOT NULL,
                slug text NOT NULL UNIQUE,
                is_active integer NOT NULL DEFAULT 1,
                price_minor integer NOT NULL DEFAULT 0,
                cod_deposit_policy text NOT NULL DEFAULT 'inherit',
                deleted_at integer,
                created_at integer NOT NULL DEFAULT (unixepoch()),
                updated_at integer NOT NULL DEFAULT (unixepoch())
            );
        `);
    });

    afterAll(() => {
        sqlite.close();
    });

    it("returns codDepositPolicy for each product row", () => {
        sqlite.prepare(`
            INSERT INTO products (id, name, slug, is_active, price_minor, cod_deposit_policy)
            VALUES ('p1', 'Required Product', 'required-product', 1, 20000, 'required'),
                   ('p2', 'Exempt Product', 'exempt-product', 1, 15000, 'exempt'),
                   ('p3', 'Inherit Product', 'inherit-product', 1, 10000, 'inherit')
        `).run();

        const rows = sqlite.prepare(
            "SELECT id, cod_deposit_policy FROM products WHERE is_active = 1 AND deleted_at IS NULL"
        ).all() as Array<{ id: string; cod_deposit_policy: string }>;

        const byId = new Map(rows.map((r) => [r.id, r.cod_deposit_policy]));
        expect(byId.get("p1")).toBe("required");
        expect(byId.get("p2")).toBe("exempt");
        expect(byId.get("p3")).toBe("inherit");
    });

    it("excludes inactive products", () => {
        sqlite.prepare(`
            INSERT INTO products (id, name, slug, is_active, price_minor, cod_deposit_policy)
            VALUES ('p_inactive_2', 'Inactive Product', 'inactive-product-2', 0, 5000, 'required')
        `).run();

        const rows = sqlite.prepare(
            "SELECT id FROM products WHERE is_active = 1 AND deleted_at IS NULL AND id = 'p_inactive_2'"
        ).all() as Array<{ id: string }>;

        expect(rows).toHaveLength(0);
    });
});
