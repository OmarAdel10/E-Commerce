import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createGiftCardCheckoutFixture, DELIVERY, line, type GiftCardCheckoutFixture } from "@scalius/core/testing/gift-card-checkout";
import { processRefund, recordOrderPayment } from "@scalius/core/modules/payments";
import { createSqliteD1Binding } from "@scalius/database/testing/sqlite-d1";
import { MAINTENANCE_SWEEPS } from "../../scheduled-maintenance";
import { adminOrdersRefundRoutes } from "./orders-refund";

const masterSecret = "refund-route-fixture-secret-at-least-32";

describe("admin refund and scheduled recovery", () => {
    let fixture: GiftCardCheckoutFixture;
    let orderId: string;

    beforeEach(async () => {
        fixture = createGiftCardCheckoutFixture();
        ({ orderId } = await fixture.checkout({
            ...DELIVERY,
            shippingCountryCode: "BD",
            items: [line("p_mug", "v_mug", 1, 300)],
        }, { codDeposit: { amount: 100, instructions: "Transfer the deposit" } }));
        await recordOrderPayment(fixture.db, {
            orderId,
            amountMinor: 10000,
            via: "bank_transfer",
            requestKey: "staff-record-deposit",
            recordedBy: "staff",
            paymentType: "deposit",
        });
    });
    afterEach(() => fixture.close());

    function env(secret: string | undefined = masterSecret): Env {
        return { DB: createSqliteD1Binding(fixture.sqlite), SCALIUS_SECRET: secret } as Env;
    }

    function app() {
        const routes = new OpenAPIHono<{ Bindings: Env }>();
        routes.use("*", async (c, next) => {
            c.set("db", fixture.db);
            await next();
        });
        routes.route("/", adminOrdersRefundRoutes);
        return routes;
    }

    function submitRefund(routes: ReturnType<typeof app>, bindings = env()) {
        return routes.request(`/${orderId}/refund`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                amount: 100, reason: "Returned the deposit", manualSettlementConfirmed: true,
                requestKey: "staff-refund-deposit",
            }),
        }, bindings);
    }

    async function createRecoverableAttempt() {
        fixture.sqlite.exec(`
            CREATE TRIGGER test_delay_refund BEFORE UPDATE OF status ON payment_plans
            WHEN NEW.status = 'cancelled'
            BEGIN SELECT RAISE(ABORT, 'test refund finalization fault'); END;
        `);
        await expect(processRefund(fixture.db, {
            orderId, amountMinor: 10000, caller: "staff", reason: "Returned the deposit",
            manualSettlementConfirmed: true, requestKey: "recoverable-refund",
        }, masterSecret)).rejects.toThrow();
        fixture.sqlite.exec("DROP TRIGGER test_delay_refund");
        return fixture.one<{ id: string }>("SELECT id FROM refund_attempts WHERE order_id=?", orderId).id;
    }

    function expectRefunded() {
        expect(fixture.one("SELECT status FROM payment_plans WHERE order_id=?", orderId).status).toBe("cancelled");
        expect(fixture.all("SELECT amount_minor FROM order_payments WHERE order_id=? AND status='refunded'", orderId))
            .toEqual([{ amount_minor: 10000 }]);
    }

    it("executes a signed staff refund and replays the request through HTTP", async () => {
        const routes = app();
        const response = await submitRefund(routes);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ data: { success: true, amount: 100 } });
        const attempt = fixture.one<{ metadata: string }>("SELECT metadata FROM refund_attempts WHERE order_id=?", orderId);
        expect(JSON.parse(attempt.metadata)).toMatchObject({ _hmac: expect.stringMatching(/^[\w-]{43}$/) });
        expect((await submitRefund(routes)).status).toBe(200);
        expectRefunded();
    });

    it.each(["short", " ".repeat(40)])("rejects invalid runtime secret %j before writing attempts", async (secret) => {
        const routes = app();
        routes.onError((error, c) => c.json({ error: error.message }, 500));
        const response = await submitRefund(routes, env(secret));
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ error: "SCALIUS_SECRET is not installed or is too short." });
        expect(fixture.all("SELECT id FROM refund_attempts")).toEqual([]);
    });

    it("reconciles only the requested order's signed refund through the staff route", async () => {
        const attemptId = await createRecoverableAttempt();
        const routes = app();
        routes.onError((error, c) => c.json({ error: error.message }, error.message === "Refund attempt not found" ? 404 : 500));
        const request = (id: string, secret = masterSecret) => routes.request(
            `/${id}/refund-attempts/${attemptId}/reconcile`, { method: "POST" }, env(secret),
        );
        expect((await request("unrelated-order")).status).toBe(404);
        expect((await request(orderId, " ".repeat(40))).status).toBe(500);
        expect(fixture.one("SELECT status FROM payment_plans WHERE order_id=?", orderId).status).toBe("deposit_paid");
        const response = await request(orderId);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ data: { attemptId, status: "finalized", orderIds: [orderId] } });
        expectRefunded();
    });

    it("recovers an accepted signed refund with the actual scheduled sweep", async () => {
        const attemptId = await createRecoverableAttempt();
        const sweep = MAINTENANCE_SWEEPS.find((entry) => entry.name === "refund_attempt_reconciliation")!;
        await sweep.run({
            db: fixture.db,
            env: env(),
            executionCtx: { waitUntil: () => undefined } as unknown as ExecutionContext,
            runContext: { runId: "test", startedAt: 0, cron: "test", scheduledTime: "test", scheduledAt: 0 },
            timed: (_label, run) => run(),
        });
        expect(fixture.one("SELECT status FROM refund_attempts WHERE id=?", attemptId).status).toBe("refunded");
        expectRefunded();
    });

    it("runs the tax drain when the refund key is missing", async () => {
        const sweep = MAINTENANCE_SWEEPS.find((entry) => entry.name === "external_refund_reconciliation")!;
        const calls: string[] = [];
        await sweep.run({
            db: fixture.db,
            env: env(" ".repeat(40)),
            executionCtx: { waitUntil: () => undefined } as unknown as ExecutionContext,
            runContext: { runId: "test", startedAt: 0, cron: "test", scheduledTime: "test", scheduledAt: 0 },
            async timed(label, run) {
                calls.push(label);
                return run();
            },
        });
        expect(calls).toEqual(["tax_document_drain"]);
    });
});
