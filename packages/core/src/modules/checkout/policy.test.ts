import { describe, expect, it } from "vitest";
import { assertStorefrontCheckoutPolicy, assertGuestStorefrontCheckoutPolicy } from "./policy";
import type { StorefrontCheckoutAuthoritySnapshot } from "./authority";
import { BUILT_IN_PAYMENT_PROVIDERS } from "../payments";
import type { NetTermsSettings } from "@scalius/shared/payment-terms";

function makeAuthority(overrides: {
    checkoutMode?: "guest_cod_only" | "gateways_only" | "all";
    codDepositEnabled?: boolean;
    guestCheckoutEnabled?: boolean;
    allowedCountries?: { allowedCountries: string[]; allowedCountriesMode: "include" | "exclude" };
    activePaymentMethods?: { enabledMethods: string[]; defaultMethod: string; netTerms: NetTermsSettings };
}): Pick<StorefrontCheckoutAuthoritySnapshot, "checkoutSettings" | "allowedCountries" | "activePaymentMethods"> {
    return {
        checkoutSettings: {
            checkoutMode: overrides.checkoutMode ?? "all",
            partialPaymentEnabled: false,
            partialPaymentAmount: 0,
            codDepositEnabled: overrides.codDepositEnabled ?? false,
            guestCheckoutEnabled: overrides.guestCheckoutEnabled ?? true,
            requireFullBillingAddress: false,
            codDepositMode: "fixed",
            codDepositAmount: 0,
            codDepositPercent: 0,
            codDepositInstructions: "",
        },
        allowedCountries: overrides.allowedCountries ?? {
            allowedCountries: ["BD"],
            allowedCountriesMode: "include",
        },
        activePaymentMethods: overrides.activePaymentMethods ?? {
            enabledMethods: ["cod", "stripe"],
            defaultMethod: "cod",
            netTerms: { dueInDays: 30, customerTags: [], segmentIds: [], appsDecide: false },
        },
    };
}

describe("assertStorefrontCheckoutPolicy — codDepositEnabled assertion", () => {
    it("allows cod when codDepositEnabled is false", () => {
        const authority = makeAuthority({ codDepositEnabled: false });
        const result = assertStorefrontCheckoutPolicy("+8801712345678", "cod", authority, BUILT_IN_PAYMENT_PROVIDERS);
        expect(result.codDepositEnabled).toBe(false);
    });

    it("allows cod when codDepositEnabled is true", () => {
        const authority = makeAuthority({ codDepositEnabled: true });
        const result = assertStorefrontCheckoutPolicy("+8801712345678", "cod", authority, BUILT_IN_PAYMENT_PROVIDERS);
        expect(result.codDepositEnabled).toBe(true);
    });

    it("rejects cod when checkout mode is gateways_only", () => {
        const authority = makeAuthority({
            checkoutMode: "gateways_only",
            codDepositEnabled: true,
        });
        expect(() =>
            assertStorefrontCheckoutPolicy("+8801712345678", "cod", authority, BUILT_IN_PAYMENT_PROVIDERS),
        ).toThrow(/is not available for the current checkout settings/);
    });

    it("rejects non-cod method when checkout mode is guest_cod_only", () => {
        const authority = makeAuthority({
            checkoutMode: "guest_cod_only",
            codDepositEnabled: false,
        });
        expect(() =>
            assertStorefrontCheckoutPolicy("+8801712345678", "stripe", authority, BUILT_IN_PAYMENT_PROVIDERS),
        ).toThrow(/is not available for the current checkout settings/);
    });

    it("rejects payment method not in enabled methods", () => {
        const authority = makeAuthority({
            activePaymentMethods: { enabledMethods: ["stripe"], defaultMethod: "stripe", netTerms: { dueInDays: 30, customerTags: [], segmentIds: [], appsDecide: false } },
        });
        expect(() =>
            assertStorefrontCheckoutPolicy("+8801712345678", "cod", authority, BUILT_IN_PAYMENT_PROVIDERS),
        ).toThrow(/is not enabled for checkout/);
    });

    it("passes with null phone (no phone country check)", () => {
        const authority = makeAuthority({ codDepositEnabled: true });
        const result = assertStorefrontCheckoutPolicy(null, "cod", authority, BUILT_IN_PAYMENT_PROVIDERS);
        expect(result.codDepositEnabled).toBe(true);
    });

    it("returns snapshot with codDepositEnabled", () => {
        const authority = makeAuthority({ codDepositEnabled: true });
        const result = assertStorefrontCheckoutPolicy("+8801712345678", "cod", authority, BUILT_IN_PAYMENT_PROVIDERS);
        expect(result).toMatchObject({
            checkoutMode: "all",
            partialPaymentEnabled: false,
            partialPaymentAmount: 0,
            codDepositEnabled: true,
        });
    });
});

describe("assertGuestStorefrontCheckoutPolicy — guest checkout gating", () => {
    it("passes when guestCheckoutEnabled is true", () => {
        const authority = makeAuthority({ guestCheckoutEnabled: true });
        const result = assertGuestStorefrontCheckoutPolicy("+8801712345678", "cod", authority, BUILT_IN_PAYMENT_PROVIDERS);
        expect(result.codDepositEnabled).toBe(false);
    });

    it("throws when guestCheckoutEnabled is false", () => {
        const authority = makeAuthority({ guestCheckoutEnabled: false });
        expect(() =>
            assertGuestStorefrontCheckoutPolicy("+8801712345678", "cod", authority, BUILT_IN_PAYMENT_PROVIDERS),
        ).toThrow("Please sign in before checkout.");
    });

    it("applies codDepositEnabled from authority", () => {
        const authority = makeAuthority({
            guestCheckoutEnabled: true,
            codDepositEnabled: true,
        });
        const result = assertGuestStorefrontCheckoutPolicy("+8801712345678", "cod", authority, BUILT_IN_PAYMENT_PROVIDERS);
        expect(result.codDepositEnabled).toBe(true);
    });
});
