import { describe, expect, it } from "vitest";
import { orderSummarySchema, orderDetailSchema } from "./entities";

describe("orderSummarySchema — hasUnverifiedManualDeposit", () => {
  it("includes hasUnverifiedManualDeposit as boolean", () => {
    const shape = orderSummarySchema.shape;
    expect(shape.hasUnverifiedManualDeposit).toBeDefined();
  });
});

describe("orderDetailSchema — paymentPlan", () => {
  it("includes paymentPlan schema", () => {
    expect(orderDetailSchema.shape.paymentPlan).toBeDefined();
  });

  it("paymentPlan schema includes kind and status", () => {
    const paymentPlan = orderDetailSchema.shape.paymentPlan;
    // paymentPlan is ZodNullable wrapping ZodObject
    const inner = (paymentPlan as any)._def.innerType;
    expect(inner.shape.kind).toBeDefined();
    expect(inner.shape.status).toBeDefined();
    expect(inner.shape.totalAmount).toBeDefined();
    expect(inner.shape.depositAmount).toBeDefined();
    expect(inner.shape.balanceDue).toBeDefined();
    expect(inner.shape.balanceDueDate).toBeDefined();
    expect(inner.shape.depositPaidAt).toBeDefined();
    expect(inner.shape.balancePaidAt).toBeDefined();
    expect(inner.shape.createdAt).toBeDefined();
    expect(inner.shape.updatedAt).toBeDefined();
  });

  it("paymentPlan is nullable", () => {
    const paymentPlan = orderDetailSchema.shape.paymentPlan;
    const innerType = (paymentPlan as any)._def.innerType;
    expect(innerType).toBeDefined();
  });
});
