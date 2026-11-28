// packages/core/src/modules/checkout/commit.test.ts
// Behaviour of the payment plan rows the checkout commit writes:
// - wantsOrderCreatedNotification from commit.ts decides the order notification.
// - The committed payment plan carries the deposit snapshot (qualifying
//   merchandise, qualifying product ids, configured deposit amount), and the
//   real schema rejects negative snapshot values.
// - A product deposit policy change bumps the checkout authority through the
//   migration-0192 trigger, so an in-flight checkout cannot keep stale terms.
// The commit path itself is driven here: the plan row is written by
// commitStorefrontOrderPayload, never by a mirrored insert.

import { describe, expect, it } from "vitest";
import { wantsOrderCreatedNotification } from "./commit";
import { createGiftCardCheckoutFixture, DELIVERY, line } from "../../testing/gift-card-checkout";

describe("wantsOrderCreatedNotification", () => {
    it("returns false without notification flag", () => {
        const payload = {
            checkoutToken: "tok_1",
            checkoutAuthorityRevision: 1,
            existingCustomer: { id: "cust_1" },
            orderData: {
                id: "order_1",
                totalAmountMinor: 20000,
                currencyCode: "EGP",
                currencyDecimalPlaces: 2,
                status: "paid",
            },
            items: [],
            requestUrl: "/checkout",
            taxQuote: {
                valid: true,
                quoteFingerprint: "fp_1",
                displayLabel: "VAT",
                currencyCode: "EGP",
                decimalPlaces: 2,
                settingsVersion: 1,
                subtotalMinor: 20000,
                subtotalAmount: 200,
                shippingMinor: 0,
                shippingAmount: 0,
                discountMinor: 0,
                discountAmount: 0,
                taxMinor: 0,
                taxAmount: 0,
                totalMinor: 20000,
                totalAmount: 200,
                manualCodDeposit: null,
                amountDueMinor: 20000,
                amountDue: 200,
                giftCardTenders: [],
                giftCardIssues: [],
                shippingMethod: null,
                shippingRateToken: null,
                deliveryMethodKind: null,
                requiresShipping: false,
                pickup: null,
                allowedPaymentMethods: ["cod", "online"],
                discounts: [],
                offers: [],
                rejectedCodes: [],
                codDeposit: {
                    amountMinor: 12000,
                    instructions: "Pay 120 EGP",
                    percent: null,
                    contactSnapshot: null,
                    qualifyingMerchandiseMinor: 40000,
                    qualifyingProductIds: ["prod_required"],
                    originalAmountMinor: 20000,
                },
            } as any,
            checkoutSideEffects: { orderCreatedNotification: false, metaPurchase: false },
        } as any;

        expect(wantsOrderCreatedNotification(payload)).toBe(false);
    });

    it("returns true with notification flag", () => {
        const payload = {
            checkoutToken: "tok_1",
            checkoutAuthorityRevision: 1,
            existingCustomer: { id: "cust_1" },
            orderData: {
                id: "order_1",
                totalAmountMinor: 20000,
                currencyCode: "EGP",
                currencyDecimalPlaces: 2,
                status: "paid",
            },
            items: [],
            requestUrl: "/checkout",
            taxQuote: {
                valid: true,
                quoteFingerprint: "fp_1",
                displayLabel: "VAT",
                currencyCode: "EGP",
                decimalPlaces: 2,
                settingsVersion: 1,
                subtotalMinor: 20000,
                subtotalAmount: 200,
                shippingMinor: 0,
                shippingAmount: 0,
                discountMinor: 0,
                discountAmount: 0,
                taxMinor: 0,
                taxAmount: 0,
                totalMinor: 20000,
                totalAmount: 200,
                manualCodDeposit: null,
                amountDueMinor: 20000,
                amountDue: 200,
                giftCardTenders: [],
                giftCardIssues: [],
                shippingMethod: null,
                shippingRateToken: null,
                deliveryMethodKind: null,
                requiresShipping: false,
                pickup: null,
                allowedPaymentMethods: ["cod", "online"],
                discounts: [],
                offers: [],
                rejectedCodes: [],
                codDeposit: {
                    amountMinor: 12000,
                    instructions: "Pay 120 EGP",
                    percent: null,
                    contactSnapshot: null,
                    qualifyingMerchandiseMinor: 40000,
                    qualifyingProductIds: ["prod_required"],
                    originalAmountMinor: 20000,
                },
            } as any,
            checkoutSideEffects: { orderCreatedNotification: true, metaPurchase: false },
        } as any;

        expect(wantsOrderCreatedNotification(payload)).toBe(true);
    });
});

describe("the committed payment plan", () => {
    const input = () => ({
        ...DELIVERY,
        shippingCountryCode: "BD",
        items: [line("p_mug", "v_mug", 1, 300)],
    });

    it("stores the deposit snapshot the checkout calculated", async () => {
        const fixture = createGiftCardCheckoutFixture();
        try {
            const { orderId } = await fixture.checkout(input(), {
                codDeposit: { amount: 100, instructions: "Pay 100 BDT to the merchant" },
            });

            const plan = fixture.one(
                "SELECT kind, status, deposit_amount_minor, balance_due_minor, total_amount_minor, qualifying_merchandise_minor, qualifying_product_ids, cod_deposit_amount FROM payment_plans WHERE order_id = ?",
                orderId,
            );
            expect(plan).toEqual({
                kind: "manual",
                status: "pending",
                deposit_amount_minor: 10000,
                balance_due_minor: 26000,
                total_amount_minor: 36000,
                qualifying_merchandise_minor: 30000,
                qualifying_product_ids: '["p_mug"]',
                cod_deposit_amount: 10000,
            });
        } finally {
            fixture.close();
        }
    });

    it("rejects a negative qualifying merchandise value", async () => {
        const fixture = createGiftCardCheckoutFixture();
        try {
            const { orderId } = await fixture.checkout(input(), {
                codDeposit: { amount: 100, instructions: "Pay 100 BDT to the merchant" },
            });

            expect(() => {
                fixture.sqlite
                    .prepare("UPDATE payment_plans SET qualifying_merchandise_minor = -1 WHERE order_id = ?")
                    .run(orderId);
            }).toThrow();
        } finally {
            fixture.close();
        }
    });

    it("rejects a negative configured deposit amount", async () => {
        const fixture = createGiftCardCheckoutFixture();
        try {
            const { orderId } = await fixture.checkout(input(), {
                codDeposit: { amount: 100, instructions: "Pay 100 BDT to the merchant" },
            });

            expect(() => {
                fixture.sqlite
                    .prepare("UPDATE payment_plans SET cod_deposit_amount = -1 WHERE order_id = ?")
                    .run(orderId);
            }).toThrow();
        } finally {
            fixture.close();
        }
    });

    it("bumps the checkout authority when a product deposit policy changes", async () => {
        const fixture = createGiftCardCheckoutFixture();
        try {
            const revision = () => Number(
                fixture.one<{ revision: number }>(
                    "SELECT revision FROM checkout_authority WHERE id = 'default'",
                ).revision,
            );
            const before = revision();

            fixture.sqlite
                .prepare("UPDATE products SET cod_deposit_policy = 'required' WHERE id = 'p_mug'")
                .run();

            expect(revision()).toBe(before + 1);
        } finally {
            fixture.close();
        }
    });
});
