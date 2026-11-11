import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1Database, type SqliteTestDatabase } from "@scalius/database/testing/sqlite-d1";
import { checkoutRoutes } from "./checkout";
import { OpenAPIHono } from "@hono/zod-openapi";
import { AppError } from "@scalius/core/errors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createGiftCardCheckoutFixture, DELIVERY, TEST_MASTER_SECRET } from "@scalius/core/testing/gift-card-checkout";
import { checkoutDocument, paymentMethodsDocument, stripeDocument } from "@scalius/core/modules/settings";
import { taxQuoteRoutes } from "./tax-quote";
import type { ManualCodDepositQuote } from "@scalius/shared/checkout-payment";

const appPolicy = vi.hoisted(() => ({ hideCod: false }));

vi.mock("../../plugins/checkout-functions", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../plugins/checkout-functions")>();
  return {
    ...original,
    createCheckoutAppFunctions(...args: Parameters<typeof original.createCheckoutAppFunctions>) {
      if (!appPolicy.hideCod) return original.createCheckoutAppFunctions(...args);
      return {
        points: new Set(["checkout.payment_methods"]),
        run: async () => [{ pluginId: "checkout-test", appName: "Checkout test", priority: 1,
          output: { operations: [{ op: "hide", methodId: "cod" }] } }],
        report: () => undefined,
      };
    },
  };
});

describe("storefront orders checkout", () => {
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
    app.route("/", checkoutRoutes);
    return app;
  }

  const env = { CREDENTIAL_ENCRYPTION_KEY: "test-key-0123456789abcdef0123456789abcdef" } as unknown as Env;

  const baseInput = {
    checkoutRequestId: "cr_test_0000000000000001",
    expectedQuoteFingerprint: "taxq_" + "a".repeat(22),
    customerName: "Test Buyer",
    customerPhone: null,
    customerEmail: "buyer@example.com",
    notes: null,
    shippingCountryCode: "BD",
    shippingCharge: 0,
    items: [
      {
        productId: "p_test",
        variantId: "v_test",
        quantity: 1,
        price: 100,
      },
    ],
  };

  it("POST / rejects order with missing required fields", async () => {
    const app = appWithDb();
    const response = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('"items"') },
    });
  });

  it("POST / rejects order with invalid checkout request id", async () => {
    const app = appWithDb();
    const response = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...baseInput, checkoutRequestId: "bad id!" }),
    }, env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('"checkoutRequestId"') },
    });
  });

  it("POST / rejects order with invalid quote fingerprint", async () => {
    const app = appWithDb();
    const response = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...baseInput, expectedQuoteFingerprint: "bad-fingerprint" }),
    }, env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('"expectedQuoteFingerprint"') },
    });
  });
});

describe("reviewed storefront manual COD deposit", () => {
  it("quotes the exact deposit and cash balance, rejects changed terms, and saves only reviewed terms", async () => {
    const fixture = createGiftCardCheckoutFixture();
    try {
      await checkoutDocument.write(fixture.db, {
        checkoutMode: "guest_cod_only",
        codDepositEnabled: true,
        codDepositMode: "percentage",
        codDepositPercent: 33,
      });
      const app = new OpenAPIHono<{ Bindings: Env }>();
      app.use("*", async (c, next) => {
        c.set("db" as never, fixture.db as never);
        await next();
      });
      app.onError((error, c) => {
        if (!(error instanceof AppError)) throw error;
        return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status as ContentfulStatusCode);
      });
      app.route("/", checkoutRoutes);
      app.route("/", taxQuoteRoutes);
      const rateLimit = { limit: async () => ({ success: true }) };
      const encryptionKey = btoa("z".repeat(32));
      const env = { SCALIUS_SECRET: TEST_MASTER_SECRET, CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
        RL_STANDARD: rateLimit, RL_STRICT: rateLimit } as unknown as Env;
      const address = {
        city: DELIVERY.city,
        zone: DELIVERY.zone,
        shippingMethodId: DELIVERY.shippingMethodId,
        shippingCountryCode: "BD",
        customerPhone: "+8801712345678",
        items: [{ productId: "p_mug", variantId: "v_mug", quantity: 1 }],
      };
      const post = (path: string, body: unknown) => app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, env);
      const quote = async (cod = true) => {
        const response = await post("/tax-quote", { ...address, cod });
        const body = await response.json() as {
          data: { allowedPaymentMethods: string[]; manualCodDeposit: ManualCodDepositQuote | null; quoteFingerprint: string };
        };
        expect(response.status, JSON.stringify(body)).toBe(200);
        return body.data;
      };
      const orderInput = {
        ...address,
        customerName: "Test Buyer",
        customerEmail: null,
        notes: null,
        items: address.items.map((item) => ({ ...item, price: 300 })),
        shippingAddress: DELIVERY.shippingAddress,
        checkoutRequestId: "cr_test_0000000000000019",
        shippingCharge: 60,
        paymentMethod: "cod",
      };
      appPolicy.hideCod = true;
      const hiddenQuote = await quote();
      expect(hiddenQuote.allowedPaymentMethods).not.toContain("cod");
      expect(hiddenQuote.manualCodDeposit).toBeNull();
      appPolicy.hideCod = false;
      const undisclosed = await post("/", { ...orderInput, expectedQuoteFingerprint: hiddenQuote.quoteFingerprint });
      expect(undisclosed.status).toBe(409);
      expect(await undisclosed.json()).toMatchObject({ error: { code: "storefront_checkout_quote_conflict" } });
      expect(fixture.one("SELECT count(*) AS count FROM orders").count).toBe(0);

      const firstQuote = await quote();
      expect(firstQuote.allowedPaymentMethods).toContain("cod");
      expect(firstQuote.manualCodDeposit).toEqual({ depositMinor: 11900, balanceMinor: 24100 });
      await checkoutDocument.write(fixture.db, { codDepositPercent: 40 });
      const stale = await post("/", { ...orderInput, expectedQuoteFingerprint: firstQuote.quoteFingerprint });
      const staleBody = await stale.json();
      expect(stale.status, JSON.stringify(staleBody)).toBe(409);
      expect(staleBody).toMatchObject({ error: { code: "storefront_checkout_quote_conflict" } });
      expect(fixture.one("SELECT count(*) AS count FROM orders").count).toBe(0);

      await checkoutDocument.write(fixture.db, { codDepositMode: "fixed", codDepositAmount: 50.5 });
      const fractionalCash = await quote();
      expect(fractionalCash.allowedPaymentMethods).not.toContain("cod");
      expect(fractionalCash.manualCodDeposit).toBeNull();
      const noLongerEligible = await post("/", { ...orderInput, expectedQuoteFingerprint: firstQuote.quoteFingerprint });
      expect(noLongerEligible.status).toBe(409);

      // Fractional prices can still use COD when only the cash balance is a
      // whole taka. Eligibility is based on that balance, rather than total.
      fixture.sqlite.exec(`
        UPDATE markets SET price_increment_minor = 1 WHERE is_backup = 1;
        UPDATE products SET price_minor = 30050 WHERE id = 'p_mug';
        UPDATE product_variants SET price_minor = 30050 WHERE id = 'v_mug';
      `);
      const wholeTakaBalance = await quote();
      expect(wholeTakaBalance.allowedPaymentMethods).toContain("cod");
      expect(wholeTakaBalance.manualCodDeposit).toEqual({ depositMinor: 5050, balanceMinor: 31000 });

      fixture.sqlite.exec(`
        UPDATE markets SET price_increment_minor = 100 WHERE is_backup = 1;
        UPDATE products SET price_minor = 30000 WHERE id = 'p_mug';
        UPDATE product_variants SET price_minor = 30000 WHERE id = 'v_mug';
      `);
      await checkoutDocument.write(fixture.db, { codDepositMode: "percentage" });
      const refreshedQuote = await quote();
      expect(refreshedQuote.manualCodDeposit).toEqual({ depositMinor: 14400, balanceMinor: 21600 });
      const placed = await post("/", { ...orderInput, expectedQuoteFingerprint: refreshedQuote.quoteFingerprint });
      const placedBody = await placed.json();
      expect(placed.status, JSON.stringify(placedBody)).toBe(201);
      expect(fixture.one("SELECT kind, deposit_amount_minor, balance_due_minor FROM payment_plans")).toEqual({
        kind: "manual", deposit_amount_minor: 14400, balance_due_minor: 21600,
      });

      await checkoutDocument.write(fixture.db, { checkoutMode: "all" });
      await paymentMethodsDocument.write(fixture.db, { enabledMethods: ["cod", "stripe"] });
      await stripeDocument.write(fixture.db, {
        enabled: true,
        secretKey: "fixture-card-api",
        publishableKey: "fixture-card-public",
        webhookSecret: "fixture-card-webhook",
      }, { encryptionKey });
      appPolicy.hideCod = true;
      const cardQuote = await quote(false);
      expect(cardQuote.allowedPaymentMethods).toEqual(["stripe"]);
      expect(cardQuote.manualCodDeposit).toBeNull();
      appPolicy.hideCod = false;
      const cardOrder = await post("/", { ...orderInput, paymentMethod: "stripe",
        checkoutRequestId: "cr_test_0000000000000020", expectedQuoteFingerprint: cardQuote.quoteFingerprint });
      expect(cardOrder.status, await cardOrder.text()).toBe(201);
      expect(fixture.one("SELECT count(*) AS count FROM payment_plans").count).toBe(1);
    } finally {
      appPolicy.hideCod = false;
      fixture.close();
    }
  });
});
