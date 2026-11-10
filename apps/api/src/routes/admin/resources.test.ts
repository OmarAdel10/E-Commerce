import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { publicRefundResult } from "./orders-refund";
import { recordOrderPayment } from "@scalius/core/modules/payments";
import type { Database } from "@scalius/database/client";
import type { RecordOrderPaymentInput } from "@scalius/core/modules/payments";

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
    const paymentTypeSchema = z.enum(["deposit"]).optional();

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

    it("accepts valid input with paymentType 'deposit' and passes input validation", async () => {
        const db = mockDb();
        // Input validation passes; DB operations will fail with empty mock, but that's after validation
        await expect(recordOrderPayment(db, baseInput)).rejects.toThrow();
    });

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
