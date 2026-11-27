// apps/api/src/routes/admin/products.test.ts
// Coverage tests for api/routes/admin/products.ts codDepositPolicy list filter
// (addresses coverage reviewer finding: api/routes/admin/products.ts codDepositPolicy filter untested)

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1Database, type SqliteTestDatabase } from "@scalius/database/testing/sqlite-d1";
import { adminProductsRoutes } from "./products";
import { OpenAPIHono } from "@hono/zod-openapi";
import { AppError } from "@scalius/core/errors";
import type { ContentfulStatusCode } from "hono/utils/http-status";

describe("api/routes/admin/products.ts — codDepositPolicy filter", () => {
    let fixture: SqliteTestDatabase;

    beforeEach(() => {
        fixture = createSqliteD1Database();
    });

    afterEach(() => fixture.sqlite.close());

    function appWithDb() {
        const app = new OpenAPIHono<{ Bindings: Env }>();
        app.use("*", async (c, next) => {
            c.set("db" as never, fixture.db as never);
            await next();
        });
        app.onError((error: unknown, c: any) => {
            if (error instanceof AppError) {
                return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status as ContentfulStatusCode);
            }
            return c.json({ success: false, error: { code: "internal_error", message: "Unexpected error" } }, 500 as ContentfulStatusCode);
        });
        app.route("/", adminProductsRoutes);
        return app;
    }

    const env = { CREDENTIAL_ENCRYPTION_KEY: "test-key-0123456789abcdef0123456789abcdef" } as unknown as Env;

    it("GET / accepts codDepositPolicy=required query parameter", async () => {
        const app = appWithDb();
        const response = await app.request("/?codDepositPolicy=required", {}, env);
        // Route should accept the parameter (200, not a validation 400)
        expect(response.status).toBe(200);
    });

    it("GET / accepts codDepositPolicy=exempt query parameter", async () => {
        const app = appWithDb();
        const response = await app.request("/?codDepositPolicy=exempt", {}, env);
        expect(response.status).toBe(200);
    });

    it("GET / accepts codDepositPolicy=inherit query parameter", async () => {
        const app = appWithDb();
        const response = await app.request("/?codDepositPolicy=inherit", {}, env);
        expect(response.status).toBe(200);
    });

    it("GET / rejects invalid codDepositPolicy value", async () => {
        const app = appWithDb();
        const response = await app.request("/?codDepositPolicy=invalid", {}, env);
        expect(response.status).toBe(400);
    });

    it("GET / filters the listed rows by codDepositPolicy", async () => {
        const app = appWithDb();
        fixture.sqlite.exec(`
            INSERT OR IGNORE INTO settings (id, category, key, value, type, revision)
            VALUES ('settings_currency', 'currency', 'document', '{"currencyCode":"BDT","currencySymbol":"BDT"}', 'document', 1);
            INSERT OR IGNORE INTO shipping_profiles (id, name, free_delivery)
            VALUES ('shp_default', 'Default', 0);
            INSERT OR IGNORE INTO categories (id, name, slug) VALUES ('cat_1', 'General', 'general');
            INSERT OR IGNORE INTO tax_classes (id) VALUES ('tax_1');
        `);
        const create = async (name: string, slug: string, codDepositPolicy: string) => {
            const response = await app.request("/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    description: null,
                    price: 100,
                    categoryId: "cat_1",
                    isActive: true,
                    canonicalPath: `/products/${slug}`,
                    slug,
                    media: [],
                    attributes: [],
                    additionalInfo: [],
                    customizationSchema: null,
                    isGiftCard: false,
                    metaTitle: null,
                    metaDescription: null,
                    noIndex: false,
                    excludeFromSitemap: false,
                    productCondition: "new",
                    codDepositPolicy,
                }),
            }, env);
            expect(response.status).toBe(201);
            const body = JSON.parse(await response.text()) as { data: { id: string } };
            return body.data.id;
        };
        const requiredId = await create("Required Product", "required-product", "required");
        const exemptId = await create("Exempt Product", "exempt-product", "exempt");

        const listResponse = await app.request("/?codDepositPolicy=required", {}, env);
        expect(listResponse.status).toBe(200);
        const listBody = JSON.parse(await listResponse.text()) as {
            data: { products: Array<{ id: string }> };
        };
        const listedIds = listBody.data.products.map((product) => product.id);
        expect(listedIds).toContain(requiredId);
        expect(listedIds).not.toContain(exemptId);

        const exemptResponse = await app.request("/?codDepositPolicy=exempt", {}, env);
        expect(exemptResponse.status).toBe(200);
        const exemptBody = JSON.parse(await exemptResponse.text()) as {
            data: { products: Array<{ id: string }> };
        };
        const exemptIds = exemptBody.data.products.map((product) => product.id);
        expect(exemptIds).toContain(exemptId);
        expect(exemptIds).not.toContain(requiredId);
    });

    it("POST / creates a product with codDepositPolicy=required", async () => {
        const app = appWithDb();
        // Seed settings, categories and shipping profile needed by createProduct
        fixture.sqlite.exec(`
            INSERT OR IGNORE INTO settings (id, category, key, value, type, revision)
            VALUES ('settings_currency', 'currency', 'document', '{"currencyCode":"BDT","currencySymbol":"BDT"}', 'document', 1);
            INSERT OR IGNORE INTO shipping_profiles (id, name, free_delivery)
            VALUES ('shp_default', 'Default', 0);
            INSERT OR IGNORE INTO categories (id, name, slug) VALUES ('cat_1', 'General', 'general');
            INSERT OR IGNORE INTO tax_classes (id) VALUES ('tax_1');
        `);
        const response = await app.request("/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Test Mug",
                description: "A ceramic mug",
                price: 300,
                categoryId: "cat_1",
                isActive: true,
                canonicalPath: "/products/test-mug",
                slug: "test-mug",
                media: [],
                attributes: [],
                additionalInfo: [],
                customizationSchema: null,
                isGiftCard: false,
                metaTitle: null,
                metaDescription: null,
                noIndex: false,
                excludeFromSitemap: false,
                productCondition: "new",
                codDepositPolicy: "required",
            }),
        }, env);
        const responseText = await response.text();
        expect(response.status).toBe(201);
        const body = JSON.parse(responseText) as { data: { id: string } };
        const row = fixture.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = ?"
        ).get(body.data.id) as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("required");
    });

    it("POST / creates a product with codDepositPolicy=exempt", async () => {
        const app = appWithDb();
        fixture.sqlite.exec(`
            INSERT OR IGNORE INTO settings (id, category, key, value, type, revision)
            VALUES ('settings_currency', 'currency', 'document', '{"currencyCode":"BDT","currencySymbol":"BDT"}', 'document', 1);
            INSERT OR IGNORE INTO shipping_profiles (id, name, free_delivery)
            VALUES ('shp_default', 'Default', 0);
            INSERT OR IGNORE INTO categories (id, name, slug) VALUES ('cat_1', 'General', 'general');
            INSERT OR IGNORE INTO tax_classes (id) VALUES ('tax_1');
        `);
        const response = await app.request("/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Test Service",
                description: "A setup service",
                price: 500,
                categoryId: "cat_1",
                isActive: true,
                canonicalPath: "/products/test-service",
                slug: "test-service",
                media: [],
                attributes: [],
                additionalInfo: [],
                customizationSchema: null,
                isGiftCard: false,
                metaTitle: null,
                metaDescription: null,
                noIndex: false,
                excludeFromSitemap: false,
                productCondition: "new",
                codDepositPolicy: "exempt",
            }),
        }, env);
        const responseText = await response.text();
        expect(response.status).toBe(201);
        const body = JSON.parse(responseText) as { data: { id: string } };
        const row = fixture.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = ?"
        ).get(body.data.id) as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("exempt");
    });

    it("PUT /{id} updates only codDepositPolicy on an existing product", async () => {
        const app = appWithDb();
        fixture.sqlite.exec(`
            INSERT OR IGNORE INTO settings (id, category, key, value, type, revision)
            VALUES ('settings_currency', 'currency', 'document', '{"currencyCode":"BDT","currencySymbol":"BDT"}', 'document', 1);
            INSERT OR IGNORE INTO shipping_profiles (id, name, free_delivery)
            VALUES ('shp_default', 'Default', 0);
            INSERT OR IGNORE INTO categories (id, name, slug) VALUES ('cat_1', 'General', 'general');
            INSERT OR IGNORE INTO tax_classes (id) VALUES ('tax_1');
        `);
        // Create a product first
        const createResponse = await app.request("/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Test Product",
                description: null,
                price: 100,
                categoryId: "cat_1",
                isActive: true,
                canonicalPath: "/products/test-product",
                slug: "test-product",
                media: [],
                attributes: [],
                additionalInfo: [],
                customizationSchema: null,
                isGiftCard: false,
                metaTitle: null,
                metaDescription: null,
                noIndex: false,
                excludeFromSitemap: false,
                productCondition: "new",
                codDepositPolicy: "inherit",
            }),
        }, env);
        const createResponseText = await createResponse.text();
        expect(createResponse.status).toBe(201);
        const createBody = JSON.parse(createResponseText) as { data: { id: string } };
        const productId = createBody.data.id;

        // Update only codDepositPolicy
        const updateResponse = await app.request(`/${productId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: productId,
                expectedAggregateRevision: 1,
                name: "Test Product",
                description: null,
                price: 100,
                categoryId: "cat_1",
                isActive: true,
                canonicalPath: "/products/test-product",
                slug: "test-product",
                media: [],
                attributes: [],
                additionalInfo: [],
                customizationSchema: null,
                isGiftCard: false,
                metaTitle: null,
                metaDescription: null,
                noIndex: false,
                excludeFromSitemap: false,
                productCondition: "new",
                codDepositPolicy: "required",
            }),
        }, env);
        const updateResponseText = await updateResponse.text();
        expect(updateResponse.status).toBe(200);
        const row = fixture.sqlite.prepare(
            "SELECT cod_deposit_policy FROM products WHERE id = ?"
        ).get(productId) as { cod_deposit_policy: string };
        expect(row.cod_deposit_policy).toBe("required");
    });
});
