import { describe, expect, it } from "vitest";
import { assertStorefrontCheckoutAuthorityRevision } from "./authority";
import type { StorefrontCheckoutSettingsAuthority } from "./authority";
import { ValidationError } from "@scalius/core/errors";

describe("assertStorefrontCheckoutAuthorityRevision — revision guard", () => {
    it("passes when current equals original", () => {
        expect(() => assertStorefrontCheckoutAuthorityRevision(5, 5)).not.toThrow();
    });

    it("throws ValidationError when current differs from original", () => {
        expect(() => assertStorefrontCheckoutAuthorityRevision(6, 5)).toThrow(ValidationError);
    });

    it("throws with checkout-changed message on mismatch", () => {
        expect(() => assertStorefrontCheckoutAuthorityRevision(6, 5)).toThrow(
            "Checkout details changed while the order was being placed. Return to your cart to review them and try again.",
        );
    });

    it("passes with zero revision", () => {
        expect(() => assertStorefrontCheckoutAuthorityRevision(0, 0)).not.toThrow();
    });

    it("passes with large matching revisions", () => {
        expect(() => assertStorefrontCheckoutAuthorityRevision(1000000, 1000000)).not.toThrow();
    });
});

describe("StorefrontCheckoutSettingsAuthority — codDepositDefaultProductPolicy", () => {
    const settings: StorefrontCheckoutSettingsAuthority = {
        guestCheckoutEnabled: true,
        checkoutMode: "all",
        partialPaymentEnabled: false,
        partialPaymentAmount: 0,
        requireFullBillingAddress: true,
        codDepositEnabled: true,
        codDepositMode: "fixed",
        codDepositAmount: 5000,
        codDepositPercent: 0,
        codDepositInstructions: "Pay on delivery",
        codDepositDefaultProductPolicy: "all",
    };

    it("codDepositDefaultProductPolicy field exists on settings authority snapshot", () => {
        expect(settings.codDepositDefaultProductPolicy).toBe("all");
    });

    it("codDepositDefaultProductPolicy accepts 'all'", () => {
        const all: StorefrontCheckoutSettingsAuthority["codDepositDefaultProductPolicy"] = "all";
        expect(all).toBe("all");
    });

    it("codDepositDefaultProductPolicy accepts 'selected'", () => {
        const selected: StorefrontCheckoutSettingsAuthority["codDepositDefaultProductPolicy"] = "selected";
        expect(selected).toBe("selected");
    });
});
