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
import { checkoutDocument, currencyDocument, paymentMethodsDocument, stripeDocument } from "@scalius/core/modules/settings";
import { createPromotionDraft, activatePromotion } from "@scalius/core/modules/promotions";
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
  discountMinor: number;
  bundleDiscountMinor: number;
  currencyCode: string;
};

async function quote(app: ReturnType<typeof appWithDb>, items: { productId: string; variantId: string; quantity: number }[], options: { cod?: boolean; shippingCountryCode?: string; city?: string; zone?: string; shippingMethodId?: string; customerPhone?: string } = {}): Promise<QuoteData> {
  const response = await post(app, "/tax-quote", {
    shippingCountryCode: options.shippingCountryCode ?? "BD",
    city: options.city ?? DELIVERY.city,
    zone: options.zone ?? DELIVERY.zone,
    shippingMethodId: options.shippingMethodId ?? DELIVERY.shippingMethodId,
    customerPhone: options.customerPhone ?? "+8801712345678",
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
    fixture = createGiftCardCheckoutFixture(`
      -- Egypt: valid COD destination (EG is in COD_COUNTRIES)
      INSERT INTO places (id, name, country_code, level, parent_id, external_ids, metadata, is_active)
        VALUES ('city_eg_cairo', 'Cairo', 'EG', 1, NULL, '{}', '{}', 1),
               ('zone_eg_cairo', 'Cairo Governorate', 'EG', 2, 'city_eg_cairo', '{}', '{}', 1);
      INSERT INTO delivery_zones (id, name) VALUES ('dz_eg', 'Egypt');
      INSERT INTO delivery_zone_regions (country_code, zone_id) VALUES ('EG', 'dz_eg');
      INSERT INTO shipping_methods (id, name, fee_minor, kind, zone_id) VALUES ('m_ship_eg', 'Standard', 10000, 'delivery', 'dz_eg');

      -- United States: valid non-COD destination (US not in COD_COUNTRIES)
      INSERT INTO places (id, name, country_code, level, parent_id, external_ids, metadata, is_active)
        VALUES ('city_us_ny', 'New York', 'US', 1, NULL, '{}', '{}', 1),
               ('zone_us_ny', 'New York State', 'US', 2, 'city_us_ny', '{}', '{}', 1);
      INSERT INTO delivery_zones (id, name) VALUES ('dz_us', 'USA');
      INSERT INTO delivery_zone_regions (country_code, zone_id) VALUES ('US', 'dz_us');
      INSERT INTO shipping_methods (id, name, fee_minor, kind, zone_id) VALUES ('m_ship_us', 'Standard', 15000, 'delivery', 'dz_us');

      -- Quantity bundle on p_mug: "2 for 10% off" (6000 saving on 2 units @ 30000)
      INSERT INTO product_bundles (id, product_id, quantity, discount_type, discount_bps, price_minor, label, position, is_active)
        VALUES ('pbd_mug_2_10pct', 'p_mug', 2, 'percentage', 1000, NULL, '2 for 10% off', 0, 1);
    `);
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
      // 25% of qualifying merchandise. Mug (required, 30000) qualifies; svc (exempt, 50000) does not.
      // Correct: 25% of 30000 = 7500. If svc were wrongly included: 25% of 80000 = 20000.
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "percentage", codDepositPercent: 25, codDepositAmount: 0, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'exempt' WHERE id = 'p_svc'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }, { ...SVC, quantity: 1 }]);
      expect(q.manualCodDeposit).not.toBeNull();
      expect(q.manualCodDeposit!.depositMinor).toBe(7500); // 25% of 30000 qualifying
      expect(q.manualCodDeposit!.balanceMinor).toBe(78500); // 86000 total - 7500 deposit
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

    it("Egypt (EG) offers COD and a manual deposit with a valid EG destination", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }], {
        shippingCountryCode: "EG",
        city: "city_eg_cairo",
        zone: "zone_eg_cairo",
        shippingMethodId: "m_ship_eg",
        customerPhone: "+201234567890",
      });
      expect(q.allowedPaymentMethods).toContain("cod");
      expect(q.manualCodDeposit).not.toBeNull();
      // 30000 mug + 10000 EG shipping = 40000 total; fixed 50 deposit
      expect(q.manualCodDeposit).toEqual({ depositMinor: 5000, balanceMinor: 35000 });
    });

    it("non-COD country (US) with a valid destination: COD not offered, quote still succeeds", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);
      const response = await post(app, "/tax-quote", {
        shippingCountryCode: "US",
        city: "city_us_ny",
        zone: "zone_us_ny",
        shippingMethodId: "m_ship_us",
        customerPhone: "+14155551234",
        cod: true,
        items: [{ ...MUG, quantity: 1 }],
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { allowedPaymentMethods: string[]; manualCodDeposit: ManualCodDepositQuote | null } };
      expect(body.data.allowedPaymentMethods).not.toContain("cod");
      expect(body.data.manualCodDeposit).toBeNull();
    });
  });

  describe("Gift-card scenario", () => {
    it("gift card line never qualifies for a manual COD deposit", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_gc'").run();
      const app = appWithDb(fixture);
      const q = await quote(app, [{ productId: "p_gc", variantId: "v_gc", quantity: 1 }]);
      // Gift cards can't be paid cash on delivery: no deposit, COD not offered.
      expect(q.manualCodDeposit).toBeNull();
      expect(q.allowedPaymentMethods).not.toContain("cod");
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

    it("places an actual online-payment order unaffected by COD deposit settings", async () => {
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositDefaultProductPolicy: "selected" });
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      const app = appWithDb(fixture);

      // Enable checkout mode all + stripe, configure fake stripe credentials.
      await checkoutDocument.write(fixture.db, { checkoutMode: "all" } as never);
      await paymentMethodsDocument.write(fixture.db, { enabledMethods: ["cod", "stripe"] } as never);
      await stripeDocument.write(fixture.db, {
        enabled: true,
        secretKey: "fixture-card-api",
        publishableKey: "fixture-card-public",
        webhookSecret: "fixture-card-webhook",
      }, { encryptionKey });

      // Card quote: COD not offered as a method; manual deposit terms are informational.
      const cardQuote = await quote(app, [{ ...MUG, quantity: 1 }], { cod: false });
      expect(cardQuote.manualCodDeposit).toEqual({ depositMinor: 5000, balanceMinor: 31000 });
      expect(cardQuote.totalMinor).toBe(36000);

      // Place the online-payment order.
      const response = await post(app, "/", {
        shippingCountryCode: "BD",
        city: DELIVERY.city,
        zone: DELIVERY.zone,
        shippingMethodId: DELIVERY.shippingMethodId,
        customerName: "Online Buyer",
        customerPhone: "+8801712345678",
        customerEmail: null,
        notes: null,
        shippingAddress: DELIVERY.shippingAddress,
        shippingCharge: 60,
        checkoutRequestId: "cr_accept_online_stripe_0001",
        expectedQuoteFingerprint: cardQuote.quoteFingerprint,
        paymentMethod: "stripe",
        items: [{ productId: "p_mug", variantId: "v_mug", quantity: 1, price: 300 }],
      });
      expect(response.status).toBe(201);
      const body = await response.json() as { data: { orderId: string; paymentMethod: string } };
      expect(body.data.paymentMethod).toBe("stripe");

      // No manual deposit plan for an online-paid order.
      const planRow = fixture.one<{
        id: string; order_id: string; deposit_amount_minor: number; balance_due_minor: number;
      }>("SELECT * FROM payment_plans WHERE order_id = ?", body.data.orderId);
      expect(planRow, "no payment plan for online order").toBeUndefined();
    });
  });

  describe("Pricing pipeline: bundle vs promotion interplay", () => {
    async function createAutoPromotion(fixture: GiftCardCheckoutFixture, name: string, basisPoints: number) {
      const { id } = await createPromotionDraft(fixture.db, {
        name,
        method: "automatic",
        priority: 100,
        combinesWith: { product: false, order: false, shipping: false },
        startsAt: null,
        endsAt: null,
        timezone: "Asia/Dhaka",
        codes: [],
        conditions: [],
        effects: [{
          target: "order",
          allocation: "once",
          kind: "percentage_off",
          config: { basisPoints },
        }],
        customerSegmentIds: [],
      });
      await activatePromotion(fixture.db, id, 1);
    }

    it("bundles win — bundle discount deducted exactly once in deposit basis", async () => {
      // 2 x p_mug @ 30000 = 60000 gross. Bundle "2 for 10% off" = 6000 saving.
      // No promotion → bundles win. Bundle saving already in quote line discount.
      // Qualifying: 60000 - 6000 = 54000. Deposit 25% = 13500. Total 60000. Balance 46500.
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "percentage", codDepositPercent: 25, codDepositAmount: 0, codDepositDefaultProductPolicy: "selected" });
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 2 }]);
      expect(q.bundleDiscountMinor).toBe(6000);
      expect(q.discountMinor).toBe(6000);
      expect(q.subtotalMinor).toBe(60000);
      expect(q.totalMinor).toBe(60000);
      expect(q.manualCodDeposit).toEqual({ depositMinor: 13500, balanceMinor: 46500 });
    });

    it("promotions win — losing bundle discount not deducted from deposit basis", async () => {
      // Bundle (6000) vs promotion 20% off 60000 = 12000. Promotion wins.
      // Qualifying: 60000 - 12000 = 48000. Deposit 25% = 12000. Total 54000. Balance 42000.
      await createAutoPromotion(fixture, "20% off order", 2000);
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "percentage", codDepositPercent: 25, codDepositAmount: 0, codDepositDefaultProductPolicy: "selected" });
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 2 }]);
      expect(q.bundleDiscountMinor).toBe(0);
      expect(q.discountMinor).toBe(12000);
      expect(q.subtotalMinor).toBe(60000);
      expect(q.totalMinor).toBe(54000);
      expect(q.manualCodDeposit).toEqual({ depositMinor: 12000, balanceMinor: 42000 });
    });

    it("promotions and bundles tie — promotions kept, bundle not deducted separately", async () => {
      // Bundle (6000) vs promotion 10% off 60000 = 6000. Tie → promotions kept.
      // Qualifying: 60000 - 6000 = 54000. Deposit 25% = 13500. Total 60000. Balance 46500.
      await createAutoPromotion(fixture, "10% off order", 1000);
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "percentage", codDepositPercent: 25, codDepositAmount: 0, codDepositDefaultProductPolicy: "selected" });
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 2 }]);
      expect(q.bundleDiscountMinor).toBe(0);
      expect(q.discountMinor).toBe(6000);
      expect(q.subtotalMinor).toBe(60000);
      expect(q.totalMinor).toBe(60000);
      expect(q.manualCodDeposit).toEqual({ depositMinor: 13500, balanceMinor: 46500 });
    });

    it("mixed required/exempt cart with actual allocated discounts", async () => {
      // Mug (required, 30000) + SVC (exempt, 50000). Promotion 20% off order = 16000.
      // Allocated proportionally: mug gets 6000, svc gets 10000.
      // Only mug qualifies: 30000 - 6000 = 24000. Deposit 25% = 6000.
      // Total: 80000 - 16000 + 6000 = 70000. Balance 64000.
      await createAutoPromotion(fixture, "20% off order", 2000);
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'exempt' WHERE id = 'p_svc'").run();
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "percentage", codDepositPercent: 25, codDepositAmount: 0, codDepositDefaultProductPolicy: "selected" });
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }, { ...SVC, quantity: 1 }]);
      expect(q.bundleDiscountMinor).toBe(0);
      expect(q.discountMinor).toBe(16000);
      expect(q.subtotalMinor).toBe(80000);
      expect(q.totalMinor).toBe(70000);
      expect(q.manualCodDeposit).toEqual({ depositMinor: 6000, balanceMinor: 64000 });
    });
  });

  describe("Egyptian checkout (EGP)", () => {
    async function enableEGPCurrency(fixture: GiftCardCheckoutFixture) {
      await currencyDocument.write(fixture.db, {
        currencyCode: "EGP",
        currencySymbol: "EGP",
      } as never);
    }

    it("EGP tax-quote: currencyCode is EGP, COD offered with deposit", async () => {
      await enableEGPCurrency(fixture);
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "fixed", codDepositAmount: 50, codDepositPercent: 0, codDepositDefaultProductPolicy: "selected" });
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }], {
        shippingCountryCode: "EG",
        city: "city_eg_cairo",
        zone: "zone_eg_cairo",
        shippingMethodId: "m_ship_eg",
        customerPhone: "+201234567890",
      });
      expect(q.currencyCode).toBe("EGP");
      expect(q.allowedPaymentMethods).toContain("cod");
      // 30000 mug + 10000 EG shipping = 40000 total; fixed 5000 deposit
      expect(q.manualCodDeposit).toEqual({ depositMinor: 5000, balanceMinor: 35000 });
    });

    it("EGP percentage deposit: 25% of qualifying merchandise", async () => {
      await enableEGPCurrency(fixture);
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "percentage", codDepositPercent: 25, codDepositAmount: 0, codDepositDefaultProductPolicy: "selected" });
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }], {
        shippingCountryCode: "EG",
        city: "city_eg_cairo",
        zone: "zone_eg_cairo",
        shippingMethodId: "m_ship_eg",
        customerPhone: "+201234567890",
      });
      expect(q.currencyCode).toBe("EGP");
      // 25% of 30000 qualifying = 7500; total 40000; balance 32500
      expect(q.manualCodDeposit).toEqual({ depositMinor: 7500, balanceMinor: 32500 });
    });

    it("EGP currency rounding: deposit rounded to whole EGP", async () => {
      // EGP increment is 100 (whole EGP). 33% of 30000 = 9900 (whole EGP).
      await enableEGPCurrency(fixture);
      fixture.sqlite.prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'").run();
      await writeSettings(fixture, { codDepositEnabled: true, codDepositMode: "percentage", codDepositPercent: 33, codDepositAmount: 0, codDepositDefaultProductPolicy: "selected" });
      const app = appWithDb(fixture);
      const q = await quote(app, [{ ...MUG, quantity: 1 }], {
        shippingCountryCode: "EG",
        city: "city_eg_cairo",
        zone: "zone_eg_cairo",
        shippingMethodId: "m_ship_eg",
        customerPhone: "+201234567890",
      });
      expect(q.currencyCode).toBe("EGP");
      // 33% of 30000 = 9900; total 40000; balance 30100
      expect(q.manualCodDeposit).toEqual({ depositMinor: 9900, balanceMinor: 30100 });
    });
  });
});
