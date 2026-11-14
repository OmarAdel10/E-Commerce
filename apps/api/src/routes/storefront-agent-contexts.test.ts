import { describe, expect, it } from "vitest";
import { checkoutDocument, businessDocument } from "@scalius/core/modules/settings";
import { applyOrderStatusChange } from "@scalius/core/modules/orders";
import { createGiftCardCheckoutFixture, DELIVERY, TEST_MASTER_SECRET } from "@scalius/core/testing/gift-card-checkout";
import { createSqliteD1Binding } from "@scalius/database/testing/sqlite-d1";
import { issueAgentCredential } from "../agent-access/pat";
import publicBuyerApp from "../runtime/public-buyer-app";

describe("agent storefront manual COD deposit over HTTP", () => {
  it("requires the owning agent, fences stale quotes, and returns only the buyer's payment plan", async () => {
    const fixture = createGiftCardCheckoutFixture();
    try {
      const grantId = "agr_coddepositgrant00001";
      const otherGrantId = "agr_coddepositgrant00002";
      const contextId = "asc_coddepositorder00001";
      const otherContextId = "asc_coddepositorder00002";
      const agentTokenPepper = "test-agent-token-pepper-for-cod-checkout";
      const env = {
        DB: createSqliteD1Binding(fixture.sqlite),
        SCALIUS_SECRET: TEST_MASTER_SECRET,
        AGENT_TOKEN_PEPPER: agentTokenPepper,
        PUBLIC_API_BASE_URL: "https://example.test",
        RL_STANDARD: { limit: async () => ({ success: true }) },
      } as unknown as Env;
      fixture.sqlite.exec(`
        INSERT INTO user (id, name, email, is_super_admin, two_factor_enabled)
        VALUES ('agent_owner', 'Agent owner', 'agent-owner@example.test', 1, 1)
      `);
      const insertGrant = fixture.sqlite.prepare(`
        INSERT INTO agent_grants (id, kind, owner_user_id, resource, label, preset, risk_ceiling, status, expires_at)
        VALUES (?, 'pat', 'agent_owner', 'storefront', 'Checkout tests', 'full', 'financial', 'active', unixepoch() + 3600)
      `);
      const insertCredential = fixture.sqlite.prepare(`
        INSERT INTO agent_credentials (id, grant_id, kind, token_hash, token_hint, expires_at)
        VALUES (?, ?, 'pat', ?, ?, unixepoch() + 3600)
      `);
      const insertContext = fixture.sqlite.prepare(`
        INSERT INTO agent_storefront_contexts (
          id, grant_id, cart_json, country_code, city_id, zone_id, shipping_method_id, expires_at
        ) VALUES (?, ?, ?, 'BD', ?, ?, ?, unixepoch() + 3600)
      `);
      const seedAgent = async (id: string, credentialId: string, checkoutContextId: string) => {
        insertGrant.run(id);
        const credential = await issueAgentCredential("pat", credentialId, agentTokenPepper);
        insertCredential.run(credentialId, id, credential.tokenHash, credential.tokenHint);
        insertContext.run(checkoutContextId, id, JSON.stringify([{ variantId: "v_mug", quantity: 1 }]),
          DELIVERY.city, DELIVERY.zone, DELIVERY.shippingMethodId);
        return credential.token;
      };
      const token = await seedAgent(grantId, "agc_coddepositgrant00001", contextId);
      const otherToken = await seedAgent(otherGrantId, "agc_coddepositgrant00002", otherContextId);
      await businessDocument.write(fixture.db, { phone: "01711111111", email: "payments@example.test" });
      await checkoutDocument.write(fixture.db, {
        checkoutMode: "guest_cod_only",
        codDepositEnabled: true,
        codDepositAmount: 100,
        codDepositInstructions: "Original transfer instructions",
      });

      const contextPath = (id: string, endpoint: string) => `/api/v1/storefront/agent-contexts/${id}/${endpoint}`;
      const request = (endpoint: string, credential: string | null, body?: unknown, id = contextId) =>
        publicBuyerApp.request(contextPath(id, endpoint), {
          method: body === undefined ? "GET" : "POST",
          headers: {
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(credential === null ? {} : { Authorization: `Bearer ${credential}` }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }, env);
      const customerPhone = "+8801712345678";
      const quoteInput = { customerPhone, cod: true };
      expect((await request("checkout/quote", null, quoteInput)).status).toBe(401);
      expect((await request("checkout/quote", otherToken, quoteInput)).status).toBe(403);

      const quote = async () => {
        const response = await request("checkout/quote", token, quoteInput);
        const body = await response.json() as {
          success: boolean;
          data: { contextRevision: number; quoteFingerprint: string; manualCodDeposit: unknown };
        };
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(body).toMatchObject({ success: true, data: { currencyCode: "BDT", totalMinor: 36000 } });
        expect(body.data.manualCodDeposit).toEqual({ depositMinor: 10000, balanceMinor: 26000 });
        expect(JSON.stringify(body)).not.toContain("transfer instructions");
        return body.data;
      };
      const submit = (reviewed: Awaited<ReturnType<typeof quote>>, credential: string | null = token) =>
        request("checkout/submit", credential, {
          expectedRevision: reviewed.contextRevision,
          expectedQuoteFingerprint: reviewed.quoteFingerprint,
          idempotencyKey: "test-manual-cod-deposit",
          customerName: "Checkout Test",
          customerPhone,
          customerEmail: null,
          shippingAddress: DELIVERY.shippingAddress,
          notes: null,
          paymentMethod: "cod",
        });

      const reviewed = await quote();
      expect((await submit(reviewed, null)).status).toBe(401);
      expect((await submit(reviewed, otherToken)).status).toBe(403);
      await checkoutDocument.write(fixture.db, { codDepositInstructions: "Reviewed transfer instructions" });
      const stale = await submit(reviewed);
      const staleBody = await stale.json();
      expect(stale.status, JSON.stringify(staleBody)).toBe(409);
      expect(staleBody).toMatchObject({ success: false, error: { code: "agent_storefront_checkout_quote_conflict" } });
      expect(fixture.one("SELECT count(*) AS count FROM orders").count).toBe(0);

      const refreshed = await quote();
      const placed = await submit(refreshed);
      const placedBody = await placed.json() as { data: { orderId: string } };
      expect(placed.status, JSON.stringify(placedBody)).toBe(201);
      expect(placedBody).toMatchObject({ success: true, data: {
        status: "complete", orderId: expect.any(String), paymentMethod: "cod", totalAmountMinor: 36000,
      } });
      expect(placedBody.data).not.toHaveProperty("checkoutToken");
      expect(placedBody.data).not.toHaveProperty("paymentPlan");
      const retried = await submit(refreshed);
      expect(retried.status).toBe(201);
      expect(await retried.json()).toEqual(placedBody);
      expect(fixture.one("SELECT count(*) AS count FROM orders").count).toBe(1);
      expect(fixture.one("SELECT kind, deposit_amount_minor, balance_due_minor, instructions FROM payment_plans")).toEqual({
        kind: "manual", deposit_amount_minor: 10000, balance_due_minor: 26000, instructions: "Reviewed transfer instructions",
      });

      const orderId = placedBody.data.orderId;
      const receiptPath = `orders/${orderId}/receipt`;
      expect((await request(receiptPath, null)).status).toBe(401);
      expect((await request(receiptPath, otherToken)).status).toBe(403);
      expect((await request(receiptPath, otherToken, undefined, otherContextId)).status).toBe(401);
      await businessDocument.write(fixture.db, { phone: "01722222222", email: "new-payments@example.test" });
      await checkoutDocument.write(fixture.db, { codDepositInstructions: "Changed after order placement" });
      const receipt = await request(receiptPath, token);
      const receiptBody = await receipt.json() as { data: { paymentPlan: unknown } };
      expect(receipt.status, JSON.stringify(receiptBody)).toBe(200);
      expect(receipt.headers.get("Cache-Control")).toBe("private, no-store");
      expect(receiptBody).toMatchObject({ success: true, data: { id: orderId, paymentMethod: "cod" } });
      expect(receiptBody.data.paymentPlan).toEqual({
        kind: "manual", status: "pending", depositAmount: 100, balanceDue: 260,
        instructions: "Reviewed transfer instructions",
        contactSnapshot: { phone: "01711111111", email: "payments@example.test", whatsappUrl: null, socialLinks: [] },
      });
      expect(receiptBody.data).not.toHaveProperty("checkoutToken");

      await applyOrderStatusChange(fixture.db, orderId, "cancelled", undefined, { generic: true });
      const cancelled = await request(receiptPath, token);
      expect(cancelled.status).toBe(200);
      expect(await cancelled.json()).toMatchObject({ data: { paymentPlan: {
        status: "cancelled", instructions: null, contactSnapshot: null,
      } } });
    } finally {
      fixture.close();
    }
  });
});
