import { describe, expect, it } from "vitest";
import { manualCodPercentageDepositMinor, isDepositPaymentRequired } from "./checkout-payment";
import type { FulfillmentType } from "./fulfilment";

describe("manualCodPercentageDepositMinor", () => {
  const incrementMinor = 100;

  it("rounds up to the pricing increment", () => {
    // 20% of 10000 = 2000, already on increment
    expect(manualCodPercentageDepositMinor(10000, 20, incrementMinor)).toBe(2000);
  });

  it("rounds up when not on the increment", () => {
    // 10005 * 15% = 1500.75, /100 = 15.0075, ceil = 16, *100 = 1600
    expect(manualCodPercentageDepositMinor(10005, 15, incrementMinor)).toBe(1600);
  });

  it("returns 0 for 0 percent", () => {
    expect(manualCodPercentageDepositMinor(10000, 0, incrementMinor)).toBe(0);
  });

  it("returns total minus one increment for 99 percent", () => {
    // 99% of 10000 = 9900, rounded up to 9900 (on increment), but 9900 < 10000 so no adjustment
    expect(manualCodPercentageDepositMinor(10000, 99, incrementMinor)).toBe(9900);
  });

  it("subtracts one increment when rounded would equal or exceed total", () => {
    // 100% of 10000 = 10000, but deposit must be less than total → 9900
    expect(manualCodPercentageDepositMinor(10000, 100, incrementMinor)).toBe(9900);
  });

  it("handles small totals with rounding", () => {
    // 50% of 150 = 75, rounded up to 100 (increment of 100), but 100 < 150
    expect(manualCodPercentageDepositMinor(150, 50, incrementMinor)).toBe(100);
  });

  it("uses minimum step of 1 when incrementMinor is 0", () => {
    // incrementMinor = 0 → step = 1, so no rounding beyond integer
    expect(manualCodPercentageDepositMinor(10000, 25, 0)).toBe(2500);
  });
});

describe("isDepositPaymentRequired", () => {
  const codLines: (FulfillmentType | null)[] = ["ship"];

  it("returns false when partial payment disabled", () => {
    expect(isDepositPaymentRequired({ partialPaymentEnabled: false, partialPaymentAmount: 5000 }, 10000, codLines)).toBe(false);
  });

  it("returns false when deposit amount is zero", () => {
    expect(isDepositPaymentRequired({ partialPaymentEnabled: true, partialPaymentAmount: 0 }, 10000, codLines)).toBe(false);
  });

  it("returns false when deposit equals or exceeds total", () => {
    expect(isDepositPaymentRequired({ partialPaymentEnabled: true, partialPaymentAmount: 10000 }, 10000, codLines)).toBe(false);
    expect(isDepositPaymentRequired({ partialPaymentEnabled: true, partialPaymentAmount: 15000 }, 10000, codLines)).toBe(false);
  });

  it("returns true when partial payment enabled with valid deposit and COD lines", () => {
    expect(isDepositPaymentRequired({ partialPaymentEnabled: true, partialPaymentAmount: 3000 }, 10000, codLines)).toBe(true);
  });

  it("returns false when COD not allowed (digital lines)", () => {
    expect(isDepositPaymentRequired({ partialPaymentEnabled: true, partialPaymentAmount: 3000 }, 10000, ["digital"])).toBe(false);
  });
});
