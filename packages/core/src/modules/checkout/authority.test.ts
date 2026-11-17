import { describe, expect, it } from "vitest";
import { assertStorefrontCheckoutAuthorityRevision } from "./authority";
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
            "Checkout details changed while the order was being placed.",
        );
    });

    it("passes with zero revision", () => {
        expect(() => assertStorefrontCheckoutAuthorityRevision(0, 0)).not.toThrow();
    });

    it("passes with large matching revisions", () => {
        expect(() => assertStorefrontCheckoutAuthorityRevision(1000000, 1000000)).not.toThrow();
    });
});
