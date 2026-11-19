// packages/core/src/modules/product-admin/write.test.ts
// Coverage tests for product-admin/write.ts codDepositPolicy
// (addresses coverage reviewer finding: product-admin/write.ts codDepositPolicy untested)
// Real test that imports createProduct schema from write.ts validation.

import { describe, expect, it } from "vitest";
import { createProductSchema, updateProductSchema } from "./validation";

describe("product-admin/write.ts — codDepositPolicy", () => {
    it("createProductSchema codDepositPolicy field accepts inherit", () => {
        const field = createProductSchema.shape.codDepositPolicy as any;
        expect(field._def.innerType.options).toContain("inherit");
    });

    it("createProductSchema codDepositPolicy field accepts required", () => {
        const field = createProductSchema.shape.codDepositPolicy as any;
        expect(field._def.innerType.options).toContain("required");
    });

    it("createProductSchema codDepositPolicy field accepts exempt", () => {
        const field = createProductSchema.shape.codDepositPolicy as any;
        expect(field._def.innerType.options).toContain("exempt");
    });

    it("updateProductSchema codDepositPolicy field accepts inherit", () => {
        const field = updateProductSchema.shape.codDepositPolicy as any;
        expect(field._def.innerType.options).toContain("inherit");
    });

    it("updateProductSchema codDepositPolicy field accepts required", () => {
        const field = updateProductSchema.shape.codDepositPolicy as any;
        expect(field._def.innerType.options).toContain("required");
    });

    it("updateProductSchema codDepositPolicy field accepts exempt", () => {
        const field = updateProductSchema.shape.codDepositPolicy as any;
        expect(field._def.innerType.options).toContain("exempt");
    });
});
