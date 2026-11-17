import { describe, expect, it } from "vitest";
import { presentOrderListFacts } from "./shared";
import { PaymentMethod, PaymentPlanStatus, PaymentRecordStatus, PaymentStatus } from "@scalius/database/schema";

function baseOrder(): ReturnType<typeof presentOrderListFacts> extends { currencyCode: infer C } ? { currencyCode: C } : never {
  return {
    orderNumber: 1001,
    listCurrencyCode: "BDT",
    archivedAt: null,
    channel: "online",
    channelSource: null,
    salesChannelId: "web",
    openRequestType: null,
    onHold: 0,
    cod: null,
    refundDue: "0.00",
    refundedAmount: "0.00",
    requiresShipping: true,
    shippingMethodKind: "delivery",
    pickupReadyAt: null,
    paymentMethod: PaymentMethod.COD,
    paidAmountMinor: 3000,
    currencyDecimalPlaces: 2,
  } as never;
}

describe("presentOrderListFacts — hasUnverifiedManualDeposit", () => {
  it("is true for COD with a pending manual deposit plan", () => {
    const order = { ...baseOrder(), paymentPlanKind: "manual", paymentPlanStatus: PaymentPlanStatus.PENDING } as never;
    const facts = presentOrderListFacts(order);
    expect(facts.hasUnverifiedManualDeposit).toBe(true);
  });

  it("is true for COD with a cancelled manual deposit plan", () => {
    const order = { ...baseOrder(), paymentPlanKind: "manual", paymentPlanStatus: PaymentPlanStatus.CANCELLED } as never;
    const facts = presentOrderListFacts(order);
    expect(facts.hasUnverifiedManualDeposit).toBe(true);
  });

  it("is false for COD with a deposit_paid manual plan", () => {
    const order = { ...baseOrder(), paymentPlanKind: "manual", paymentPlanStatus: "deposit_paid" as const } as never;
    const facts = presentOrderListFacts(order);
    expect(facts.hasUnverifiedManualDeposit).toBe(false);
  });

  it("is false for COD with no payment plan", () => {
    const order = { ...baseOrder(), paymentPlanKind: null, paymentPlanStatus: null } as never;
    const facts = presentOrderListFacts(order);
    expect(facts.hasUnverifiedManualDeposit).toBe(false);
  });

  it("is false for a non-COD order with a manual plan", () => {
    const order = { ...baseOrder(), paymentMethod: PaymentMethod.STRIPE, paymentPlanKind: "manual", paymentPlanStatus: PaymentPlanStatus.PENDING } as never;
    const facts = presentOrderListFacts(order);
    expect(facts.hasUnverifiedManualDeposit).toBe(false);
  });

  it("is false for COD with a completed plan", () => {
    const order = { ...baseOrder(), paymentPlanKind: "manual", paymentPlanStatus: "completed" as const } as never;
    const facts = presentOrderListFacts(order);
    expect(facts.hasUnverifiedManualDeposit).toBe(false);
  });

  it("computes refundDue correctly", () => {
    const order = {
      ...baseOrder(),
      paymentMethod: PaymentMethod.COD,
      paidAmountMinor: 5000,
      refundedMinor: 1000,
    } as never;
    const facts = presentOrderListFacts(order);
    expect(facts.refundedAmount).toBe(10);
  });

  it("handles cod tracking state", () => {
    const order = {
      ...baseOrder(),
      codStatus: "pending",
      codDeliveryAttempts: 1,
    } as never;
    const facts = presentOrderListFacts(order);
    expect(facts.cod).toEqual({ status: "pending", deliveryAttempts: 1 });
  });
});
