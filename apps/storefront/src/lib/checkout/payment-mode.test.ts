import { describe, expect, it } from "vitest";
import type { CheckoutConfig } from "./types";
import { resolveCheckoutPaymentRequest, resolveExplicitCheckoutPaymentRequest } from "./payment-mode";
import { CheckoutCopyError } from "./error-messages";

describe("resolveExplicitCheckoutPaymentRequest", () => {
  it("returns { paymentType: 'full' } for full", () => {
    expect(resolveExplicitCheckoutPaymentRequest("full")).toEqual({ paymentType: "full" });
  });

  it("returns { paymentType: 'balance' } for balance", () => {
    expect(resolveExplicitCheckoutPaymentRequest("balance")).toEqual({ paymentType: "balance" });
  });

  it("returns { paymentType: 'deposit', depositAmount } for deposit with valid amount", () => {
    expect(resolveExplicitCheckoutPaymentRequest("deposit", 250)).toEqual({ paymentType: "deposit", depositAmount: 250 });
  });

  it("throws CheckoutCopyError for deposit with amount 0", () => {
    expect(() => resolveExplicitCheckoutPaymentRequest("deposit", 0)).toThrow(CheckoutCopyError);
  });

  it("throws CheckoutCopyError for deposit with negative amount", () => {
    expect(() => resolveExplicitCheckoutPaymentRequest("deposit", -100)).toThrow(CheckoutCopyError);
  });

  it("throws CheckoutCopyError for deposit with NaN", () => {
    expect(() => resolveExplicitCheckoutPaymentRequest("deposit", NaN)).toThrow(CheckoutCopyError);
  });

  it("throws CheckoutCopyError for deposit with Infinity", () => {
    expect(() => resolveExplicitCheckoutPaymentRequest("deposit", Infinity)).toThrow(CheckoutCopyError);
  });

  it("throws CheckoutCopyError for deposit with undefined amount", () => {
    expect(() => resolveExplicitCheckoutPaymentRequest("deposit")).toThrow(CheckoutCopyError);
  });
});

describe("resolveCheckoutPaymentRequest", () => {
  const baseConfig: Pick<CheckoutConfig, "partialPaymentEnabled" | "partialPaymentAmount"> = {
    partialPaymentEnabled: true,
    partialPaymentAmount: 200,
  };

  it("returns deposit when partialPaymentEnabled and physical lines", () => {
    expect(resolveCheckoutPaymentRequest(baseConfig, 1000, ["ship"])).toEqual({ paymentType: "deposit", depositAmount: 200 });
  });

  it("returns full when partialPaymentEnabled and gift card lines", () => {
    expect(resolveCheckoutPaymentRequest(baseConfig, 1000, ["gift_card"])).toEqual({ paymentType: "full" });
  });

  it("returns full when partialPaymentEnabled and digital lines", () => {
    expect(resolveCheckoutPaymentRequest(baseConfig, 1000, ["digital"])).toEqual({ paymentType: "full" });
  });

  it("returns full when partialPaymentEnabled is false", () => {
    const noPartial = { ...baseConfig, partialPaymentEnabled: false };
    expect(resolveCheckoutPaymentRequest(noPartial, 1000, ["ship"])).toEqual({ paymentType: "full" });
  });

  it("returns full when deposit equals total", () => {
    const bigDeposit = { ...baseConfig, partialPaymentAmount: 1000 };
    expect(resolveCheckoutPaymentRequest(bigDeposit, 1000, ["ship"])).toEqual({ paymentType: "full" });
  });

  it("returns a deposit for physical lines before delivery is chosen", () => {
    expect(resolveCheckoutPaymentRequest(baseConfig, 1000, [null])).toEqual({ paymentType: "deposit", depositAmount: 200 });
  });

  it("returns full when empty line types", () => {
    expect(resolveCheckoutPaymentRequest(baseConfig, 1000, [])).toEqual({ paymentType: "full" });
  });
});
