import { describe, expect, it } from "vitest";
import { buildOrderPaymentPresentation } from "./order-payment-presentation";

const pending = {
  orderStatus: "pending",
  paymentMethod: "cod",
  balanceDue: 350,
  paymentPlan: { kind: "manual", status: "pending", depositAmount: 100 },
  canRecordPayment: true,
};

describe("manual COD deposit affordance", () => {
  it("offers the exact required deposit to staff who can record payments", () => {
    expect(buildOrderPaymentPresentation(pending).manualCodDeposit).toEqual({
      status: "pending", amount: 100, canRecord: true,
    });
  });

  it.each([
    { orderStatus: "cancelled" },
    { orderStatus: "refunded" },
    { orderStatus: "returned" },
    { archived: true },
    { paymentMethod: "stripe" },
    { paymentPlan: { ...pending.paymentPlan, kind: "online" } },
    { paymentPlan: { ...pending.paymentPlan, status: "cancelled" } },
    { paymentPlan: null },
  ])("hides the manual deposit prompt for %o", (change) => {
    expect(buildOrderPaymentPresentation({ ...pending, ...change }).manualCodDeposit).toBeNull();
  });

  it.each([{ canRecordPayment: false }, { refundLocked: true }])(
    "shows the pending requirement without a record action for %o",
    (change) => {
      expect(buildOrderPaymentPresentation({ ...pending, ...change }).manualCodDeposit)
        .toEqual({ status: "pending", amount: 100, canRecord: false });
    },
  );

  it("shows a received deposit without offering a second collection", () => {
    expect(buildOrderPaymentPresentation({
      ...pending,
      paymentPlan: { ...pending.paymentPlan, status: "deposit_paid" },
    }).manualCodDeposit).toEqual({ status: "received" });
  });
});
