import { describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createGiftCardCheckoutFixture, line, DELIVERY } from "@scalius/core/testing/gift-card-checkout";
import { applyOrderStatusChange, recordOrderReceipt } from "@scalius/core/modules/orders";
import { COOKIE_NAME, hashCustomerSessionToken } from "@scalius/core/modules/customers";
import { businessDocument, checkoutDocument } from "@scalius/core/modules/settings";
import { AppError } from "../../utils/api-error";
import { customerOrderRoutes } from "../customer-auth/orders";
import { customerOrderListRoutes } from "../customer-auth/order-list";
import { receiptRoutes } from "./receipt";

describe("manual deposit receipt", () => {
  it("requires order-specific proof and returns persisted instructions after checkout", async () => {
    const fixture = createGiftCardCheckoutFixture();
    try {
      await businessDocument.write(fixture.db, {
        phone: "01711111111",
        email: "saved@example.test",
        socialLinks: [{ id: "whatsapp", label: "WhatsApp", url: "https://web.whatsapp.com" }],
      });
      const placed = await fixture.checkout({ ...DELIVERY, paymentMethod: "cod", items: [line("p_mug", "v_mug", 1, 300)] }, { codDeposit: { amount: 50, instructions: "Pay the saved account" } });
      await businessDocument.write(fixture.db, { phone: "+8801722222222", email: "changed@example.test" });
      await checkoutDocument.write(fixture.db, { codDepositInstructions: "Changed instructions" });
      const token = "chk_test_receipt_deposit_token";
      await recordOrderReceipt(fixture.db, { orderId: placed.orderId, token });
      const app = new OpenAPIHono();
      app.use("*", async (c, next) => { c.set("db" as never, fixture.db as never); await next(); });
      app.onError((error, c) => c.json({ error: error.message }, 404));
      app.route("/", receiptRoutes);
      const missing = await app.request(`/receipt/${placed.orderId}`);
      expect(missing.status).toBe(404);
      const wrongOrder = await app.request("/receipt/order_elsewhere", { headers: { "X-Receipt-Token": token } });
      expect(wrongOrder.status).toBe(404);
      const response = await app.request(`/receipt/${placed.orderId}`, { headers: { "X-Receipt-Token": token } }, {});
      const body = await response.json() as { data: { order: { paymentPlan: unknown } } };
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.data.order.paymentPlan).toMatchObject({
        kind: "manual", status: "pending", depositAmount: 50, instructions: "Pay the saved account",
        contactSnapshot: { phone: "01711111111", email: "saved@example.test", whatsappUrl: "https://wa.me/8801711111111", socialLinks: [] },
      });
      fixture.sqlite.prepare("UPDATE orders SET account_owner_customer_id = customer_id WHERE id = ?").run(placed.orderId);
      const owner = fixture.one<{ customer_id: string }>("SELECT customer_id FROM orders WHERE id = ?", placed.orderId).customer_id;
      fixture.sqlite.exec("INSERT INTO customers (id, name, phone) VALUES ('other_customer', 'Other buyer', '+8801799999999')");
      const sessionKey = "test-customer-session-hash-key";
      const insertSession = fixture.sqlite.prepare("INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, unixepoch()+3600)");
      insertSession.run(await hashCustomerSessionToken("owner-session", sessionKey), owner);
      insertSession.run(await hashCustomerSessionToken("other-session", sessionKey), "other_customer");

      const account = new OpenAPIHono();
      account.use("*", async (c, next) => { c.set("db" as never, fixture.db as never); await next(); });
      account.onError((error, c) => c.json({ error: error.message }, error instanceof AppError && error.status === 404 ? 404 : error instanceof AppError && error.status === 401 ? 401 : 500));
      account.route("/", customerOrderRoutes);
      account.route("/", customerOrderListRoutes);
      const accountRequest = (session?: string, path = `/orders/${placed.orderId}`) => account.request(path, {
        headers: session ? { Cookie: `${COOKIE_NAME}=${session}` } : {},
      }, { CUSTOMER_SESSION_HASH_KEY: sessionKey });
      expect((await accountRequest()).status).toBe(401);
      expect((await accountRequest("other-session")).status).toBe(404);
      const detail = await accountRequest("owner-session");
      expect(detail.status).toBe(200);
      expect(detail.headers.get("Cache-Control")).toContain("no-store");
      expect(await detail.json()).toMatchObject({ data: { paymentPlan: body.data.order.paymentPlan } });

      expect((await accountRequest(undefined, "/orders")).status).toBe(401);
      const otherOrders = await accountRequest("other-session", "/orders");
      expect(otherOrders.status).toBe(200);
      expect(await otherOrders.json()).toMatchObject({ data: { orders: [] } });
      const list = await accountRequest("owner-session", "/orders");
      const listed = await list.json() as { data: { orders: Array<{ id: string; balanceDue: number; paymentPlan: unknown }> } };
      expect(list.status, JSON.stringify(listed)).toBe(200);
      expect(listed.data.orders).toHaveLength(1);
      expect(listed.data.orders[0]?.id).toBe(placed.orderId);
      expect(listed.data.orders[0]?.balanceDue).toBe(360);
      expect(listed.data.orders[0]?.paymentPlan).toEqual({ kind: "manual", status: "pending", balanceDue: 310 });

      await applyOrderStatusChange(fixture.db, placed.orderId, "cancelled", undefined, { generic: true });
      const cancelled = await app.request(`/receipt/${placed.orderId}`, { headers: { "X-Receipt-Token": token } }, {});
      expect(cancelled.status).toBe(200);
      expect(await cancelled.json()).toMatchObject({ data: { order: { paymentPlan: {
        status: "cancelled", instructions: null, contactSnapshot: null,
      } } } });
      const closedDetail = await accountRequest("owner-session");
      expect(closedDetail.status).toBe(200);
      expect(await closedDetail.json()).toMatchObject({ data: { paymentPlan: { status: "cancelled", instructions: null, contactSnapshot: null } } });
      const closedList = await accountRequest("owner-session", "/orders");
      expect(closedList.status).toBe(200);
      expect(await closedList.json()).toMatchObject({ data: { orders: [{ id: placed.orderId, paymentPlan: null }] } });
    } finally { fixture.close(); }
  });
});
