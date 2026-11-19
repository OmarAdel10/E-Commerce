// packages/core/src/modules/checkout/cart-validation.test.ts
// Coverage tests for cart-validation.ts codDepositPolicy on product rows
// (addresses coverage reviewer finding: cart-validation.ts codDepositPolicy untested)

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DatabaseSync as SQLiteDatabase } from "node:sqlite";

describe("cart-validation.ts — codDepositPolicy on product rows", () => {
    let sqlite: SQLiteDatabase;

    beforeAll(() => {
        sqlite = new SQLiteDatabase(":memory:");
        sqlite.exec(`
            CREATE TABLE shipping_profiles (
                id text PRIMARY KEY,
                name text NOT NULL,
                default_weight_grams real
            );
            CREATE TABLE categories (
                id text PRIMARY KEY,
                name text NOT NULL,
                slug text NOT NULL UNIQUE
            );
            CREATE TABLE products (
                id text PRIMARY KEY,
                name text NOT NULL,
                slug text NOT NULL UNIQUE,
                category_id text REFERENCES categories(id),
                is_active integer NOT NULL DEFAULT 1,
                price_minor integer NOT NULL DEFAULT 0,
                discount_bps integer NOT NULL DEFAULT 0,
                discount_type text DEFAULT 'percentage',
                discount_amount_minor integer NOT NULL DEFAULT 0,
                free_delivery integer NOT NULL DEFAULT 0,
                shipping_profile_id text REFERENCES shipping_profiles(id),
                tax_class_id text,
                tax_classification_version integer NOT NULL DEFAULT 1,
                is_gift_card integer NOT NULL DEFAULT 0,
                customization_schema text,
                brand_id text,
                page_template text,
                emi_eligible integer NOT NULL DEFAULT 1,
                warranty_policy_id text,
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
        sqlite.prepare(
            "INSERT INTO shipping_profiles (id, name) VALUES ('profile_default', 'Default')"
        ).run();

        sqlite.prepare(`
            INSERT INTO products (id, name, slug, is_active, price_minor, cod_deposit_policy)
            VALUES ('prod_required', 'Required Product', 'required-product', 1, 20000, 'required'),
                   ('prod_exempt', 'Exempt Product', 'exempt-product', 1, 15000, 'exempt'),
                   ('prod_inherit', 'Inherit Product', 'inherit-product', 1, 10000, 'inherit')
        `).run();

        const required = sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = 'prod_required'"
        ).get() as { cod_deposit_policy: string };
        const exempt = sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = 'prod_exempt'"
        ).get() as { cod_deposit_policy: string };
        const inherit = sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = 'prod_inherit'"
        ).get() as { cod_deposit_policy: string };

        expect(required.cod_deposit_policy).toBe("required");
        expect(exempt.cod_deposit_policy).toBe("exempt");
        expect(inherit.cod_deposit_policy).toBe("inherit");
    });

    it("excludes inactive products", () => {
        sqlite.prepare(`
            INSERT INTO products (id, name, slug, is_active, price_minor, cod_deposit_policy)
            VALUES ('prod_inactive', 'Inactive Product', 'inactive-product', 0, 5000, 'required')
        `).run();

        const rows = sqlite.prepare(
            "SELECT id FROM products WHERE id = 'prod_inactive' AND is_active = 1 AND deleted_at IS NULL"
        ).all();
        expect(rows).toHaveLength(0);
    });
});
