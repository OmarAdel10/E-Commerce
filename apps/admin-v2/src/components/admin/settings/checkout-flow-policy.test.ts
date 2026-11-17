import { describe, expect, it } from "vitest";
import { checkoutDepositAmountsForSave, getCheckoutFlowPreviewIssues, type CheckoutFlowPreviewOptions } from "./checkout-flow-policy";

const defaults: CheckoutFlowPreviewOptions = {
  checkoutMode: "all",
  partialPaymentEnabled: false,
  partialPaymentAmount: 0,
  paymentMethodsUnavailable: false,
  paymentMethodsLoaded: true,
  codEnabled: true,
  activeOnlineMethodCount: 0,
  codDepositEnabled: true,
  codDepositAmount: 100,
};

describe("admin checkout-flow preview", () => {
  it("uses the fixed amount by default and ignores its value after switching to percentage", () => {
    expect(getCheckoutFlowPreviewIssues(defaults)).toEqual([]);
    expect(getCheckoutFlowPreviewIssues({ ...defaults, codDepositAmount: NaN })).toEqual(["codDepositAmountInvalid"]);
    expect(getCheckoutFlowPreviewIssues({
      ...defaults,
      codDepositMode: "percentage",
      codDepositAmount: NaN,
      codDepositPercent: 20,
    })).toEqual([]);
    expect(getCheckoutFlowPreviewIssues({
      ...defaults, codDepositMode: "percentage", codDepositPercent: 100,
    })).toEqual(["codDepositPercentInvalid"]);
  });

  it("rejects enabling a deposit without COD or in online-only checkout", () => {
    expect(getCheckoutFlowPreviewIssues({
      ...defaults, codEnabled: false, activeOnlineMethodCount: 1,
    })).toEqual(["codDepositNeedsCod"]);
    expect(getCheckoutFlowPreviewIssues({
      ...defaults, checkoutMode: "gateways_only", activeOnlineMethodCount: 1,
    })).toEqual(["codDepositNotInGatewaysOnly"]);
  });

  it("does not require the merchant to fix a saved inactive deposit value", () => {
    expect(getCheckoutFlowPreviewIssues({
      ...defaults,
      codDepositEnabled: false,
      codDepositMode: "percentage",
      codDepositPercent: 0,
    })).toEqual([]);
  });

  it("saves only the selected mode's amount so an unfinished edit in another mode stays out of the request", () => {
    expect(checkoutDepositAmountsForSave({ ...defaults, codDepositPercent: 100 })).toEqual({ codDepositAmount: 100 });
    expect(checkoutDepositAmountsForSave({
      ...defaults, codDepositMode: "percentage", codDepositPercent: 20, codDepositAmount: NaN,
    })).toEqual({ codDepositPercent: 20 });
    expect(checkoutDepositAmountsForSave({ ...defaults, codDepositEnabled: false })).toEqual({});
  });

  it("validates a manual deposit independently of a valid online advance", () => {
    const options = {
      ...defaults, partialPaymentEnabled: true, partialPaymentAmount: 50, activeOnlineMethodCount: 1,
    };
    expect(getCheckoutFlowPreviewIssues(options)).toEqual([]);
    expect(getCheckoutFlowPreviewIssues({ ...options, codDepositAmount: 0 })).toEqual(["codDepositAmountInvalid"]);
  });
});
