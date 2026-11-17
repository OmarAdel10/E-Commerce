import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1Database, type SqliteTestDatabase } from "@scalius/database/testing/sqlite-d1";
import { paymentSettingsRoutes } from "./payments";
import { OpenAPIHono } from "@hono/zod-openapi";
import { AppError } from "@scalius/core/errors";
import { checkoutDocument } from "@scalius/core/modules/settings";
import type { ContentfulStatusCode } from "hono/utils/http-status";

describe("admin settings payments", () => {
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
    app.onError((error, c) => {
      if (error instanceof AppError) {
        return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status as ContentfulStatusCode);
      }
      return c.json({ success: false, error: { code: "internal_error", message: "Unexpected error" } }, 500 as ContentfulStatusCode);
    });
    app.route("/", paymentSettingsRoutes);
    return app;
  }

  const env = { CREDENTIAL_ENCRYPTION_KEY: "test-key-0123456789abcdef0123456789abcdef" } as unknown as Env;

  it("GET /payment-methods returns payment methods config", async () => {
    const app = appWithDb();
    const response = await app.request("/payment-methods", {}, env);
    expect(response.status).toBe(200);
    const json = (await response.json()) as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty("enabledMethods");
    expect(json.data).toHaveProperty("defaultMethod");
    expect(json.data).toHaveProperty("gateways");
    expect(json.data).toHaveProperty("revision");
  });

  it("GET /payment-methods includes COD and net_terms gateway status", async () => {
    const app = appWithDb();
    const response = await app.request("/payment-methods", {}, env);
    expect(response.status).toBe(200);
    const json = (await response.json()) as { success: boolean; data: { gatewayStatus: Record<string, unknown> } };
    expect(json.data.gatewayStatus.cod).toBeDefined();
    expect(json.data.gatewayStatus.net_terms).toBeDefined();
  });

  it("retains COD while a manual deposit depends on it and permits removing it after disabling the deposit", async () => {
    await checkoutDocument.write(fixture.db, {
      checkoutMode: "all",
      codDepositEnabled: true,
      codDepositMode: "percentage",
      codDepositPercent: 20,
    });
    const app = appWithDb();
    async function read() {
      const response = await app.request("/payment-methods", {}, env);
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { revision: number; enabledMethods: string[]; defaultMethod: string } };
      return body.data;
    }
    const netTerms = { dueInDays: 30, customerTags: ["wholesale"], segmentIds: [], appsDecide: false };
    const save = (enabledMethods: string[], defaultMethod: string, expectedRevision: number) => app.request("/payment-methods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledMethods, defaultMethod, expectedRevision, netTerms }),
    }, env);

    const first = await save(["cod", "net_terms"], "cod", (await read()).revision);
    expect(first.status).toBe(200);
    const saved = await read();
    expect(saved).toMatchObject({ enabledMethods: ["cod", "net_terms"], defaultMethod: "cod" });

    const refused = await save(["net_terms"], "net_terms", saved.revision);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { message: expect.stringContaining("Cash on delivery deposit requires Cash on Delivery to be enabled.") },
    });
    expect(await read()).toMatchObject(saved);

    await checkoutDocument.write(fixture.db, { codDepositEnabled: false });
    expect((await save(["net_terms"], "net_terms", saved.revision)).status).toBe(200);
    expect(await read()).toMatchObject({ enabledMethods: ["net_terms"], defaultMethod: "net_terms" });
  });
});
