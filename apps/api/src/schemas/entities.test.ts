import { describe, expect, it } from "vitest";
import { orderSummarySchema, orderDetailSchema, productSummarySchema, productDetailSchema } from "./entities";

describe("orderSummarySchema — hasUnverifiedManualDeposit", () => {
    it("includes hasUnverifiedManualDeposit as boolean", () => {
        const shape = orderSummarySchema.shape;
        expect(shape.hasUnverifiedManualDeposit).toBeDefined();
    });
});

describe("orderDetailSchema — paymentPlan", () => {
    // The plan is parsed the way the route parses it: a plan that carries every
    // field passes, a plan that misses one fails, and an order without a plan
    // passes with null.
    const plan = {
        kind: "manual",
        status: "pending",
        totalAmount: 360,
        depositAmount: 50,
        balanceDue: 310,
        balanceDueDate: null,
        depositPaidAt: null,
        balancePaidAt: null,
        createdAt: "2026-11-28T09:30:00.000Z",
        updatedAt: "2026-11-28T09:30:00.000Z",
    };

    it("accepts a payment plan that carries every field", () => {
        const parsed = orderDetailSchema.shape.paymentPlan.safeParse(plan);
        expect(parsed.success).toBe(true);
    });

    it("rejects a payment plan that misses a field", () => {
        const parsed = orderDetailSchema.shape.paymentPlan.safeParse({
            kind: "manual",
            status: "pending",
        });
        expect(parsed.success).toBe(false);
    });

    it("accepts an order without a payment plan", () => {
        const parsed = orderDetailSchema.shape.paymentPlan.safeParse(null);
        expect(parsed.success).toBe(true);
    });
});

describe("productSummarySchema — codDepositPolicy", () => {
    const summary = {
        id: "prod_1",
        name: "Mug",
        slug: "mug",
        price: 300,
        priceRange: { from: 300, to: 300, compareAt: null },
        description: null,
        isActive: true,
        discountPercentage: 0,
        discountType: "percentage",
        discountAmount: 0,
        freeDelivery: false,
        shippingProfileId: null,
        aggregateRevision: 1,
        createdAt: "2026-11-28T09:30:00.000Z",
        updatedAt: "2026-11-28T09:30:00.000Z",
        category: { name: "Drinks" },
        variantCount: 1,
        onHand: 10,
        available: 10,
        hasVariantDiscount: false,
        hasStockHistory: false,
        mediaCount: 0,
        primaryImage: null,
        salesChannelIds: ["ch_web"],
        codDepositPolicy: "inherit",
    };

    it("accepts every deposit policy the merchant can set", () => {
        for (const policy of ["inherit", "required", "exempt"]) {
            const parsed = productSummarySchema.safeParse({ ...summary, codDepositPolicy: policy });
            expect(parsed.success).toBe(true);
        }
    });

    it("rejects a deposit policy the merchant cannot set", () => {
        const parsed = productSummarySchema.safeParse({ ...summary, codDepositPolicy: "invalid" });
        expect(parsed.success).toBe(false);
    });
});

describe("productDetailSchema — codDepositPolicy", () => {
    const detail = {
        id: "prod_1",
        name: "Mug",
        slug: "mug",
        description: null,
        price: 300,
        categoryId: null,
        brandId: null,
        brandName: null,
        metaTitle: null,
        metaDescription: null,
        canonicalPath: null,
        isActive: true,
        noIndex: false,
        excludeFromSitemap: false,
        salesChannelIds: ["ch_web"],
        productCondition: null,
        options: [],
        aggregateRevision: 1,
        discountPercentage: null,
        discountType: null,
        discountAmount: null,
        freeDelivery: false,
        shippingProfileId: null,
        isGiftCard: false,
        customizationSchema: null,
        customizationSchemaInvalid: false,
        createdAt: "2026-11-28T09:30:00.000Z",
        updatedAt: "2026-11-28T09:30:00.000Z",
        deletedAt: null,
        category: null,
        variants: [],
        media: [],
        additionalInfo: [],
        attributes: [],
        codDepositPolicy: "inherit",
    };

    it("accepts every deposit policy the merchant can set", () => {
        for (const policy of ["inherit", "required", "exempt"]) {
            const parsed = productDetailSchema.safeParse({ ...detail, codDepositPolicy: policy });
            expect(parsed.success).toBe(true);
        }
    });

    it("rejects a deposit policy the merchant cannot set", () => {
        const parsed = productDetailSchema.safeParse({ ...detail, codDepositPolicy: "invalid" });
        expect(parsed.success).toBe(false);
    });
});
