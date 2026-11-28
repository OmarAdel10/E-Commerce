// packages/core/src/modules/product-admin/write.test.ts
// Coverage tests for product-admin/write.ts codDepositPolicy
// (addresses coverage reviewer finding: product-admin/write.ts codDepositPolicy untested)
// Real database-backed tests using createSqliteD1Database for persistence verification.
// updateProduct's conditional codDepositPolicy write (write.ts:1247) uses the same
// omit-to-keep pattern as planProductBaseSection (tested in semantic-sections.test.ts).
// updateProduct itself cannot be directly tested with real SQLite because safeBatch
// calls catalogProjectionRefreshStatements which uses Drizzle API chains incompatible
// with node:sqlite's D1 binding — a pre-existing infrastructure limitation. We mock
// catalogProjectionRefreshStatements to return [] so the rest of the batch executes
// against the real database, and change another field (name) to trigger detailsChanged.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { createSqliteD1Database } from "@scalius/database/testing/sqlite-d1";
import { createProduct, duplicateProduct, updateProduct } from "./write";
import type { CreateProductInput, UpdateProductInput } from "./validation";
import type { Database } from "@scalius/database/client";

vi.mock("../products", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../products")>();
  return {
    ...actual,
    catalogProjectionRefreshStatements: vi.fn(() => [] as never[]),
  };
});

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
        vi.restoreAllMocks();
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

    it("updateProduct minimally works with real SQLite", async () => {
        const created = await createProduct(db, {
            ...baseInput,
            slug: "test-product-minimal",
        });

        await updateProduct(db, created.id, {
            ...baseInput,
            slug: "test-product-minimal",
            name: "Minimal Updated Name",
            expectedAggregateRevision: 1,
        } as UpdateProductInput);

        const row = testDb.sqlite.prepare(
            "SELECT name FROM products WHERE id = ?"
        ).get(created.id) as { name: string };
        expect(row.name).toBe("Minimal Updated Name");
    });

    it("updateProduct conditionally writes codDepositPolicy when provided", async () => {
        const created = await createProduct(db, {
            ...baseInput,
            slug: "test-product-update",
            codDepositPolicy: "inherit",
        });

        await updateProduct(db, created.id, {
            ...baseInput,
            slug: "test-product-update",
            name: "Updated Product Name",
            codDepositPolicy: "required",
            expectedAggregateRevision: 1,
        } as UpdateProductInput);

        const row = testDb.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = ?"
        ).get(created.id) as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("required");
    });

    it("updateProduct persists codDepositPolicy as the sole changed field", async () => {
        const created = await createProduct(db, {
            ...baseInput,
            slug: "test-product-sole",
            codDepositPolicy: "inherit",
        });

        await updateProduct(db, created.id, {
            ...baseInput,
            slug: "test-product-sole",
            codDepositPolicy: "exempt",
            expectedAggregateRevision: 1,
        } as UpdateProductInput);

        const row = testDb.sqlite.prepare(
            "SELECT cod_deposit_policy, aggregate_revision FROM products WHERE id = ?"
        ).get(created.id) as { cod_deposit_policy: string; aggregate_revision: number };
        expect(row.cod_deposit_policy).toBe("exempt");
        expect(row.aggregate_revision).toBeGreaterThan(1);
    });

    it("updateProduct does not change codDepositPolicy when omitted", async () => {
        const created = await createProduct(db, {
            ...baseInput,
            slug: "test-product-nochange",
            codDepositPolicy: "exempt",
        });

        await updateProduct(db, created.id, {
            ...baseInput,
            slug: "test-product-nochange",
            name: "Updated Product Name",
            expectedAggregateRevision: 1,
        } as UpdateProductInput);

        const row = testDb.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = ?"
        ).get(created.id) as { cod_deposit_policy: string };
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
