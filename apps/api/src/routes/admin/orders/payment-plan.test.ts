import { OpenAPIHono } from "@hono/zod-openapi";
import { createGiftCardCheckoutFixture, DELIVERY, line } from "@scalius/core/testing/gift-card-checkout";
import { describe, expect, it } from "vitest";
import { orderDetailSchema, orderSummarySchema } from "../../../schemas/entities";
import { adminOrderDetailRoutes } from "./detail";
import { adminOrderListRoutes } from "./list";

describe("admin order payment-plan reads", () => {
  it("identifies manual, historical online, and absent plans on real detail and list reads", async () => {
    const fixture = createGiftCardCheckoutFixture();
    try {
      const input = {
        ...DELIVERY,
        shippingCountryCode: "BD",
        items: [line("p_mug", "v_mug", 1, 300)],
      };
      const { orderId } = await fixture.checkout(input, {
        codDeposit: { amount: 100, instructions: "Transfer to the store" },
      });
      const app = new OpenAPIHono();
      app.use("*", async (c, next) => {
        c.set("db" as never, fixture.db as never);
        await next();
      });
      app.route("/orders", adminOrderListRoutes);
      app.route("/orders", adminOrderDetailRoutes);

      async function readOrder() {
        const response = await app.request(`/orders/${orderId}`);
        const body = await response.json() as { data: unknown };
        expect(response.status, JSON.stringify(body)).toBe(200);
        return orderDetailSchema.parse(body.data);
      }

      async function readListedOrder() {
        const response = await app.request("/orders", {}, {});
        const body = await response.json() as { data: { orders: unknown[] } };
        expect(response.status, JSON.stringify(body)).toBe(200);
        return orderSummarySchema.parse(body.data.orders[0]);
      }

      expect(await readOrder()).toMatchObject({
        hasUnverifiedManualDeposit: true,
        paymentPlan: { kind: "manual", status: "pending", depositAmount: 100 },
      });
      expect(await readListedOrder()).toMatchObject({ id: orderId, hasUnverifiedManualDeposit: true });
      const payments = await app.request(`/orders/${orderId}/payments`);
      expect(payments.status).toBe(200);
      expect(await payments.json()).toMatchObject({
        data: { plan: { kind: "manual", status: "pending", depositAmount: 100 } },
      });

      fixture.sqlite.prepare("UPDATE payment_plans SET status = 'deposit_paid' WHERE order_id = ?").run(orderId);
      expect(await readOrder()).toMatchObject({
        hasUnverifiedManualDeposit: false,
        paymentPlan: { kind: "manual", status: "deposit_paid" },
      });
      expect(await readListedOrder()).toMatchObject({ hasUnverifiedManualDeposit: false });

      fixture.sqlite.prepare("UPDATE payment_plans SET status = 'cancelled' WHERE order_id = ?").run(orderId);
      expect(await readOrder()).toMatchObject({
        hasUnverifiedManualDeposit: true,
        paymentPlan: { kind: "manual", status: "cancelled" },
      });
      expect(await readListedOrder()).toMatchObject({ hasUnverifiedManualDeposit: true });

      fixture.sqlite.prepare("UPDATE payment_plans SET kind = 'online', status = 'pending' WHERE order_id = ?").run(orderId);
      expect(await readOrder()).toMatchObject({
        hasUnverifiedManualDeposit: false,
        paymentPlan: { kind: "online", status: "pending" },
      });
      expect(await readListedOrder()).toMatchObject({ hasUnverifiedManualDeposit: false });

      fixture.sqlite.prepare("DELETE FROM payment_plans WHERE order_id = ?").run(orderId);
      expect(await readOrder()).toMatchObject({ hasUnverifiedManualDeposit: false, paymentPlan: null });
      expect(await readListedOrder()).toMatchObject({ hasUnverifiedManualDeposit: false });
    } finally {
      fixture.close();
    }
  });
});
