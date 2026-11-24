// Unit tests for resolveAppDiscounts: app discounts combined with platform discounts.
import { describe, expect, it } from "vitest";
import { resolveAppDiscounts } from "./app-functions";
import type { CheckoutAppFunctionResult } from "./app-functions";
import type { PluginFunctionOutput } from "@scalius/shared/plugins";

describe("resolveAppDiscounts — app discounts combined with platform discounts", () => {
  const lineId = "line:0";
  const currencyCode = "BDT";
  const priceIncrementMinor = 100;
  const grossMinor = 30000;

  function appResult(discounts: unknown[]): CheckoutAppFunctionResult<"checkout.discounts"> {
    return {
      pluginId: "app_discount",
      output: { discounts } as PluginFunctionOutput<"checkout.discounts">,
      commits: [],
    };
  }

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
