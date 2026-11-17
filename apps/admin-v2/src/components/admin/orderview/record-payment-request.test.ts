import { describe, expect, it } from "vitest";
import { prepareRecordedPayment } from "./record-payment-request";

const deposit = {
  orderId: "order_1",
  orderVersion: 7,
  requestKey: "record-payment-dialog-1",
  amount: 125.35,
  decimalPlaces: 2,
  balanceDue: 360,
  isDeposit: true,
  depositAmount: 125.35,
  via: "bank_transfer",
  reference: "  transfer-14 ",
  note: "  ",
} as const;

describe("record payment dialog submission", () => {
  it("sends the exact deposit in minor units with its payment type, revision and retry key", () => {
    expect(prepareRecordedPayment(deposit)).toEqual({
      request: {
        orderId: "order_1",
        requestKey: "record-payment-dialog-1",
        amountMinor: 12535,
        via: "bank_transfer",
        paymentType: "deposit",
        reference: "transfer-14",
        expectedRevision: 7,
      },
    });
  });

  it.each([125.34, 125.36, 360])("rejects %d when the plan requires 125.35", (amount) => {
    expect(prepareRecordedPayment({ ...deposit, amount })).toEqual({
      issue: "codDeposit.amountMustMatch",
      limit: 125.35,
    });
  });

  it("requires a saved deposit amount before preparing a deposit submission", () => {
    expect(prepareRecordedPayment({ ...deposit, depositAmount: undefined }))
      .toEqual({ issue: "netTerms.amountRequired" });
  });

  it("permits an invoice part payment without the deposit type and rejects an overpayment", () => {
    expect(prepareRecordedPayment({ ...deposit, isDeposit: false, amount: 50 })).toEqual({
      request: {
        orderId: "order_1",
        requestKey: "record-payment-dialog-1",
        amountMinor: 5000,
        via: "bank_transfer",
        reference: "transfer-14",
        expectedRevision: 7,
      },
    });
    expect(prepareRecordedPayment({ ...deposit, isDeposit: false, amount: 361 })).toEqual({
      issue: "netTerms.amountTooHigh",
      limit: 360,
    });
  });
});
