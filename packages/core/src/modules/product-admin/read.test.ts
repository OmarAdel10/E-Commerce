// packages/core/src/modules/product-admin/read.test.ts
// Behaviour of the product reads for the manual COD deposit policy.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createSqliteD1Database } from "@scalius/database/testing/sqlite-d1";
import { getProductDetails, listProducts } from "./read";
import type { Database } from "@scalius/database/client";

describe("product-admin/read.ts — codDepositPolicy reads", () => {
    describe("getProductDetails — codDepositPolicy", () => {
        let testDb: ReturnType<typeof createSqliteD1Database>;
        let mdb: Database;

        beforeAll(() => {
            testDb = createSqliteD1Database();
            mdb = testDb.db;
            // Seed required settings
            testDb.sqlite.exec(`
                INSERT OR IGNORE INTO settings (id, category, key, value, type, revision)
                VALUES ('settings_currency', 'currency', 'document', '{"currencyCode":"EGP","currencySymbol":"EGP"}', 'document', 1);
                INSERT OR IGNORE INTO shipping_profiles (id, name, free_delivery)
                VALUES ('shp_default', 'Default', 0);
                INSERT OR IGNORE INTO categories (id, name, slug) VALUES ('cat_1', 'General', 'general');
                INSERT OR IGNORE INTO tax_classes (id) VALUES ('tax_1');
                INSERT OR IGNORE INTO delivery_zones (id, name) VALUES ('dz_bd', 'Bangladesh');
                INSERT OR IGNORE INTO delivery_zone_regions (country_code, zone_id) VALUES ('BD', 'dz_bd');
                INSERT OR IGNORE INTO brands (id) VALUES ('brand_1');
                INSERT OR IGNORE INTO warranty_policies (id) VALUES ('warranty_1');
                INSERT OR IGNORE INTO shipping_methods (id, name, fee_minor, kind, zone_id)
                VALUES ('m_ship', 'Standard', 6000, 'delivery', 'dz_bd');
            `);
        });

        afterAll(() => {
            testDb.sqlite.close();
        });

        it("getProductDetails returns codDepositPolicy from stored value", async () => {
            // Insert a product with cod_deposit_policy=required
            testDb.sqlite.exec(`
                INSERT INTO products (id, name, slug, cod_deposit_policy, is_active, price_minor, category_id, aggregate_revision)
                VALUES ('p_detail_required', 'Required Product', 'required-product', 'required', 1, 10000, 'cat_1', 1)
            `);

            const result = await getProductDetails(mdb, "p_detail_required");
            expect(result).not.toBeNull();
            if (result) {
                expect(result.codDepositPolicy).toBe("required");
            }
        });

        it("getProductDetails returns codDepositPolicy=inherit when stored as inherit", async () => {
            testDb.sqlite.exec(`
                INSERT INTO products (id, name, slug, cod_deposit_policy, is_active, price_minor, category_id, aggregate_revision)
                VALUES ('p_detail_inherit', 'Inherit Product', 'inherit-product', 'inherit', 1, 10000, 'cat_1', 1)
            `);

            const result = await getProductDetails(mdb, "p_detail_inherit");
            expect(result).not.toBeNull();
            if (result) {
                expect(result.codDepositPolicy).toBe("inherit");
            }
        });

        it("getProductDetails returns codDepositPolicy=exempt when stored as exempt", async () => {
            testDb.sqlite.exec(`
                INSERT INTO products (id, name, slug, cod_deposit_policy, is_active, price_minor, category_id, aggregate_revision)
                VALUES ('p_detail_exempt', 'Exempt Product', 'exempt-product', 'exempt', 1, 10000, 'cat_1', 1)
            `);

            const result = await getProductDetails(mdb, "p_detail_exempt");
            expect(result).not.toBeNull();
            if (result) {
                expect(result.codDepositPolicy).toBe("exempt");
            }
        });

        it("getProductDetails returns null for non-existent product", async () => {
            const result = await getProductDetails(mdb, "nonexistent-product");
            expect(result).toBeNull();
        });
    });

    describe("listProducts — codDepositPolicy", () => {
        let testDb: ReturnType<typeof createSqliteD1Database>;
        let ldb: Database;

        beforeAll(() => {
            testDb = createSqliteD1Database();
            ldb = testDb.db;
            // Seed required settings
            testDb.sqlite.exec(`
                INSERT OR IGNORE INTO settings (id, category, key, value, type, revision)
                VALUES ('settings_currency', 'currency', 'document', '{"currencyCode":"EGP","currencySymbol":"EGP"}', 'document', 1);
                INSERT OR IGNORE INTO shipping_profiles (id, name, free_delivery)
                VALUES ('shp_default', 'Default', 0);
                INSERT OR IGNORE INTO categories (id, name, slug) VALUES ('cat_1', 'General', 'general');
                INSERT OR IGNORE INTO tax_classes (id) VALUES ('tax_1');
                INSERT OR IGNORE INTO brands (id) VALUES ('brand_1');
                INSERT OR IGNORE INTO warranty_policies (id) VALUES ('warranty_1');
                INSERT OR IGNORE INTO delivery_zones (id, name) VALUES ('dz_bd', 'Bangladesh');
                INSERT OR IGNORE INTO delivery_zone_regions (country_code, zone_id) VALUES ('BD', 'dz_bd');
                INSERT OR IGNORE INTO shipping_methods (id, name, fee_minor, kind, zone_id)
                VALUES ('m_ship', 'Standard', 6000, 'delivery', 'dz_bd');
            `);
            // Insert products with different policies using raw SQLite
            testDb.sqlite.exec(`
                INSERT INTO products (id, name, slug, cod_deposit_policy, is_active, price_minor, category_id, aggregate_revision)
                VALUES ('p_list_required', 'Required Product', 'required-product', 'required', 1, 10000, 'cat_1', 1),
                       ('p_list_exempt', 'Exempt Product', 'exempt-product', 'exempt', 1, 10000, 'cat_1', 1),
                       ('p_list_inherit', 'Inherit Product', 'inherit-product', 'inherit', 1, 10000, 'cat_1', 1)
            `);
        });

        afterAll(() => {
            testDb.sqlite.close();
        });

        it("listProducts returns codDepositPolicy for each product", async () => {
            const result = await listProducts(ldb, {});
            const byId = new Map(result.products.map((r) => [r.id, r.codDepositPolicy]));
            expect(byId.get("p_list_required")).toBe("required");
            expect(byId.get("p_list_exempt")).toBe("exempt");
            expect(byId.get("p_list_inherit")).toBe("inherit");
        });

        it("listProducts filters by codDepositPolicy", async () => {
            const result = await listProducts(ldb, { codDepositPolicy: "required" });
            const ids = result.products.map((r) => r.id);
            expect(ids).toEqual(["p_list_required"]);
        });
    });
});
