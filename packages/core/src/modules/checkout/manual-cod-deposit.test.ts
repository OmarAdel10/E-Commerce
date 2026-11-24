import { describe, expect, it } from "vitest";
import { resolveManualCodDeposit, resolveCodDepositQualifyingValue, resolveCodDepositQualifyingMerchandiseMinor, resolveProductDepositPolicy } from "./manual-cod-deposit";
import type { CheckoutFlowSettings } from "../settings";
import type { PricingCurrency } from "@scalius/shared/currency-policy";
import { CASH_ON_DELIVERY_AMOUNT_REASON, COD_PAYMENT_METHOD, type PaymentProviders } from "../payments";
import { ValidationError } from "../../errors";

function providers(amountIssue: string | null = null): PaymentProviders {
  return {
    amountIssue: (_method: string, _amountMinor: number, _currency: string) => amountIssue,
  } as unknown as PaymentProviders;
}

const shopCurrency: PricingCurrency = { code: "BDT", decimalPlaces: 2, priceIncrementMinor: 100 };

const baseSettings: Pick<CheckoutFlowSettings, "codDepositEnabled" | "codDepositMode" | "codDepositAmount" | "codDepositPercent" | "codDepositInstructions" | "codDepositDefaultProductPolicy"> = {
  codDepositEnabled: true,
  codDepositMode: "fixed",
  codDepositAmount: 200,
  codDepositPercent: 0,
  codDepositInstructions: "Pay on delivery",
  codDepositDefaultProductPolicy: "all",
};

const baseQuote = { totalMinor: 100000, currencyCode: "BDT" };

const baseCart = { allowsCashOnDelivery: true, giftCardsApplied: false };

function call(
    settings: typeof baseSettings | null = baseSettings,
    quote = baseQuote,
    currency = shopCurrency,
    cart = baseCart,
    providers_ = providers(),
    qualifyingMerchandiseMinor = 100000,
) {
  return resolveManualCodDeposit(settings, quote, currency, cart, providers_, qualifyingMerchandiseMinor);
}

describe("resolveManualCodDeposit", () => {
  it("returns no terms when settings is null", () => {
    const { terms, error } = call(null, baseQuote, shopCurrency, baseCart, providers(), 100000);
    expect(terms).toBeNull();
    expect(error).toBeNull();
  });

  it("returns no terms when COD deposit is disabled", () => {
    const { terms, error } = call({ ...baseSettings, codDepositEnabled: false }, baseQuote, shopCurrency, baseCart, providers(), 100000);
    expect(terms).toBeNull();
    expect(error).toBeNull();
  });

  it("returns no terms when there is no qualifying merchandise", () => {
    const { terms, error } = call(baseSettings, baseQuote, shopCurrency, baseCart, providers(), 0);
    expect(terms).toBeNull();
    expect(error).toBeNull();
  });

  it("refuses when the cart does not allow COD", () => {
    const { terms, error } = call(baseSettings, baseQuote, shopCurrency, { ...baseCart, allowsCashOnDelivery: false }, providers(), 100000);
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("unavailable");
  });

  it("refuses when gift cards are applied", () => {
    const { terms, error } = call(baseSettings, baseQuote, shopCurrency, { ...baseCart, giftCardsApplied: true }, providers(), 100000);
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });

  it("refuses when the quote currency differs from the shop currency", () => {
    const { terms, error } = call(
      baseSettings,
      { ...baseQuote, currencyCode: "USD" },
      shopCurrency,
      baseCart,
      providers(),
      100000,
    );
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });

  it("refuses a fixed deposit of zero", () => {
    const { terms, error } = call(
      { ...baseSettings, codDepositAmount: 0 },
      baseQuote,
      shopCurrency,
      baseCart,
      providers(),
      100000,
    );
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("greater than zero");
  });

  it("refuses a fixed deposit equal to the order total", () => {
    const { terms, error } = call(
      { ...baseSettings, codDepositAmount: 1000 },
      baseQuote,
      shopCurrency,
      baseCart,
      providers(),
      100000,
    );
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("less than the order total");
  });

  it("accepts a valid fixed deposit", () => {
    const { terms, error } = call();
    expect(error).toBeNull();
    expect(terms).toMatchObject({
      depositMinor: 20000,
      balanceMinor: 80000,
      percent: null,
      instructions: "Pay on delivery",
    });
  });

  it("caps a fixed deposit at the qualifying merchandise value", () => {
    // Configured fixed 200.00 BDT (20000 minor) but only 100.00 BDT (10000 minor)
    // of qualifying merchandise: the deposit is capped at the qualifying value.
    const { terms, error } = call(
      { ...baseSettings, codDepositAmount: 200 },
      baseQuote,
      shopCurrency,
      baseCart,
      providers(),
      10000,
    );
    expect(error).toBeNull();
    expect(terms).toMatchObject({
      depositMinor: 10000,
      balanceMinor: 90000,
      percent: null,
    });
  });

  it("accepts a valid percentage deposit on the qualifying value", () => {
    const { terms, error } = call(
      { ...baseSettings, codDepositMode: "percentage", codDepositAmount: 0, codDepositPercent: 20 },
      baseQuote,
      shopCurrency,
      baseCart,
      providers(),
      100000,
    );
    expect(error).toBeNull();
    expect(terms).toMatchObject({
      depositMinor: 20000,
      balanceMinor: 80000,
      percent: 20,
      instructions: "Pay on delivery",
    });
  });

  it("calculates a percentage deposit from qualifying merchandise only, not shipping", () => {
    // Order total 1000.00 BDT of which 600.00 BDT qualifies and 400.00 BDT is
    // exempt (or shipping is excluded). 20% of 600.00 = 120.00 BDT.
    const { terms, error } = call(
      { ...baseSettings, codDepositMode: "percentage", codDepositAmount: 0, codDepositPercent: 20 },
      { totalMinor: 100000, currencyCode: "BDT" },
      shopCurrency,
      baseCart,
      providers(),
      60000,
    );
    expect(error).toBeNull();
    expect(terms).toMatchObject({
      depositMinor: 12000,
      balanceMinor: 88000,
      percent: 20,
    });
  });

  it("propagates provider amount issues with the COD reason", () => {
    const { terms, error } = call(baseSettings, baseQuote, shopCurrency, baseCart, providers("amount too low"), 100000);
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("amount too low");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((error as any).details.reason).toBe(CASH_ON_DELIVERY_AMOUNT_REASON);
  });
});

describe("resolveProductDepositPolicy", () => {
  it("required stays required", () => {
    expect(resolveProductDepositPolicy("required", "selected")).toBe("required");
    expect(resolveProductDepositPolicy("required", "all")).toBe("required");
  });
  it("exempt stays exempt", () => {
    expect(resolveProductDepositPolicy("exempt", "selected")).toBe("exempt");
    expect(resolveProductDepositPolicy("exempt", "all")).toBe("exempt");
  });
  it("inherit follows the global default", () => {
    expect(resolveProductDepositPolicy("inherit", "all")).toBe("required");
    expect(resolveProductDepositPolicy("inherit", "selected")).toBe("exempt");
    expect(resolveProductDepositPolicy(null, "all")).toBe("required");
    expect(resolveProductDepositPolicy(null, "selected")).toBe("exempt");
    expect(resolveProductDepositPolicy(undefined, "all")).toBe("required");
  });
  it("an unknown stored value fails closed with an error", () => {
    expect(() => resolveProductDepositPolicy("bogus", "all")).toThrow(ValidationError);
    expect(() => resolveProductDepositPolicy("bogus", "selected")).toThrow(ValidationError);
    expect(() => resolveProductDepositPolicy("INVALID", "all")).toThrow(ValidationError);
    expect(() => resolveProductDepositPolicy("", "all")).toThrow(ValidationError);
  });
  it("rejects unknown policy values with a descriptive message", () => {
    expect(() => resolveProductDepositPolicy("bogus", "all")).toThrow(
      "Invalid manual COD deposit policy: bogus. Expected inherit, required or exempt.",
    );
  });
});

describe("resolveCodDepositQualifyingValue", () => {
  const policies = new Map<string, string | null>([
    ["prod_required", "required"],
    ["prod_exempt", "exempt"],
    ["prod_inherit", "inherit"],
    ["prod_missing", null],
  ]);

  it("sums only required-products after their own discount, excluding gift cards", () => {
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_required", quantity: 2, unitPriceMinor: 10000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 }, // 20000
        { productId: "prod_exempt", quantity: 10, unitPriceMinor: 10000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },  // 0 (exempt)
        { productId: "prod_inherit", quantity: 1, unitPriceMinor: 5000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },   // 0 (inherit + selected => exempt)
        { productId: "prod_giftcard", quantity: 1, unitPriceMinor: 50000, isGiftCard: true, discountMinor: 0, bundleDiscountMinor: 0 },   // 0 (gift card)
      ],
      policies,
      "selected",
    );
    expect(value).toBe(20000);
  });

  it("reduce qualifying value by order-level discount on qualifying line", () => {
    // 2 units @ 10000 = 20000 gross, 3000 order-level discount → 17000 qualifying
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_required", quantity: 2, unitPriceMinor: 10000, isGiftCard: false, discountMinor: 3000, bundleDiscountMinor: 0 },
      ],
      policies,
      "all",
    );
    expect(value).toBe(17000);
  });

  it("reduce qualifying value by bundle discount on qualifying line", () => {
    // 1 unit @ 10000 = 10000 gross, 2000 bundle discount → 8000 qualifying
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_required", quantity: 1, unitPriceMinor: 10000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 2000 },
      ],
      policies,
      "all",
    );
    expect(value).toBe(8000);
  });

  it("does not go negative when discounts exceed line value", () => {
    // 1 unit @ 10000 = 10000 gross, 15000 combined discounts → 0 qualifying (not negative)
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_required", quantity: 1, unitPriceMinor: 10000, isGiftCard: false, discountMinor: 10000, bundleDiscountMinor: 5000 },
      ],
      policies,
      "all",
    );
    expect(value).toBe(0);
  });

  it("inherit products require a deposit when the global default is all", () => {
    const value = resolveCodDepositQualifyingValue(
      [{ productId: "prod_inherit", quantity: 1, unitPriceMinor: 7000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 }],
      policies,
      "all",
    );
    expect(value).toBe(7000);
  });

  it("inherit products do not require a deposit when the global default is selected", () => {
    const value = resolveCodDepositQualifyingValue(
      [{ productId: "prod_inherit", quantity: 1, unitPriceMinor: 7000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 }],
      policies,
      "selected",
    );
    expect(value).toBe(0);
  });

  it("treats a product with no stored policy as inherit", () => {
    const value = resolveCodDepositQualifyingValue(
      [{ productId: "prod_missing", quantity: 3, unitPriceMinor: 4000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 }],
      policies,
      "all",
    );
    expect(value).toBe(12000);
  });

  it("returns zero for an empty cart", () => {
    expect(resolveCodDepositQualifyingValue([], policies, "all")).toBe(0);
  });

  it("exempt products contribute zero even with discounts", () => {
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_exempt", quantity: 5, unitPriceMinor: 10000, isGiftCard: false, discountMinor: 1000, bundleDiscountMinor: 0 },
      ],
      policies,
      "all",
    );
    expect(value).toBe(0);
  });

  it("EGP example: 30% deposit on qualifying merchandise after discounts", () => {
    // Required product: 500 EGP, exempt products: 400 EGP + 100 EGP.
    // No discounts, taxes or shipping.
    // Qualifying merchandise: 500 EGP. Deposit: 30% of 500 = 150 EGP.
    const egpPolicies = new Map<string, string | null>([
      ["prod_required_egp", "required"],
      ["prod_exempt_1", "exempt"],
      ["prod_exempt_2", "exempt"],
    ]);
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_required_egp", quantity: 1, unitPriceMinor: 50000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },
        { productId: "prod_exempt_1", quantity: 1, unitPriceMinor: 40000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },
        { productId: "prod_exempt_2", quantity: 1, unitPriceMinor: 10000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },
      ],
      egpPolicies,
      "all",
    );
    expect(value).toBe(50000); // 500 EGP in minor units
  });

  it("order-level discount allocated proportionally to qualifying product", () => {
    // Required merchandise: 500 EGP, exempt merchandise: 500 EGP.
    // Order-wide discount: 20%, allocated proportionally.
    // Required product's share of discount: 20% of 500 = 100 EGP.
    // Qualifying merchandise after discount: 400 EGP.
    // Deposit percentage: 30% → 120 EGP deposit.
    const egpPolicies = new Map<string, string | null>([
      ["prod_required", "required"],
      ["prod_exempt", "exempt"],
    ]);
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_required", quantity: 1, unitPriceMinor: 50000, isGiftCard: false, discountMinor: 10000, bundleDiscountMinor: 0 },
        { productId: "prod_exempt", quantity: 1, unitPriceMinor: 50000, isGiftCard: false, discountMinor: 10000, bundleDiscountMinor: 0 },
      ],
      egpPolicies,
      "all",
    );
    expect(value).toBe(40000); // 400 EGP qualifying after discount
  });

  it("order-level discount on exempt product does not reduce qualifying subtotal", () => {
    // Required product: 500 EGP (no discount).
    // Exempt product: 500 EGP with 20% discount (100 EGP off).
    // Qualifying merchandise: still 500 EGP (exempt product's discount doesn't count).
    const egpPolicies = new Map<string, string | null>([
      ["prod_required", "required"],
      ["prod_exempt", "exempt"],
    ]);
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_required", quantity: 1, unitPriceMinor: 50000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },
        { productId: "prod_exempt", quantity: 1, unitPriceMinor: 50000, isGiftCard: false, discountMinor: 10000, bundleDiscountMinor: 0 },
      ],
      egpPolicies,
      "all",
    );
    expect(value).toBe(50000); // Only the required product counts
  });

  it("discounts on qualifying product are not double-counted", () => {
    // Required product: 1000 EGP gross.
    // Product-specific discount: 200 EGP.
    // Order-level discount allocated to same line: 100 EGP.
    // Combined discount on line: 300 EGP → qualifying: 700 EGP.
    const egpPolicies = new Map<string, string | null>([
      ["prod_required", "required"],
    ]);
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_required", quantity: 1, unitPriceMinor: 100000, isGiftCard: false, discountMinor: 30000, bundleDiscountMinor: 0 },
      ],
      egpPolicies,
      "all",
    );
    expect(value).toBe(70000); // 100000 - 30000 = 70000
  });

  it("multiple quantities of same product with discount allocation", () => {
    // Required product: 3 units @ 200 EGP = 600 EGP gross.
    // Order-level discount: 120 EGP allocated to this line.
    // Qualifying: 480 EGP. Deposit 30% → 144 EGP.
    const egpPolicies = new Map<string, string | null>([
      ["prod_required", "required"],
    ]);
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_required", quantity: 3, unitPriceMinor: 20000, isGiftCard: false, discountMinor: 12000, bundleDiscountMinor: 0 },
      ],
      egpPolicies,
      "all",
    );
    expect(value).toBe(48000); // 60000 - 12000 = 48000
  });

  it("zero-priced qualifying product contributes zero", () => {
    const egpPolicies = new Map<string, string | null>([
      ["prod_required", "required"],
    ]);
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_required", quantity: 5, unitPriceMinor: 0, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },
      ],
      egpPolicies,
      "all",
    );
    expect(value).toBe(0);
  });

  it("fully discounted qualifying product contributes zero", () => {
    const egpPolicies = new Map<string, string | null>([
      ["prod_required", "required"],
    ]);
    const value = resolveCodDepositQualifyingValue(
      [
        { productId: "prod_required", quantity: 1, unitPriceMinor: 10000, isGiftCard: false, discountMinor: 10000, bundleDiscountMinor: 0 },
      ],
      egpPolicies,
      "all",
    );
    expect(value).toBe(0);
  });

  it("rejects negative unit price for a required product", () => {
    const policies = new Map<string, string | null>([
      ["prod_required", "required"],
    ]);
    expect(() => {
      resolveCodDepositQualifyingValue(
        [
          { productId: "prod_required", quantity: 1, unitPriceMinor: -5000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },
        ],
        policies,
        "all",
      );
    }).toThrow(ValidationError);
  });

  it("rejects invalid quantity for a required product", () => {
    const policies = new Map<string, string | null>([
      ["prod_required", "required"],
    ]);
    expect(() => {
      resolveCodDepositQualifyingValue(
        [
          { productId: "prod_required", quantity: 0, unitPriceMinor: 10000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },
        ],
        policies,
        "all",
      );
    }).toThrow(ValidationError);
  });

  it("rejects Infinity unit price for a required product", () => {
    const policies = new Map<string, string | null>([
      ["prod_required", "required"],
    ]);
    expect(() => {
      resolveCodDepositQualifyingValue(
        [
          { productId: "prod_required", quantity: 1, unitPriceMinor: Infinity, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },
        ],
        policies,
        "all",
      );
    }).toThrow(ValidationError);
  });

  it("rejects NaN qualifying merchandise value", () => {
    const { terms, error } = resolveManualCodDeposit(
      baseSettings,
      { totalMinor: 100000, currencyCode: "BDT" },
      shopCurrency,
      baseCart,
      providers(),
      NaN,
    );
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain("invalid qualifying merchandise value");
  });

  it("rejects Infinity qualifying merchandise value", () => {
    const { terms, error } = resolveManualCodDeposit(
      baseSettings,
      { totalMinor: 100000, currencyCode: "BDT" },
      shopCurrency,
      baseCart,
      providers(),
      Infinity,
    );
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain("invalid qualifying merchandise value");
  });

  it("rejects negative qualifying merchandise value", () => {
    const { terms, error } = resolveManualCodDeposit(
      baseSettings,
      { totalMinor: 100000, currencyCode: "BDT" },
      shopCurrency,
      baseCart,
      providers(),
      -5000,
    );
    expect(terms).toBeNull();
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain("invalid qualifying merchandise value");
  });

  it("zero qualifying merchandise is legitimate (normal COD)", () => {
    const { terms, error } = resolveManualCodDeposit(
      baseSettings,
      { totalMinor: 100000, currencyCode: "BDT" },
      shopCurrency,
      baseCart,
      providers(),
      0,
    );
    expect(terms).toBeNull();
    expect(error).toBeNull();
  });

  it("preserves originalAmountMinor when fixed deposit is capped", () => {
    // Configured fixed: 200.00 BDT (20000 minor), qualifying: 100.00 BDT (10000 minor)
    // Deposit capped at 10000, but originalAmountMinor should be 20000
    const { terms, error } = resolveManualCodDeposit(
      { ...baseSettings, codDepositAmount: 200 },
      { totalMinor: 100000, currencyCode: "BDT" },
      shopCurrency,
      baseCart,
      providers(),
      10000,
    );
    expect(error).toBeNull();
    expect(terms).toMatchObject({
      depositMinor: 10000,
      balanceMinor: 90000,
      originalAmountMinor: 20000,
    });
  });

  it("preserves originalAmountMinor when fixed deposit is not capped", () => {
    // Configured fixed: 200.00 BDT (20000 minor), qualifying: 500.00 BDT (50000 minor)
    // Deposit is 20000, originalAmountMinor should also be 20000
    const { terms, error } = resolveManualCodDeposit(
      { ...baseSettings, codDepositAmount: 200 },
      { totalMinor: 100000, currencyCode: "BDT" },
      shopCurrency,
      baseCart,
      providers(),
      50000,
    );
    expect(error).toBeNull();
    expect(terms).toMatchObject({
      depositMinor: 20000,
      balanceMinor: 80000,
      originalAmountMinor: 20000,
    });
  });

  it("missing product policy fails closed", () => {
    const policies = new Map<string, string | null>([
      ["prod_required", "required"],
    ]);
    // prod_unknown is in the cart but not in the policy map
    expect(() => {
      resolveCodDepositQualifyingValue(
        [
          { productId: "prod_required", quantity: 1, unitPriceMinor: 10000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },
          { productId: "prod_unknown", quantity: 1, unitPriceMinor: 5000, isGiftCard: false, discountMinor: 0, bundleDiscountMinor: 0 },
        ],
        policies,
        "all",
      );
    }).toThrow(ValidationError);
  });

  it("invalid global default product policy fails closed", () => {
    // "bogus" is not a valid global default product policy
    expect(() => {
      resolveProductDepositPolicy("inherit", "bogus" as "all" | "selected");
    }).toThrow(ValidationError);
  });
});

describe("resolveCodDepositQualifyingMerchandiseMinor", () => {
  const quoteLines = [
    { lineId: "cart:0:var_default_prod_required", discountMinor: 0 },
    { lineId: "cart:1:var_default_prod_exempt", discountMinor: 0 },
    { lineId: "cart:2:var_default_prod_required", discountMinor: 3000 },
  ];
  const policies = new Map<string, string | null>([
    ["prod_required", "required"],
    ["prod_exempt", "exempt"],
  ]);
  const cartItems = [
    { index: 0, productId: "prod_required", variantId: "var_default_prod_required", quantity: 2, unitPriceMinor: 10000, isGiftCard: false },
    { index: 1, productId: "prod_exempt", variantId: "var_default_prod_exempt", quantity: 1, unitPriceMinor: 10000, isGiftCard: false },
    { index: 2, productId: "prod_required", variantId: "var_default_prod_required", quantity: 1, unitPriceMinor: 10000, isGiftCard: false, bundleDiscountMinor: 2000 },
  ];

  it("sums qualifying merchandise after per-line quote discounts and bundle savings", () => {
    // line 0: 2 x 10000 = 20000 (required); line 1 exempt -> 0;
    // line 2: 1 x 10000 - 3000 quote discount - 2000 bundle = 5000 (required)
    const value = resolveCodDepositQualifyingMerchandiseMinor({
      quoteLines, cartItems, productPolicyById: policies, globalDefaultProductPolicy: "all",
    });
    expect(value).toBe(25000);
  });

  it("excludes gift card lines from the qualifying basis", () => {
    const items = [...cartItems, { index: 3, productId: "prod_gc", variantId: "var_default_prod_gc", quantity: 1, unitPriceMinor: 50000, isGiftCard: true }];
    const lines = [...quoteLines, { lineId: "cart:3:var_default_prod_gc", discountMinor: 0 }];
    const value = resolveCodDepositQualifyingMerchandiseMinor({
      quoteLines: lines, cartItems: items, productPolicyById: policies, globalDefaultProductPolicy: "all",
    });
    expect(value).toBe(25000);
  });

  it("treats a line with no discount as a legitimate zero discount", () => {
    const value = resolveCodDepositQualifyingMerchandiseMinor({
      quoteLines: [{ lineId: "cart:0:var_default_prod_required", discountMinor: 0 }],
      cartItems: [{ index: 0, productId: "prod_required", variantId: "var_default_prod_required", quantity: 1, unitPriceMinor: 10000, isGiftCard: false }],
      productPolicyById: policies,
      globalDefaultProductPolicy: "all",
    });
    expect(value).toBe(10000);
  });

  it("fails closed when a cart line has no authoritative quote allocation", () => {
    // The cart has a line the quote does not cover: inconsistent pricing data.
    expect(() => resolveCodDepositQualifyingMerchandiseMinor({
      quoteLines: [{ lineId: "cart:0:var_default_prod_required", discountMinor: 0 }],
      cartItems: [{ index: 5, productId: "prod_required", variantId: "var_default_prod_required", quantity: 1, unitPriceMinor: 10000, isGiftCard: false }],
      productPolicyById: policies,
      globalDefaultProductPolicy: "all",
    })).toThrow(ValidationError);
  });

  it("fails closed when a cart line's product has no authoritative policy", () => {
    expect(() => resolveCodDepositQualifyingMerchandiseMinor({
      quoteLines: [{ lineId: "cart:0:var_default_prod_unknown", discountMinor: 0 }],
      cartItems: [{ index: 0, productId: "prod_unknown", variantId: "var_default_prod_unknown", quantity: 1, unitPriceMinor: 10000, isGiftCard: false }],
      productPolicyById: new Map([["prod_required", "required"]]),
      globalDefaultProductPolicy: "all",
    })).toThrow(ValidationError);
  });

  it("returns zero for an empty cart", () => {
    expect(resolveCodDepositQualifyingMerchandiseMinor({
      quoteLines: [], cartItems: [], productPolicyById: policies, globalDefaultProductPolicy: "all",
    })).toBe(0);
  });
});
