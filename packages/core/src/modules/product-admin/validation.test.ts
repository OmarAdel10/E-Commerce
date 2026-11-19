// packages/core/src/modules/product-admin/validation.test.ts
// Coverage tests for product-admin/validation.ts codDepositPolicy schema field
// (addresses coverage reviewer finding: product-admin/validation.ts codDepositPolicy untested)

import { describe, expect, it } from "vitest";
import { updateProductSchema } from "./validation";

const field = updateProductSchema.shape.codDepositPolicy as any;

describe("product-admin/validation.ts — codDepositPolicy schema", () => {
    it("codDepositPolicy field accepts 'inherit'", () => {
        expect(field._def.innerType.options).toContain("inherit");
    });

    it("codDepositPolicy field accepts 'required'", () => {
        expect(field._def.innerType.options).toContain("required");
    });

    it("codDepositPolicy field accepts 'exempt'", () => {
        expect(field._def.innerType.options).toContain("exempt");
    });

    it("codDepositPolicy field rejects invalid values", () => {
        expect(field._def.innerType.options).toHaveLength(3);
        expect(field._def.innerType.options).not.toContain("invalid");
    });

    it("codDepositPolicy field is optional", () => {
        expect(field._def.type).toBe("optional");
    });
});
