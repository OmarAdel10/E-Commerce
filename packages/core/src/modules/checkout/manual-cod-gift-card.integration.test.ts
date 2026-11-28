import { describe, expect, it } from "vitest";
import { createGiftCardCheckoutFixture, DELIVERY, line } from "../../testing/gift-card-checkout";

describe("manual COD deposit with gift cards", () => {
    const input = () => ({
        ...DELIVERY,
        shippingCountryCode: "BD",
        items: [line("p_mug", "v_mug", 1, 300)],
    });
    const depositOptions = () => ({
        codDeposit: { amount: 100, instructions: "Transfer to merchant account 123" },
    });

    it("refuses cash on delivery when a gift card covers only part of the order", async () => {
        const fixture = createGiftCardCheckoutFixture();
        try {
            const partial = await fixture.issueCard(5000, "gc_partial_cod_core");

            await expect(fixture.prepare({
                ...input(),
                giftCards: [{ handle: partial.handle }],
                paymentMethod: "cod",
            }, depositOptions())).rejects.toThrow(/cash on delivery is unavailable/i);

            expect(fixture.balance(partial.giftCardId)).toBe(5000);
            expect(fixture.all("SELECT id FROM orders")).toEqual([]);
            expect(fixture.all("SELECT id FROM payment_plans")).toEqual([]);
        } finally {
            fixture.close();
        }
    });

    it("commits a gift-card covered order without a deposit plan while deposits are enabled", async () => {
        const fixture = createGiftCardCheckoutFixture();
        try {
            const full = await fixture.issueCard(100000, "gc_full_cod_core");

            const result = await fixture.checkout({
                ...input(),
                giftCards: [{ handle: full.handle }],
                expectedAmountDueMinor: 0,
                paymentMethod: "cod",
            }, depositOptions());

            expect(result.paymentMethod).toBe("gift_card");
            expect(fixture.all("SELECT id FROM payment_plans WHERE order_id = ?", result.orderId)).toEqual([]);
            expect(fixture.one("SELECT payment_status FROM orders WHERE id = ?", result.orderId).payment_status).toBe("paid");
        } finally {
            fixture.close();
        }
    });
});
