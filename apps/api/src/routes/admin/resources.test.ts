import { describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createGiftCardCheckoutFixture, DELIVERY, line } from "@scalius/core/testing/gift-card-checkout";
import { publicRefundResult } from "./orders-refund";
import { recordOrderPayment } from "@scalius/core/modules/payments";
import { adminResourceRoutes, recordPaymentBody } from "./resources";
import type { Database } from "@scalius/database/client";
import type { RecordOrderPaymentInput } from "@scalius/core/modules/payments";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Env is globally declared via env.d.ts (ambient interface) — no import needed.

function mockDb(): Database {
    return {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue(undefined),
                }),
            }),
        }) as any,
    } as unknown as Database;
}

function appWithContext(overrides: {
    db?: Database;
    pluginPrincipal?: { pluginId: string; pluginName: string } | undefined;
    agentPrincipal?: { id: string } | undefined;
    user?: { id: string } | undefined;
} = {}) {
    const app = new OpenAPIHono<{
        Bindings: Env;
        Variables: {
            db: unknown;
            pluginPrincipal?: { pluginId: string; pluginName: string };
            agentPrincipal?: { id: string };
            user?: { id: string };
        };
    }>();
    app.use("*", async (c, next) => {
        c.set("db", overrides.db ?? mockDb());
        c.set("pluginPrincipal", overrides.pluginPrincipal ?? undefined);
        c.set("agentPrincipal", overrides.agentPrincipal ?? undefined);
        c.set("user", overrides.user ?? undefined);
        await next();
    });
    app.onError((error, c) => {
        const status = (error as { status?: number }).status ?? 500;
        const code = (error as { code?: string }).code ?? "internal_error";
        const name = error instanceof Error ? error.name : "Unknown";
        const message = error instanceof Error ? error.message : "Unexpected error";
        return c.json({ success: false, error: { code, name, message } }, status as ContentfulStatusCode);
    });
    app.route("/", adminResourceRoutes);
    return app;
}

const env = { CREDENTIAL_ENCRYPTION_KEY: "test-key-0123456789abcdef0123456789abcdef" } as unknown as Env;

describe("publicRefundResult — public result projection", () => {
    it("omits refundNotification and availabilityTransitionVariantIds", () => {
        const result = {
            success: true,
            gateway: "cod",
            orderRefundId: "refund_1",
            refundId: "refund_1",
            amount: 1000,
            isFullRefund: true,
            notificationCount: 1,
            sideEffectErrors: 0,
            refundNotification: { orderId: "order_1", amount: 1000 },
            availabilityTransitionVariantIds: ["v1", "v2"],
            storeCredit: {
                giftCardId: "card_1",
                last4: "1234",
                amount: 500,
                amountMinor: 500,
                notificationOutboxId: "outbox_1",
            },
        } as any;

        const publicResult = publicRefundResult(result);
        expect(publicResult.refundNotification).toBeUndefined();
        expect(publicResult.availabilityTransitionVariantIds).toBeUndefined();
        expect(publicResult.success).toBe(true);
        expect(publicResult.amount).toBe(1000);
    });

    it("omits notificationOutboxId from storeCredit but keeps other fields", () => {
        const result = {
            success: true,
            gateway: "cod",
            amount: 1000,
            isFullRefund: true,
            notificationCount: 0,
            sideEffectErrors: 0,
            storeCredit: {
                giftCardId: "card_1",
                last4: "1234",
                amount: 500,
                amountMinor: 500,
                notificationOutboxId: "outbox_1",
            },
        } as any;

        const publicResult = publicRefundResult(result);
        expect(publicResult.storeCredit!.notificationOutboxId).toBeUndefined();
        expect(publicResult.storeCredit!.giftCardId).toBe("card_1");
        expect(publicResult.storeCredit!.last4).toBe("1234");
        expect(publicResult.storeCredit!.amount).toBe(500);
    });

    it("returns result unchanged when no storeCredit", () => {
        const result = {
            success: true,
            gateway: "cod",
            amount: 1000,
            isFullRefund: true,
            notificationCount: 0,
            sideEffectErrors: 0,
        } as any;

        const publicResult = publicRefundResult(result);
        expect(publicResult).toEqual(result);
    });

    it("returns result unchanged when no refundNotification", () => {
        const result = {
            success: true,
            gateway: "cod",
            amount: 1000,
            isFullRefund: true,
            notificationCount: 0,
            sideEffectErrors: 0,
            storeCredit: {
                giftCardId: "card_1",
                last4: "1234",
                amount: 500,
                amountMinor: 500,
            },
        };

        const publicResult = publicRefundResult(result);
        expect(publicResult.storeCredit!.giftCardId).toBe("card_1");
    });
});

describe("recordPaymentBody — paymentType enum (resources.ts)", () => {
    const paymentTypeSchema = recordPaymentBody.shape.paymentType;

    it("accepts paymentType 'deposit'", () => {
        expect(paymentTypeSchema.safeParse("deposit").success).toBe(true);
    });

    it("rejects paymentType 'balance'", () => {
        expect(paymentTypeSchema.safeParse("balance").success).toBe(false);
    });

    it("rejects paymentType 'full'", () => {
        expect(paymentTypeSchema.safeParse("full").success).toBe(false);
    });

    it("accepts undefined paymentType", () => {
        expect(paymentTypeSchema.safeParse(undefined).success).toBe(true);
    });
});

describe("recordOrderPayment — input validation with paymentType", () => {
    const baseInput: RecordOrderPaymentInput = {
        orderId: "order_1",
        amountMinor: 1000,
        via: "bank_transfer",
        recordedBy: "staff:1",
        requestKey: "test-request-key-12345",
        paymentType: "deposit",
    };

    it("rejects invalid via", async () => {
        const db = mockDb();
        await expect(
            recordOrderPayment(db, { ...baseInput, via: "invalid_via" as any }),
        ).rejects.toThrow("Choose how the payment was received.");
    });

    it("rejects non-positive amountMinor", async () => {
        const db = mockDb();
        await expect(
            recordOrderPayment(db, { ...baseInput, amountMinor: 0 }),
        ).rejects.toThrow("Enter the amount received.");
    });

    it("rejects short requestKey", async () => {
        const db = mockDb();
        await expect(
            recordOrderPayment(db, { ...baseInput, requestKey: "short" }),
        ).rejects.toThrow("A retry key of 8 to 200 characters is required.");
    });
});

describe("POST /orders/{id}/payments — manual COD deposit staff guard", () => {
    const baseBody = {
        amountMinor: 500,
        via: "bank_transfer",
        paymentType: "deposit",
    };

    it("rejects an app principal recording a deposit with 400", async () => {
        const app = appWithContext({
            pluginPrincipal: { pluginId: "app_1", pluginName: "Test App" },
        });
        const response = await app.request("/orders/order_1/payments", {
            method: "POST",
            headers: { "Content-Type": "application/json", "idempotency-key": "key-app-1" },
            body: JSON.stringify(baseBody),
        }, env);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            error: { message: "A manual COD deposit must be recorded by staff, not an app or agent." },
        });
    });

    it("rejects an agent principal recording a deposit with 400", async () => {
        const app = appWithContext({ agentPrincipal: { id: "agent_1" } });
        const response = await app.request("/orders/order_1/payments", {
            method: "POST",
            headers: { "Content-Type": "application/json", "idempotency-key": "key-agent-1" },
            body: JSON.stringify(baseBody),
        }, env);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            error: { message: "A manual COD deposit must be recorded by staff, not an app or agent." },
        });
    });

    it("records the staff deposit and replays it once even after the order revision advances", async () => {
        const fixture = createGiftCardCheckoutFixture();
        try {
            const { orderId } = await fixture.checkout({
                ...DELIVERY,
                shippingCountryCode: "BD",
                items: [line("p_mug", "v_mug", 1, 300)],
            }, { codDeposit: { amount: 100, instructions: "Transfer to the store" } });
            const app = appWithContext({ db: fixture.db, user: { id: "staff_1" } });
            const record = (amountMinor: number, requestKey: string) => app.request(`/orders/${orderId}/payments`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "idempotency-key": requestKey },
                body: JSON.stringify({ ...baseBody, amountMinor, expectedRevision: 1 }),
            }, env);
            const wrongAmount = await record(9900, "key-staff-wrong-amount");
            expect(wrongAmount.status).toBe(400);
            expect(fixture.all("SELECT id FROM order_payments WHERE order_id = ?", orderId)).toEqual([]);

            const first = await record(10000, "key-staff-exact-amount");
            const firstBody = await first.json() as { data: { payment: { id: string } } };
            expect(first.status, JSON.stringify(firstBody)).toBe(201);
            expect(firstBody.data.payment).toMatchObject({ amountMinor: 10000, type: "deposit" });

            const replay = await record(10000, "key-staff-exact-amount");
            expect(replay.status).toBe(201);
            expect(await replay.json()).toMatchObject({ data: { payment: { id: firstBody.data.payment.id } } });
            expect(fixture.all("SELECT amount_minor, payment_type FROM order_payments WHERE order_id = ?", orderId))
                .toEqual([{ amount_minor: 10000, payment_type: "deposit" }]);
            expect(fixture.one("SELECT status FROM payment_plans WHERE order_id = ?", orderId)).toEqual({ status: "deposit_paid" });
        } finally {
            fixture.close();
        }
    });
});
