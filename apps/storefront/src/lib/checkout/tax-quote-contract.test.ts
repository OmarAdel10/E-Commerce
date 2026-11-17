import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { ENGLISH_CHECKOUT_LANGUAGE_DATA } from "@scalius/shared/checkout-language";
import { parseTaxQuoteEnvelope } from "./tax-quote-contract";
import type { CheckoutConfig } from "./types";

describe("checkout quote manual COD deposit", () => {
  const quote = {
    valid: true,
    quoteFingerprint: "taxq_" + "a".repeat(22),
    displayLabel: "Tax",
    currencyCode: "BDT",
    decimalPlaces: 2,
    settingsVersion: 1,
    pricesIncludeTax: false,
    shippingTaxed: false,
    subtotalMinor: 1000,
    subtotalAmount: 10,
    shippingMinor: 0,
    shippingAmount: 0,
    discountMinor: 0,
    discountAmount: 0,
    taxMinor: 0,
    taxAmount: 0,
    totalMinor: 1000,
    totalAmount: 10,
    shippingMethod: null,
    allowedPaymentMethods: ["cod"],
    items: [{
      cartKey: "item",
      productId: "product",
      variantId: "variant",
      productName: "Product",
      variantLabel: null,
      fulfillmentType: "service",
      quantity: 1,
      unitPrice: 10,
    }],
  };
  const parse = (data: unknown) => parseTaxQuoteEnvelope({ success: true, data });

  it("preserves the server's rounded deposit and cash balance", () => {
    const split = { depositMinor: 400, balanceMinor: 600 };
    expect(parse({ ...quote, manualCodDeposit: split }).manualCodDeposit).toEqual(split);
  });

  it("continues to accept quotes from older servers", () => {
    expect(parse(quote).manualCodDeposit).toBeUndefined();
  });

  it.each([
    { depositMinor: 0, balanceMinor: 1000 },
    { depositMinor: 400, balanceMinor: 601 },
  ])("refuses invalid splits (%j)", (manualCodDeposit) => {
    expect(() => parse({ ...quote, manualCodDeposit })).toThrow();
  });

  it("refuses a deposit on a quote that disallows cash on delivery", () => {
    expect(() => parse({
      ...quote,
      allowedPaymentMethods: ["stripe"],
      manualCodDeposit: { depositMinor: 400, balanceMinor: 600 },
    })).toThrow();
  });

  it("shows the reviewed split only when the buyer selects COD", async () => {
    const window = new Window({ url: "https://store.example.test/checkout" });
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", window.document);
    try {
      const { renderOrderSummaryDetails } = await import("./index");
      const details = window.document.createElement("div");
      const reviewed = parse({ ...quote, manualCodDeposit: { depositMinor: 400, balanceMinor: 600 } });
      const config = { partialPaymentEnabled: false,
        codDeposit: { enabled: true, mode: "fixed", amount: 9, percent: 0 },
      } as CheckoutConfig;
      const copy = ENGLISH_CHECKOUT_LANGUAGE_DATA;
      renderOrderSummaryDetails(details as unknown as HTMLElement, {}, config, reviewed, "cod");
      const amountFor = (label: string) => [...details.children]
        .find((row) => row.firstElementChild?.textContent === label)?.lastElementChild?.textContent;
      expect(amountFor(copy.codDepositRequiredText)).toContain("4");
      expect(amountFor(copy.dueAtServiceText)).toContain("6");
      renderOrderSummaryDetails(details as unknown as HTMLElement, {}, config, { ...reviewed, deliveryMethodKind: "pickup" }, "cod");
      expect(amountFor(copy.dueAtPickupText)).toContain("6");

      renderOrderSummaryDetails(details as unknown as HTMLElement, {}, config, reviewed, "stripe");
      expect(amountFor(copy.codDepositRequiredText)).toBeUndefined();
      expect(amountFor(copy.dueAtServiceText)).toBeUndefined();
      expect(amountFor(copy.dueAtPickupText)).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      await window.happyDOM.close();
    }
  });
});
