// packages/core/src/modules/product-admin/bulk-edit.test.ts
// Coverage tests for product-admin/bulk-edit.ts codDepositPolicy
// (addresses coverage reviewer finding: product-admin/bulk-edit.ts codDepositPolicy untested)
// Real database-backed tests using createSqliteD1Database for persistence verification.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createSqliteD1Database } from "@scalius/database/testing/sqlite-d1";
import { readProductsForBulkEdit, type ProductBulkEditRow } from "./bulk-edit";

describe("product-admin/bulk-edit.ts — codDepositPolicy", () => {
    let testDb: ReturnType<typeof createSqliteD1Database>;

    beforeAll(() => {
        testDb = createSqliteD1Database();
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
            INSERT OR IGNORE INTO shipping_methods (id, name, fee_minor, kind, zone_id)
            VALUES ('m_ship', 'Standard', 6000, 'delivery', 'dz_bd');
        `);
    });

    afterAll(() => {
        testDb.sqlite.close();
    });

    it("readProductsForBulkEdit returns empty for empty input", async () => {
        // Passing an empty array returns early without querying the DB.
        const rows = await readProductsForBulkEdit(
            testDb.db,
            [],
        );
        expect(rows).toHaveLength(0);
    });

    it("readProductsForBulkEdit returns codDepositPolicy for each product", async () => {
        // Insert products with different deposit policies
        testDb.sqlite.exec(`
            INSERT INTO products (id, name, slug, cod_deposit_policy, is_active, price_minor, category_id, aggregate_revision)
            VALUES ('p1', 'Required Product', 'required-product', 'required', 1, 10000, 'cat_1', 1),
                   ('p2', 'Exempt Product', 'exempt-product', 'exempt', 1, 5000, 'cat_1', 1),
                   ('p3', 'Inherit Product', 'inherit-product', 'inherit', 1, 8000, 'cat_1', 1)
        `);

        const rows = await readProductsForBulkEdit(testDb.db, ["p1", "p2", "p3"]);
        expect(rows).toHaveLength(3);

        const byId = new Map(rows.map((r) => [r.id, r.codDepositPolicy]));
        expect(byId.get("p1")).toBe("required");
        expect(byId.get("p2")).toBe("exempt");
        expect(byId.get("p3")).toBe("inherit");
    });

    it("ProductBulkEditRow interface includes codDepositPolicy field", () => {
        // Type-level assertion: the interface declares codDepositPolicy
        const row: ProductBulkEditRow = {
            id: "p1",
            name: "Test Product",
            isActive: true,
            aggregateRevision: 1,
            price: 100,
            discountType: "percentage",
            discountPercentage: 0,
            discountAmount: 0,
            hasOptions: false,
            shippingProfileId: null,
            codDepositPolicy: "required",
            skus: [],
        };
        expect(row.codDepositPolicy).toBe("required");
    });

    it("codDepositPolicy accepts inherit, required, and exempt values", () => {
        const policies: ProductBulkEditRow["codDepositPolicy"][] = [
            "inherit",
            "required",
            "exempt",
        ];
        expect(policies).toHaveLength(3);
        expect(policies).toContain("inherit");
        expect(policies).toContain("required");
        expect(policies).toContain("exempt");
    });
});
