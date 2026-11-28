// packages/core/src/modules/product-admin/validation.test.ts
// Behaviour of the product write schema for the manual COD deposit policy.

import { describe, expect, it } from "vitest";
import { codDepositPolicySchema } from "./validation";

describe("product-admin/validation.ts — codDepositPolicy schema", () => {
    it("accepts every deposit policy the product form can send", () => {
        for (const policy of ["inherit", "required", "exempt"] as const) {
            expect(codDepositPolicySchema.parse(policy)).toBe(policy);
        }
    });

    it("rejects a policy outside the allowed set", () => {
        expect(codDepositPolicySchema.safeParse("maybe").success).toBe(false);
    });

    it("keeps the stored policy when the field is left out", () => {
        expect(codDepositPolicySchema.parse(undefined)).toBeUndefined();
    });
});
