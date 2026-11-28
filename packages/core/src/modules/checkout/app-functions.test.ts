// Unit tests for resolveAppDiscounts: app discounts combined with platform discounts.
import { describe, expect, it } from "vitest";
import { resolveAppDiscounts, combineDiscountAllocations } from "./app-functions";
import type { CheckoutAppFunctionResult } from "./app-functions";
import type { PluginFunctionOutput } from "@scalius/shared/plugins";
import { resolveCodDepositQualifyingMerchandiseMinor, resolveManualCodDeposit } from "./manual-cod-deposit";
import type { CheckoutFlowSettings } from "../settings";
import type { PricingCurrency } from "@scalius/shared/currency-policy";
import { COD_PAYMENT_METHOD, type PaymentProviders } from "../payments";
import { buildStorefrontTaxAllocationLineId } from "../tax";

const shopCurrency: PricingCurrency = { code: "BDT", decimalPlaces: 2, priceIncrementMinor: 100 };

const baseSettings: Pick<CheckoutFlowSettings, "codDepositEnabled" | "codDepositMode" | "codDepositAmount" | "codDepositPercent" | "codDepositInstructions" | "codDepositDefaultProductPolicy"> = {
  codDepositEnabled: true,
  codDepositMode: "percentage",
  codDepositAmount: 0,
  codDepositPercent: 25,
  codDepositInstructions: "Pay on delivery",
  codDepositDefaultProductPolicy: "all",
};

const baseCart = { allowsCashOnDelivery: true, giftCardsApplied: false };

function providers(amountIssue: string | null = null): PaymentProviders {
  return {
    amountIssue: (_method: string, _amountMinor: number, _currency: string) => amountIssue,
  } as unknown as PaymentProviders;
}

function appResult(discounts: unknown[]): CheckoutAppFunctionResult<"checkout.discounts"> {
  return {
    pluginId: "app_discount",
    appName: "App Discount",
    priority: 0,
    output: { discounts } as PluginFunctionOutput<"checkout.discounts">,
    commits: [],
  };
}

describe("resolveAppDiscounts — app discounts combined with platform discounts", () => {
  const lineId = "line:0";
  const currencyCode = "BDT";
  const priceIncrementMinor = 100;
  const grossMinor = 30000;

  it("platform order discount + app line discount: app takes what is left after platform", () => {
    // Platform: 20% off order = 6000 on 30000 gross. Line remaining: 24000.
    // App: 10% off line (product class) = 2400 of remaining.
    // Combined: 6000 + 2400 = 8400 off the line.
    const platformDiscountMinor = 6000;
    const appDiscountMinor = 2400;

    const resolution = resolveAppDiscounts({
      currencyCode,
      priceIncrementMinor,
      lines: [{ lineId, grossMinor, platformDiscountMinor, giftCard: false }],
      shippingMinor: 0,
      platformShippingDiscountMinor: 0,
      submittedCodes: [],
      results: [appResult([{
        title: "App 10% line discount",
        target: { kind: "lines", lineIds: [lineId] },
        value: { type: "percentage", percent: 10 },
        combinesWith: { product: true, order: true, shipping: true },
      }])],
      platformClasses: ["order"],
    });

    expect(resolution.applied).toHaveLength(1);
    expect(resolution.applied[0]!.lines).toEqual([{ lineId, amountMinor: appDiscountMinor }]);
    expect(resolution.applied[0]!.amountMinor).toBe(appDiscountMinor);
    expect(resolution.merchandiseMinor).toBe(appDiscountMinor);
    expect(resolution.claimedCodes).toEqual([]);
  });

  it("platform order discount + app order discount: both order class combine", () => {
    // Platform: 20% off order = 6000 on 30000 gross.
    // App: 10% off order = 2400 of remaining (both order class).
    // Combined: 6000 + 2400 = 8400.
    const platformDiscountMinor = 6000;

    const resolution = resolveAppDiscounts({
      currencyCode,
      priceIncrementMinor,
      lines: [{ lineId, grossMinor, platformDiscountMinor, giftCard: false }],
      shippingMinor: 0,
      platformShippingDiscountMinor: 0,
      submittedCodes: [],
      results: [appResult([{
        title: "App 10% order discount",
        target: { kind: "order" },
        value: { type: "percentage", percent: 10 },
      }])],
      platformClasses: ["order"],
    });

    expect(resolution.applied).toHaveLength(1);
    expect(resolution.applied[0]!.amountMinor).toBe(2400);
    expect(resolution.merchandiseMinor).toBe(2400);
  });

  it("app discount that does not combine with platform's class is skipped", () => {
    // Platform: 20% off order (order class). App: 10% off lines with combinesWith.order = false.
    // App discount is skipped because it doesn't combine with order class.
    const platformDiscountMinor = 6000;

    const resolution = resolveAppDiscounts({
      currencyCode,
      priceIncrementMinor,
      lines: [{ lineId, grossMinor, platformDiscountMinor, giftCard: false }],
      shippingMinor: 0,
      platformShippingDiscountMinor: 0,
      submittedCodes: [],
      results: [appResult([{
        title: "App 10% line discount (no order combine)",
        target: { kind: "lines", lineIds: [lineId] },
        value: { type: "percentage", percent: 10 },
        combinesWith: { order: false },
      }])],
      platformClasses: ["order"],
    });

    expect(resolution.applied).toHaveLength(0);
    expect(resolution.merchandiseMinor).toBe(0);
  });
});

describe("combined platform + app discount through COD deposit pipeline", () => {
  const lineId = buildStorefrontTaxAllocationLineId(0, "v");
  const currencyCode = "BDT";
  const priceIncrementMinor = 100;
  const grossMinor = 30000;
  const shippingMinor = 6000;

  it("platform 20% order discount + app 10% line discount: combined reduces deposit basis", () => {
    // Platform: 20% off order = 6000 on 30000 gross.
    // App: 10% off line on remaining 24000 = 2400.
    // Combined: 8400 off the line.
    // Qualifying merchandise = 30000 - 8400 = 21600.
    // Deposit 25% = 5400. Balance = 30000 + 6000 - 5400 = 30600.
    const platformDiscountMinor = 6000;
    const appDiscountMinor = 2400;

    const resolution = resolveAppDiscounts({
      currencyCode,
      priceIncrementMinor,
      lines: [{ lineId, grossMinor, platformDiscountMinor, giftCard: false }],
      shippingMinor,
      platformShippingDiscountMinor: 0,
      submittedCodes: [],
      results: [appResult([{
        title: "App 10% line discount",
        target: { kind: "lines", lineIds: [lineId] },
        value: { type: "percentage", percent: 10 },
        combinesWith: { product: true, order: true, shipping: true },
      }])],
      platformClasses: ["order"],
    });

    expect(resolution.applied).toHaveLength(1);
    expect(resolution.applied[0]!.amountMinor).toBe(appDiscountMinor);
    expect(resolution.merchandiseMinor).toBe(appDiscountMinor);

    // Combine platform + app allocations for the tax quote.
    const platformAllocation = {
      lines: [{ lineId, amountMinor: platformDiscountMinor }],
      shippingMinor: 0,
    };
    const combined = combineDiscountAllocations(platformAllocation, resolution.applied);
    expect(combined).toBeDefined();
    expect(combined!.lines).toEqual([{ lineId, amountMinor: 8400 }]);

    // Qualifying merchandise uses combined discount (8400), not just platform (6000).
    const qualifying = resolveCodDepositQualifyingMerchandiseMinor({
      quoteLines: [{ lineId, discountMinor: 8400 }],
      cartItems: [{ index: 0, productId: "p", variantId: "v", quantity: 1, unitPriceMinor: 30000, isGiftCard: false }],
      productPolicyById: new Map([["p", "required"]]),
      globalDefaultProductPolicy: "all",
    });
    expect(qualifying).toBe(21600);

    // Manual COD deposit: quote total = gross 30000 - combined discount 8400 + shipping 6000 = 27600.
    // Deposit: 25% of 21600 = 5400. Balance = 27600 - 5400 = 22200.
    const quote = { totalMinor: 27600, currencyCode: "BDT" };
    const deposit = resolveManualCodDeposit(
      baseSettings,
      quote,
      shopCurrency,
      baseCart,
      providers(),
      qualifying,
    );
    expect(deposit.error).toBeNull();
    expect(deposit.terms!.depositMinor).toBe(5400);
    expect(deposit.terms!.balanceMinor).toBe(22200);
  });

  it("platform 20% order discount + app order discount: both order class combine", () => {
    // Platform: 20% off order = 6000 on 30000 gross.
    // App: 10% off order = 2400 of remaining (both order class).
    // Combined: 8400. Qualifying = 30000 - 8400 = 21600.
    const platformDiscountMinor = 6000;
    const appDiscountMinor = 2400;

    const resolution = resolveAppDiscounts({
      currencyCode,
      priceIncrementMinor,
      lines: [{ lineId, grossMinor, platformDiscountMinor, giftCard: false }],
      shippingMinor,
      platformShippingDiscountMinor: 0,
      submittedCodes: [],
      results: [appResult([{
        title: "App 10% order discount",
        target: { kind: "order" },
        value: { type: "percentage", percent: 10 },
        combinesWith: { product: true, order: true, shipping: true },
      }])],
      platformClasses: ["order"],
    });

    expect(resolution.applied).toHaveLength(1);
    expect(resolution.applied[0]!.amountMinor).toBe(appDiscountMinor);

    const platformAllocation = {
      lines: [{ lineId, amountMinor: platformDiscountMinor }],
      shippingMinor: 0,
    };
    const combined = combineDiscountAllocations(platformAllocation, resolution.applied);
    expect(combined!.lines).toEqual([{ lineId, amountMinor: 8400 }]);

    const qualifying = resolveCodDepositQualifyingMerchandiseMinor({
      quoteLines: [{ lineId, discountMinor: 8400 }],
      cartItems: [{ index: 0, productId: "p", variantId: "v", quantity: 1, unitPriceMinor: 30000, isGiftCard: false }],
      productPolicyById: new Map([["p", "required"]]),
      globalDefaultProductPolicy: "all",
    });
    expect(qualifying).toBe(21600);

    const deposit = resolveManualCodDeposit(
      baseSettings,
      { totalMinor: 27600, currencyCode: "BDT" },
      shopCurrency,
      baseCart,
      providers(),
      qualifying,
    );
    expect(deposit.error).toBeNull();
    expect(deposit.terms!.depositMinor).toBe(5400);
    expect(deposit.terms!.balanceMinor).toBe(22200);
  });

  it("app discount that does not combine with platform's order class is skipped", () => {
    // Platform: 20% off order (order class). App: 10% off lines with combinesWith.order = false.
    // App discount is skipped. Combined discount = platform only = 6000.
    // Qualifying = 30000 - 6000 = 24000. Deposit 25% = 6000.
    const platformDiscountMinor = 6000;

    const resolution = resolveAppDiscounts({
      currencyCode,
      priceIncrementMinor,
      lines: [{ lineId, grossMinor, platformDiscountMinor, giftCard: false }],
      shippingMinor,
      platformShippingDiscountMinor: 0,
      submittedCodes: [],
      results: [appResult([{
        title: "App 10% line discount (no order combine)",
        target: { kind: "lines", lineIds: [lineId] },
        value: { type: "percentage", percent: 10 },
        combinesWith: { order: false },
      }])],
      platformClasses: ["order"],
    });

    expect(resolution.applied).toHaveLength(0);
    expect(resolution.merchandiseMinor).toBe(0);

    const platformAllocation = {
      lines: [{ lineId, amountMinor: platformDiscountMinor }],
      shippingMinor: 0,
    };
    const combined = combineDiscountAllocations(platformAllocation, resolution.applied);
    expect(combined!.lines).toEqual([{ lineId, amountMinor: 6000 }]);

    const qualifying = resolveCodDepositQualifyingMerchandiseMinor({
      quoteLines: [{ lineId, discountMinor: 6000 }],
      cartItems: [{ index: 0, productId: "p", variantId: "v", quantity: 1, unitPriceMinor: 30000, isGiftCard: false }],
      productPolicyById: new Map([["p", "required"]]),
      globalDefaultProductPolicy: "all",
    });
    expect(qualifying).toBe(24000);

    const deposit = resolveManualCodDeposit(
      baseSettings,
      { totalMinor: 30000, currencyCode: "BDT" },
      shopCurrency,
      baseCart,
      providers(),
      qualifying,
    );
    expect(deposit.error).toBeNull();
    expect(deposit.terms!.depositMinor).toBe(6000);
    expect(deposit.terms!.balanceMinor).toBe(24000);
  });

  it("no platform discount + app 10% line discount: deposit basis reduced by app only", () => {
    // No platform discount. App: 10% off line = 3000.
    // Qualifying = 30000 - 3000 = 27000. Deposit 25% = 6750.
    const resolution = resolveAppDiscounts({
      currencyCode,
      priceIncrementMinor,
      lines: [{ lineId, grossMinor, platformDiscountMinor: 0, giftCard: false }],
      shippingMinor,
      platformShippingDiscountMinor: 0,
      submittedCodes: [],
      results: [appResult([{
        title: "App 10% line discount",
        target: { kind: "lines", lineIds: [lineId] },
        value: { type: "percentage", percent: 10 },
        combinesWith: { product: true, order: true, shipping: true },
      }])],
      platformClasses: [],
    });

    expect(resolution.applied).toHaveLength(1);
    expect(resolution.applied[0]!.amountMinor).toBe(3000);

    const platformAllocation = {
      lines: [{ lineId, amountMinor: 0 }],
      shippingMinor: 0,
    };
    const combined = combineDiscountAllocations(platformAllocation, resolution.applied);
    expect(combined!.lines).toEqual([{ lineId, amountMinor: 3000 }]);

    const qualifying = resolveCodDepositQualifyingMerchandiseMinor({
      quoteLines: [{ lineId, discountMinor: 3000 }],
      cartItems: [{ index: 0, productId: "p", variantId: "v", quantity: 1, unitPriceMinor: 30000, isGiftCard: false }],
      productPolicyById: new Map([["p", "required"]]),
      globalDefaultProductPolicy: "all",
    });
    expect(qualifying).toBe(27000);

    const deposit = resolveManualCodDeposit(
      baseSettings,
      { totalMinor: 33000, currencyCode: "BDT" },
      shopCurrency,
      baseCart,
      providers(),
      qualifying,
    );
    expect(deposit.error).toBeNull();
    expect(deposit.terms!.depositMinor).toBe(6800);
    expect(deposit.terms!.balanceMinor).toBe(26200);
  });
});
