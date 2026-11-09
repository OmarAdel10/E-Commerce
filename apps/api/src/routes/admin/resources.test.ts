import { describe, expect, it } from "vitest";
import { publicRefundResult } from "./orders-refund";

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
        };

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
