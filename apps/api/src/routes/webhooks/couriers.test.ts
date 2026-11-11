import { OpenAPIHono } from "@hono/zod-openapi";
import { createCourierProviders, getDeliveryProviderReadinessSummary } from "@scalius/core/modules/delivery";
import { createGiftCardCheckoutFixture, DELIVERY, line } from "@scalius/core/testing/gift-card-checkout";
import { describe, expect, it, vi } from "vitest";
import { requestCourierProviders } from "../../plugins/providers/courier";
import { courierWebhookRoutes } from "./couriers";

vi.mock("../../plugins/providers/courier", () => ({ requestCourierProviders: vi.fn() }));

describe("courier webhook for a refunded manual deposit", () => {
    it("acknowledges the provider update and records the order mismatch once", async () => {
        const fixture = createGiftCardCheckoutFixture();
        try {
            const { orderId } = await fixture.checkout({
                ...DELIVERY,
                shippingCountryCode: "BD",
                items: [line("p_mug", "v_mug", 1, 300)],
            }, { codDeposit: { amount: 100, instructions: "Transfer the deposit" } });
            const providerType = "scalius.test:courier";
            fixture.sqlite.prepare(`
                INSERT INTO delivery_providers (id, name, type, is_active, credentials, config)
                VALUES ('dp_test', 'Courier', ?, 1, '{}', '{}')
            `).run(providerType);
            fixture.sqlite.prepare(`
                INSERT INTO delivery_shipments (id, order_id, provider_id, provider_type, external_id, status)
                VALUES ('parcel-1', ?, 'dp_test', ?, 'courier-parcel', 'in_transit')
            `).run(orderId, providerType);
            fixture.sqlite.prepare("UPDATE orders SET status='shipped' WHERE id=?").run(orderId);
            fixture.sqlite.prepare("UPDATE payment_plans SET status='cancelled' WHERE order_id=?").run(orderId);

            vi.mocked(requestCourierProviders).mockReturnValue(createCourierProviders([{
                id: providerType,
                label: "Courier",
                countries: ["BD"],
                createShipment: vi.fn(),
                trackShipment: vi.fn(),
                async setup(provider) {
                    return {
                        settings: {},
                        readiness: getDeliveryProviderReadinessSummary({
                            type: provider.type, isActive: provider.isActive, activationBlockers: [],
                        }),
                    };
                },
                async verifyWebhook() {
                    return {
                        status: "update",
                        eventId: "courier-event",
                        externalId: "courier-parcel",
                        orderId,
                        tracking: { status: "delivered", rawStatus: "delivered", updatedAt: "2026-04-01T10:00:00Z" },
                    };
                },
            }]));
            const routes = new OpenAPIHono<{ Bindings: Env }>();
            routes.use("*", async (c, next) => { c.set("db", fixture.db); await next(); });
            routes.route("/", courierWebhookRoutes);
            const push = () => routes.request(`/${providerType}`, { method: "POST", body: "{}" }, {} as Env);
            const first = await push();
            expect(first.status).toBe(200);
            expect(await first.json()).toMatchObject({ status: "delivered", reconciliationRequired: true });
            const duplicate = await push();
            expect(duplicate.status).toBe(200);
            expect(await duplicate.json()).toMatchObject({ duplicate: true, status: "manual_reconciliation" });
            expect(fixture.one("SELECT status FROM delivery_shipments WHERE id='parcel-1'").status).toBe("delivered");
            expect(fixture.one("SELECT status FROM orders WHERE id=?", orderId).status).toBe("shipped");
            expect(fixture.all("SELECT id FROM order_fulfillments WHERE order_id=?", orderId)).toEqual([]);
            expect(fixture.all("SELECT status FROM webhook_events WHERE order_id=?", orderId)).toEqual([{ status: "manual_reconciliation" }]);
        } finally {
            fixture.close();
        }
    });
});
