// packages/core/src/modules/product-admin/semantic-sections.test.ts
// Coverage tests for product-admin/semantic-sections.ts codDepositPolicy
// (addresses QA Medium finding: bulk-editor codDepositPolicy not persisted)
// Real database-backed tests using createSqliteD1Database for persistence verification.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createSqliteD1Database } from "@scalius/database/testing/sqlite-d1";
import type { SqliteTestDatabase } from "@scalius/database/testing/sqlite-d1";
import { planProductBaseSection, getProductSemanticSection, productBasePatchSchema } from "./semantic-sections";
import type { BatchItem } from "drizzle-orm/batch";

describe("product-admin/semantic-sections.ts — codDepositPolicy bulk editor persistence", () => {
    let testDb: SqliteTestDatabase;

    beforeAll(() => {
        testDb = createSqliteD1Database();
        // Seed currency settings
        testDb.sqlite.exec(`
            INSERT OR IGNORE INTO settings (id, category, key, value, type, revision)
            VALUES ('settings_currency', 'currency', 'document', '{"currencyCode":"EGP","currencySymbol":"EGP"}', 'document', 1);
            INSERT OR IGNORE INTO shipping_profiles (id, name, free_delivery)
            VALUES ('shp_default', 'Default', 0);
            INSERT OR IGNORE INTO categories (id, name, slug) VALUES ('cat_1', 'General', 'general');
            INSERT OR IGNORE INTO tax_classes (id) VALUES ('tax_1');
        `);
    });

    afterAll(() => {
        testDb.sqlite.close();
    });

    it("planProductBaseSection writes codDepositPolicy=required when provided", async () => {
        // Create a product first
        testDb.sqlite.exec(`
            INSERT INTO products (id, name, slug, cod_deposit_policy, is_active, price_minor, category_id, aggregate_revision)
            VALUES ('p1', 'Test Product', 'test-product', 'inherit', 1, 10000, 'cat_1', 1)
        `);

        const statements = await planProductBaseSection(testDb.db, "p1", {
            codDepositPolicy: "required",
        } as { codDepositPolicy?: "inherit" | "required" | "exempt" });

        expect(statements).not.toBeNull();
        expect(statements!.length).toBeGreaterThan(0);

        // Execute the statements (batch expects a tuple)
        await (testDb.db.batch as any)([...statements!] as BatchItem<"sqlite">[]);

        // Verify the policy was persisted
        const row = testDb.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = 'p1'"
        ).get() as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("required");
    });

    it("planProductBaseSection writes codDepositPolicy=exempt when provided", async () => {
        testDb.sqlite.exec(`
            INSERT INTO products (id, name, slug, cod_deposit_policy, is_active, price_minor, category_id, aggregate_revision)
            VALUES ('p2', 'Test Product 2', 'test-product-2', 'inherit', 1, 10000, 'cat_1', 1)
        `);

        const statements = await planProductBaseSection(testDb.db, "p2", {
            codDepositPolicy: "exempt",
        } as { codDepositPolicy?: "inherit" | "required" | "exempt" });

        expect(statements).not.toBeNull();
        await (testDb.db.batch as any)([...statements!] as BatchItem<"sqlite">[]);

        const row = testDb.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = 'p2'"
        ).get() as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("exempt");
    });

    it("planProductBaseSection writes codDepositPolicy=inherit when provided", async () => {
        testDb.sqlite.exec(`
            INSERT INTO products (id, name, slug, cod_deposit_policy, is_active, price_minor, category_id, aggregate_revision)
            VALUES ('p3', 'Test Product 3', 'test-product-3', 'exempt', 1, 10000, 'cat_1', 1)
        `);

        const statements = await planProductBaseSection(testDb.db, "p3", {
            codDepositPolicy: "inherit",
        } as { codDepositPolicy?: "inherit" | "required" | "exempt" });

        expect(statements).not.toBeNull();
        await (testDb.db.batch as any)([...statements!] as BatchItem<"sqlite">[]);

        const row = testDb.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = 'p3'"
        ).get() as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("inherit");
    });

    it("planProductBaseSection preserves existing codDepositPolicy when omitted", async () => {
        testDb.sqlite.exec(`
            INSERT INTO products (id, name, slug, cod_deposit_policy, is_active, price_minor, category_id, aggregate_revision)
            VALUES ('p4', 'Test Product 4', 'test-product-4', 'required', 1, 10000, 'cat_1', 1)
        `);

        // Update without codDepositPolicy - should preserve existing value
        const statements = await planProductBaseSection(testDb.db, "p4", {
            name: "Updated Name",
        } as { name?: string; codDepositPolicy?: "inherit" | "required" | "exempt" });

        expect(statements).not.toBeNull();
        await (testDb.db.batch as any)([...statements!] as BatchItem<"sqlite">[]);

        const row = testDb.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = 'p4'"
        ).get() as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("required");
    });

    it("getProductSemanticSection returns codDepositPolicy in base section", async () => {
        testDb.sqlite.exec(`
            INSERT INTO products (id, name, slug, cod_deposit_policy, is_active, price_minor, category_id, aggregate_revision)
            VALUES ('p5', 'Test Product 5', 'test-product-5', 'exempt', 1, 10000, 'cat_1', 1)
        `);

        const result = await getProductSemanticSection(testDb.db, "p5", "base", { offset: 0, limit: 20 });

        expect(result).not.toBeNull();
        if (result && "product" in result) {
            const product = (result as { product: { codDepositPolicy: string | null } }).product;
            expect(product.codDepositPolicy).toBe("exempt");
        } else {
            throw new Error("Expected base section result with product");
        }
    });

    it("getProductSemanticSection returns inherit codDepositPolicy when not explicitly set", async () => {
        // cod_deposit_policy has NOT NULL DEFAULT 'inherit' constraint
        testDb.sqlite.exec(`
            INSERT INTO products (id, name, slug, is_active, price_minor, category_id, aggregate_revision)
            VALUES ('p6', 'Test Product 6', 'test-product-6', 1, 10000, 'cat_1', 1)
        `);

        const result = await getProductSemanticSection(testDb.db, "p6", "base", { offset: 0, limit: 20 });

        expect(result).not.toBeNull();
        if (result && "product" in result) {
            const product = (result as { product: { codDepositPolicy: string | null } }).product;
            expect(product.codDepositPolicy).toBe("inherit");
        } else {
            throw new Error("Expected base section result with product");
        }
    });

    describe("productBasePatchSchema — codDepositPolicy Zod validation", () => {
        it("accepts inherit", () => {
            const result = productBasePatchSchema.safeParse({ codDepositPolicy: "inherit" });
            expect(result.success).toBe(true);
            expect(result.success && result.data.codDepositPolicy).toBe("inherit");
        });

        it("accepts required", () => {
            const result = productBasePatchSchema.safeParse({ codDepositPolicy: "required" });
            expect(result.success).toBe(true);
            expect(result.success && result.data.codDepositPolicy).toBe("required");
        });

        it("accepts exempt", () => {
            const result = productBasePatchSchema.safeParse({ codDepositPolicy: "exempt" });
            expect(result.success).toBe(true);
            expect(result.success && result.data.codDepositPolicy).toBe("exempt");
        });

        it("rejects invalid codDepositPolicy values", () => {
            const result = productBasePatchSchema.safeParse({ codDepositPolicy: "invalid" });
            expect(result.success).toBe(false);
            if (!result.success) {
                const codDepositPolicyIssue = result.error.issues.find((issue: { path: unknown[] }) =>
                    issue.path.includes("codDepositPolicy")
                );
                expect(codDepositPolicyIssue).toBeDefined();
            }
        });

        it("is optional (omitting codDepositPolicy is valid)", () => {
            const result = productBasePatchSchema.safeParse({ name: "Test Product" });
            expect(result.success).toBe(true);
        });
    });
});
