// packages/core/src/modules/payments/gateways/identity.test.ts
// Tests for COD country policy: cash on delivery serves Bangladesh and, where
// a merchant configures an eligible Egyptian market, currency, delivery method
// and the COD payment method, Egypt.
import { describe, expect, it } from "vitest";
import { COD_COUNTRIES } from "./identity";

describe("COD_COUNTRIES — country policy", () => {
    it("COD_COUNTRIES includes Bangladesh and Egypt", () => {
        expect(COD_COUNTRIES).toEqual(["BD", "EG"]);
    });

    it("COD_COUNTRIES contains Bangladesh", () => {
        expect(COD_COUNTRIES).toContain("BD");
    });

    it("COD_COUNTRIES contains Egypt", () => {
        expect(COD_COUNTRIES).toContain("EG");
    });

    it("COD_COUNTRIES contains exactly two countries", () => {
        expect(COD_COUNTRIES).toHaveLength(2);
    });
});
