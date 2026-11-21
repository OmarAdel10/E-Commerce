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
});
