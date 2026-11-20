// packages/core/src/modules/product-admin/write.test.ts
// Coverage tests for product-admin/write.ts codDepositPolicy
// (addresses coverage reviewer finding: product-admin/write.ts codDepositPolicy untested)
// Real database-backed tests using createSqliteD1Database for persistence verification.
// Note: updateProduct uses safeBatch with catalogProjectionRefreshStatements which
// generates SQL that node:sqlite cannot execute through Drizzle D1 binding.
// The conditional codDepositPolicy write path in updateProduct (line 1247) uses
// the same omit-to-keep pattern as planProductBaseSection, which is tested
// in semantic-sections.test.ts.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createSqliteD1Database } from "@scalius/database/testing/sqlite-d1";
import { createProduct, duplicateProduct } from "./write";
import type { CreateProductInput } from "./validation";
import type { Database } from "@scalius/database/client";

describe("product-admin/write.ts — codDepositPolicy", () => {
    let testDb: ReturnType<typeof createSqliteD1Database>;
    let db: Database;

    beforeAll(() => {
        testDb = createSqliteD1Database();
        db = testDb.db;
        // Seed currency settings so readStoreCurrency works
        testDb.sqlite.exec(`
            INSERT OR IGNORE INTO settings (id, category, key, value, type, revision)
            VALUES ('settings_currency', 'currency', 'document', '{"currencyCode":"EGP","currencySymbol":"EGP"}', 'document', 1);
            INSERT OR IGNORE INTO shipping_profiles (id, name, free_delivery)
            VALUES ('shp_default', 'Default', 0);
            INSERT OR IGNORE INTO categories (id, name, slug) VALUES ('cat_1', 'General', 'general');
            INSERT OR IGNORE INTO tax_classes (id) VALUES ('tax_1');
            INSERT OR IGNORE INTO delivery_zones (id, name) VALUES ('dz_bd', 'Bangladesh');
            INSERT OR IGNORE INTO delivery_zone_regions (country_code, zone_id) VALUES ('BD', 'dz_bd');
        `);
    });

    afterAll(() => {
        testDb.sqlite.close();
    });

    const baseInput: CreateProductInput = {
        name: "Test Product",
        description: null,
        price: 10000,
        categoryId: "cat_1",
        isActive: true,
        canonicalPath: "/products/test-product",
        media: [],
        attributes: [],
        additionalInfo: [],
        customizationSchema: null,
        slug: "test-product",
        isGiftCard: false,
        metaTitle: null,
        metaDescription: null,
        noIndex: false,
        excludeFromSitemap: false,
        productCondition: "new",
    };

    it("createProduct defaults codDepositPolicy to inherit when omitted", async () => {
        const result = await createProduct(db, { ...baseInput });
        const row = testDb.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = ?"
        ).get(result.id) as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("inherit");
    });

    it("createProduct stores codDepositPolicy=required when provided", async () => {
        const result = await createProduct(db, {
            ...baseInput,
            slug: "test-product-required",
            codDepositPolicy: "required",
        });
        const row = testDb.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = ?"
        ).get(result.id) as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("required");
    });

    it("createProduct stores codDepositPolicy=exempt when provided", async () => {
        const result = await createProduct(db, {
            ...baseInput,
            slug: "test-product-exempt",
            codDepositPolicy: "exempt",
        });
        const row = testDb.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = ?"
        ).get(result.id) as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("exempt");
    });

    it("duplicateProduct copies codDepositPolicy from source product", async () => {
        const source = await createProduct(db, {
            ...baseInput,
            slug: "test-product-source",
            codDepositPolicy: "required",
        });

        const copy = await duplicateProduct(db, source.id, "Copy Product");
        const row = testDb.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = ?"
        ).get(copy.id) as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("required");
    });
});
