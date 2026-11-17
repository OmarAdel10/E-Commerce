import { describe, expect, it, vi } from "vitest";
import { createGiftCardCheckoutFixture, DELIVERY } from "../../testing/gift-card-checkout";
import { checkoutDocument } from "../settings";
import { submitAgentStorefrontCheckout } from "./buyer-workflow";
import { quoteAgentStorefrontCheckout } from "./service";
import { NO_CHECKOUT_APP_FUNCTIONS, type CheckoutAppFunctions } from "../checkout";
import { getAgentStorefrontReceipt } from "./account-workflow";

describe("agent storefront manual COD deposit", () => {
  it("discloses the cash split and fences the committed plan to reviewed instructions", async () => {
    const grantId = "agr_coddepositgrant00001";
    const contextId = "asc_coddepositorder00001";
    const fixture = createGiftCardCheckoutFixture();
    try {
      fixture.sqlite.prepare(`
        INSERT INTO agent_grants (id, kind, resource, label, preset, risk_ceiling, status, expires_at)
        VALUES (?, 'pat', 'storefront', 'Checkout tests', 'operator', 'write', 'active', unixepoch() + 3600)
      `).run(grantId);
      fixture.sqlite.prepare(`
        INSERT INTO agent_storefront_contexts (
          id, grant_id, cart_json, country_code, city_id, zone_id, shipping_method_id, expires_at
        ) VALUES (?, ?, ?, 'BD', ?, ?, ?, unixepoch() + 3600)
      `).run(contextId, grantId, JSON.stringify([{ variantId: "v_mug", quantity: 1 }]),
        DELIVERY.city, DELIVERY.zone, DELIVERY.shippingMethodId);
      await checkoutDocument.write(fixture.db, {
        checkoutMode: "guest_cod_only",
        codDepositEnabled: true,
        codDepositAmount: 100,
        codDepositInstructions: "Original transfer instructions",
      });
      const customerPhone = "+8801712345678";
      const hideCodApp: CheckoutAppFunctions = {
        ...NO_CHECKOUT_APP_FUNCTIONS,
        points: new Set(["checkout.payment_methods"]),
        run: vi.fn().mockResolvedValue([{ pluginId: "checkout-test", appName: "Checkout test", priority: 1,
          output: { operations: [{ op: "hide", methodId: "cod" }] } }]),
      };
      const hidden = await quoteAgentStorefrontCheckout(fixture.db, grantId, contextId, {
        customerPhone, cod: true, apps: hideCodApp,
      });
      expect(hidden.paymentMethods).toEqual([]);
      expect(hidden.manualCodDeposit).toBeNull();

      const submit = (quoteFingerprint: string) => submitAgentStorefrontCheckout(fixture.db, grantId, contextId, {
        expectedRevision: hidden.contextRevision,
        expectedQuoteFingerprint: quoteFingerprint,
        idempotencyKey: "test-manual-deposit",
        customerName: "Checkout Test",
        customerPhone,
        customerEmail: null,
        shippingAddress: DELIVERY.shippingAddress,
        notes: null,
        paymentMethod: "cod",
      }, { requestUrl: "https://example.test/checkout" });
      await expect(submit(hidden.quoteFingerprint)).rejects.toMatchObject({ code: "agent_storefront_checkout_quote_conflict" });
      expect(fixture.one("SELECT count(*) AS count FROM orders").count).toBe(0);

      const reviewed = await quoteAgentStorefrontCheckout(fixture.db, grantId, contextId, { customerPhone, cod: true });
      expect(reviewed.manualCodDeposit).toEqual({ depositMinor: 10000, balanceMinor: 26000 });
      await checkoutDocument.write(fixture.db, { codDepositInstructions: "New transfer instructions" });
      await expect(submit(reviewed.quoteFingerprint)).rejects.toMatchObject({ code: "agent_storefront_checkout_quote_conflict" });
      expect(fixture.one("SELECT count(*) AS count FROM orders").count).toBe(0);

      const refreshed = await quoteAgentStorefrontCheckout(fixture.db, grantId, contextId, { customerPhone, cod: true });
      expect(refreshed.manualCodDeposit).toEqual(reviewed.manualCodDeposit);
      const placed = await submit(refreshed.quoteFingerprint);
      expect(placed.response.paymentMethod).toBe("cod");
      expect(fixture.one("SELECT deposit_amount_minor, balance_due_minor, instructions FROM payment_plans")).toEqual({
        deposit_amount_minor: 10000, balance_due_minor: 26000, instructions: "New transfer instructions",
      });
      const receipt = () => getAgentStorefrontReceipt(fixture.db, grantId, contextId, placed.response.orderId);
      await expect(receipt()).resolves.toMatchObject({
        paymentPlan: {
          kind: "manual", status: "pending", depositAmount: 100, balanceDue: 260,
          instructions: "New transfer instructions",
        },
      });
      await expect(getAgentStorefrontReceipt(fixture.db, "agr_anothergrant00000001", contextId, placed.response.orderId))
        .rejects.toMatchObject({ status: 403 });
      fixture.sqlite.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(placed.response.orderId);
      await expect(receipt()).resolves.toMatchObject({
        paymentPlan: { status: "cancelled", instructions: null, contactSnapshot: null },
      });
    } finally {
      fixture.close();
    }
  });
});
