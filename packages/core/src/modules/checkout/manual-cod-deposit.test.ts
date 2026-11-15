import { describe, expect, it } from "vitest";
import { resolveManualCodDeposit } from "./manual-cod-deposit";
import type { CheckoutFlowSettings } from "../settings";
import type { PricingCurrency } from "@scalius/shared/currency-policy";
import { CASH_ON_DELIVERY_AMOUNT_REASON, COD_PAYMENT_METHOD, type PaymentProviders } from "../payments";

function providers(amountIssue: string | null = null): PaymentProviders {
  return {
    amountIssue: (_method: string, _amountMinor: number, _currency: string) => amountIssue,
  } as unknown as PaymentProviders;
}

const shopCurrency: PricingCurrency = { code: "BDT", decimalPlaces: 2, priceIncrementMinor: 100 };

const baseSettings: Pick<CheckoutFlowSettings, "codDepositEnabled" | "codDepositMode" | "codDepositAmount" | "codDepositPercent" | "codDepositInstructions"> = {
  codDepositEnabled: true,
  codDepositMode: "fixed",
  codDepositAmount: 200,
  codDepositPercent: 0,
  codDepositInstructions: "Pay on delivery",
};

const baseQuote = { totalMinor: 100000, currencyCode: "BDT" };

const baseCart = { allowsCashOnDelivery: true, giftCardsApplied: false };

describe("resolveManualCodDeposit", () => {
  it("returns no terms when settings is null", () => {
    const { terms, error } = resolveManualCodDeposit(null, baseQuote, shopCurrency, baseCart, providers());
    expect(terms).toBeNull();
    expect(error).toBeNull();
  });

  it("returns no terms when COD deposit is disabled", () => {
    const { terms, error } = resolveManualCodDeposit({ ...baseSettings, codDepositEnabled: false }, baseQuote, shopCurrency, baseCart, providers());
    expect(terms).toBeNull();
    expect(error).toBeNull();
  });

  it("refuses when the cart does not allow COD", () => {
    const { terms, error } = resolveManualCodDeposit(baseSettings, baseQuote, shopCurrency, { ...baseCart, allowsCashOnDelivery: false }, providers());
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("unavailable");
  });

  it("refuses when gift cards are applied", () => {
    const { terms, error } = resolveManualCodDeposit(baseSettings, baseQuote, shopCurrency, { ...baseCart, giftCardsApplied: true }, providers());
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });

  it("refuses when the quote currency differs from the shop currency", () => {
    const { terms, error } = resolveManualCodDeposit(
      baseSettings,
      { ...baseQuote, currencyCode: "USD" },
      shopCurrency,
      baseCart,
      providers(),
    );
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });

  it("refuses a fixed deposit of zero", () => {
    const { terms, error } = resolveManualCodDeposit(
      { ...baseSettings, codDepositAmount: 0 },
      baseQuote,
      shopCurrency,
      baseCart,
      providers(),
    );
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("greater than zero");
  });

  it("refuses a fixed deposit equal to the order total", () => {
    const { terms, error } = resolveManualCodDeposit(
      { ...baseSettings, codDepositAmount: 1000 },
      baseQuote,
      shopCurrency,
      baseCart,
      providers(),
    );
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("less than the order total");
  });

  it("accepts a valid fixed deposit", () => {
    const { terms, error } = resolveManualCodDeposit(baseSettings, baseQuote, shopCurrency, baseCart, providers());
    expect(error).toBeNull();
    expect(terms).toMatchObject({
      depositMinor: 20000,
      balanceMinor: 80000,
      percent: null,
      instructions: "Pay on delivery",
    });
  });

  it("accepts a valid percentage deposit", () => {
    const { terms, error } = resolveManualCodDeposit(
      { ...baseSettings, codDepositMode: "percentage", codDepositAmount: 0, codDepositPercent: 20 },
      baseQuote,
      shopCurrency,
      baseCart,
      providers(),
    );
    expect(error).toBeNull();
    expect(terms).toMatchObject({
      depositMinor: 20000,
      balanceMinor: 80000,
      percent: 20,
      instructions: "Pay on delivery",
    });
  });

  it("propagates provider amount issues with the COD reason", () => {
    const { terms, error } = resolveManualCodDeposit(baseSettings, baseQuote, shopCurrency, baseCart, providers("amount too low"));
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("amount too low");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((error as any).details.reason).toBe(CASH_ON_DELIVERY_AMOUNT_REASON);
  });
});
