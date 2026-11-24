// Acceptance verification for product-level manual COD deposit.
//
// Real API calls (Hono storefront-orders routes) against a real, isolated,
// migrated SQLite database (createSqliteD1Database applies the real schema
// migrations). Persisted records are verified by exact order / payment-plan
// id, never by "latest row" guessing.
//
// Run: pnpm vitest run apps/api/src/routes/storefront-orders/manual-cod-deposit-acceptance.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkoutRoutes } from "./checkout";
import { taxQuoteRoutes } from "./tax-quote";
import { OpenAPIHono } from "@hono/zod-openapi";
import { AppError } from "@scalius/core/errors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createGiftCardCheckoutFixture, DELIVERY, TEST_MASTER_SECRET, type GiftCardCheckoutFixture } from "@scalius/core/testing/gift-card-checkout";
import { checkoutDocument } from "@scalius/core/modules/settings";
import type { ManualCodDepositQuote } from "@scalius/shared/checkout-payment";

const rateLimit = { limit: async () => ({ success: true }) };
const encryptionKey = btoa("z".repeat(32));
const env = { SCALIUS_SECRET: TEST_MASTER_SECRET, CREDENTIAL_ENCRYPTION_KEY: encryptionKey, RL_STANDARD: rateLimit, RL_STRICT: rateLimit } as unknown as Env;

const MUG = { productId: "p_mug", variantId: "v_mug" } as const;
const SVC = { productId: "p_svc", variantId: "v_svc" } as const;

function appWithDb(fixture: GiftCardCheckoutFixture) {
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
  app.route("/", taxQuoteRoutes);
  return app;
}

async function writeSettings(fixture: GiftCardCheckoutFixture, overrides: Record<string, unknown>): Promise<void> {
  await checkoutDocument.write(fixture.db, {
    checkoutMode: "guest_cod_only",
    partialPaymentEnabled: false,
    partialPaymentAmount: 0,
    ...overrides,
  } as never);
}

function post(app: ReturnType<typeof appWithDb>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, env);
}

type QuoteData = {
  allowedPaymentMethods: string[];
  manualCodDeposit: ManualCodDepositQuote | null;
  quoteFingerprint: string;
  totalMinor: number;
  subtotalMinor: number;
  shippingMinor: number;
};

async function quote(app: ReturnType<typeof appWithDb>, items: { productId: string; variantId: string; quantity: number }[], options: { cod?: boolean; shippingCountryCode?: string } = {}): Promise<QuoteData> {
  const response = await post(app, "/tax-quote", {
    shippingCountryCode: options.shippingCountryCode ?? "BD",
    city: DELIVERY.city,
    zone: DELIVERY.zone,
    shippingMethodId: DELIVERY.shippingMethodId,
    customerPhone: "+8801712345678",
    cod: options.cod ?? true,
    items,
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { data: QuoteData };
  return body.data;
}

async function placeOrder(app: ReturnType<typeof appWithDb>, quoteData: QuoteData, checkoutRequestId: string, options: { paymentMethod?: string; items?: { productId: string; variantId: string; quantity: number; price: number }[] } = {}) {
  const response = await post(app, "/", {
    shippingCountryCode: "BD",
    city: DELIVERY.city,
    zone: DELIVERY.zone,
    shippingMethodId: DELIVERY.shippingMethodId,
    customerName: "Acceptance Buyer",
    customerPhone: "+8801712345678",
    customerEmail: null,
    notes: null,
    shippingAddress: DELIVERY.shippingAddress,
    shippingCharge: 60,
    checkoutRequestId,
    expectedQuoteFingerprint: quoteData.quoteFingerprint,
    paymentMethod: options.paymentMethod ?? "cod",
    items: options.items ?? [{ productId: "p_mug", variantId: "v_mug", quantity: 1, price: 300 }],
  });
  return response;
}

function planRow(fixture: GiftCardCheckoutFixture, orderId: string) {
  const row = fixture.one<{
    id: string; order_id: string; total_amount_minor: number; deposit_amount_minor: number;
    balance_due_minor: number; qualifying_merchandise_minor: number; qualifying_product_ids: string | null;
    cod_deposit_amount: number; instructions: string | null; status: string; kind: string;
  }>("SELECT * FROM payment_plans WHERE order_id = ?", orderId);
  expect(row, `no payment plan for order ${orderId}`).toBeDefined();
  return row;
}

describe("product-level manual COD deposit acceptance", () => {
  let fixture: GiftCardCheckoutFixture;

  beforeEach(() => {
    fixture = createGiftCardCheckoutFixture();
  });
  afterEach(() => fixture.close());

  describe("Global settings and master switch", () => {
    it("COD disabled: no deposit even for a required product", async () => {
      await writeSettings(fixture, { codDepositEnabled: false });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }]);
      expect(q.manualCodDeposit).toBeNull();
      expect(q.allowedPaymentMethods).toContain("cod");
    });

    it("COD enabled fixed: deposit applies to a required product", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositPercent: 0 });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }]);
      expect(q.manualCodDeposit).toEqual({ depositMinor: 5000, balanceMinor: 31000 }); // 30000 + 6000 shipping - 5000
    });
  });

  describe("All three product policies", () => {
    it("required product -> deposit applies", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }]);
      expect(q.manualCodDeposit).not.toBeNull();
      expect(q.manualCodDeposit!.depositMinor).toBe(5000);
    });

    it("exempt product -> no deposit", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "all" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'exempt' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }]);
      expect(q.manualCodDeposit).toBeNull();
    });

    it("inherit product with default 'all' -> deposit applies", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "all" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'inherit' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }]);
      expect(q.manualCodDeposit).not.toBeNull();
      expect(q.manualCodDeposit!.depositMinor).toBe(5000);
    });

    it("inherit product with default 'selected' -> no deposit", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'inherit' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }]);
      expect(q.manualCodDeposit).toBeNull();
    });
  });

  describe("Mixed cart: required + exempt products simultaneously", () => {
    it("deposit basis covers only the required product", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'exempt' WHERE id = 'p_svc'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }, { ...SVC, quantity: 1 }]);
      expect(q.manualCodDeposit).not.toBeNull();
      expect(q.manualCodDeposit!.depositMinor).toBe(5000); // qualifying basis 30000 (mug only), capped deposit 5000
    });
  });

  describe("Fixed deposit caps with exact numeric assertions", () => {
    it("fixed deposit is capped so a positive cash balance remains", async () => {
      // Configured 500 BDT (50000 minor) exceeds the qualifying merchandise 300 BDT (30000 minor):
      // the deposit is capped at the qualifying value, leaving shipping-only cash balance.
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 500, codDepositPercent: 0 });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }]);
      expect(q.manualCodDeposit).toEqual({ depositMinor: 30000, balanceMinor: 6000 }); // capped at qualifying 30000, balance = shipping only
    });
  });

  describe("Percentage deposits and currency rounding", () => {
    it("percentage deposit is a whole percent of qualifying merchandise", async () => {
      // 25% of 30000 qualifying = 7500; total 36000; balance 28500.
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "percentage", codDepositPercent: 25, codDepositAmount: 0 });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }]);
      expect(q.manualCodDeposit).toEqual({ depositMinor: 7500, balanceMinor: 28500 });
    });
  });

  describe("Persisted payment-plan snapshots (exact ids)", () => {
    it("order + plan persist exact deposit terms and qualifying basis", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositInstructions: "Pay the delivery agent on arrival", codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }]);
      const response = await placeOrder(app, q, "cr_accept_plan_0001");
      expect(response.status).toBe(201);
      const body = await response.json() as { data: { orderId: string; paymentMethod: string } };
      expect(body.data.paymentMethod).toBe("cod");
      const plan = planRow(fixture, body.data.orderId);
      expect(plan.deposit_amount_minor).toBe(5000);
      expect(plan.balance_due_minor).toBe(31000);
      expect(plan.qualifying_merchandise_minor).toBe(30000);
      expect(JSON.parse(plan.qualifying_product_ids ?? "[]")).toEqual(["p_mug"]);
      expect(plan.cod_deposit_amount).toBe(5000);
      expect(plan.instructions).toBe("Pay the delivery agent on arrival");
      expect(plan.status).toBe("pending");
      expect(plan.kind).toBe("manual");
      // The order total = deposit + balance
      expect(plan.total_amount_minor).toBe(36000);
      expect(plan.deposit_amount_minor + plan.balance_due_minor).toBe(plan.total_amount_minor);
    });
  });

  describe("Stale quote rejection after genuine policy transitions", () => {
    it("settings change rejects a stale quote fingerprint", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const first = await quote(app, [{ ...MUG, quantity: 1 }]);
      await writeSettings(fixture, { codDepositAmount: 99 });
      const response = await placeOrder(app, first, "cr_accept_stale_0001");
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toMatchObject({ error: { code: "storefront_checkout_quote_conflict" } });
      expect(fixture.one("SELECT count(*) AS count FROM orders").count).toBe(0);
    });

    it("product policy change rejects a stale quote fingerprint", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'inherit' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const first = await quote(app, [{ ...MUG, quantity: 1 }]);
      // Inherit + selected => exempt, so the reviewed quote had no deposit; now make it required.
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const response = await placeOrder(app, first, "cr_accept_stale_0002");
      expect(response.status).toBe(409);
      expect(fixture.one("SELECT count(*) AS count FROM orders").count).toBe(0);
    });
  });

  describe("COD country compatibility", () => {
    it("Bangladesh (BD) offers COD and a manual deposit", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }], { shippingCountryCode: "BD" });
      expect(q.allowedPaymentMethods).toContain("cod");
      expect(q.manualCodDeposit).not.toBeNull();
    });

    it("non-BD country: no COD deposit basis for a shipping destination", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const response = await post(app, "/tax-quote", {
        shippingCountryCode: "US", city: DELIVERY.city, zone: DELIVERY.zone,
        shippingMethodId: DELIVERY.shippingMethodId, customerPhone: "+8801712345678",
        cod: true, items: [{ ...MUG, quantity: 1 }],
      });
      expect(response.status).not.toBe(200);
    });
  });

  describe("Online payment regression", () => {
    it("online-visible order totals are unaffected by the COD deposit feature", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const withDeposit = await quote(app, [{ ...MUG, quantity: 1 }], { cod: true });
      expect(withDeposit.totalMinor).toBe(36000);
      expect(withDeposit.subtotalMinor).toBe(30000);
      expect(withDeposit.shippingMinor).toBe(6000);
      expect(withDeposit.manualCodDeposit).toEqual({ depositMinor: 5000, balanceMinor: 31000 });

      // A committed COD order collects the full quote total (deposit + balance plan).
      const response = await placeOrder(app, withDeposit, "cr_accept_online_0001");
      expect(response.status).toBe(201);
      const body = await response.json() as { data: { orderId: string } };
      const plan = planRow(fixture, body.data.orderId);
      expect(plan.total_amount_minor).toBe(withDeposit.totalMinor);
      expect(plan.deposit_amount_minor + plan.balance_due_minor).toBe(plan.total_amount_minor);

      // Disabling the deposit feature must not change online-visible totals.
      await writeSettings(fixture, { codDepositEnabled: false });
      const withoutDeposit = await quote(app, [{ ...MUG, quantity: 1 }], { cod: true });
      expect(withoutDeposit.totalMinor).toBe(36000);
      expect(withoutDeposit.subtotalMinor).toBe(30000);
      expect(withoutDeposit.shippingMinor).toBe(6000);
      expect(withoutDeposit.manualCodDeposit).toBeNull();
    });
  });
});
