import { describe, expect, it } from "vitest";
import { getCheckoutFlowValidationIssues } from "./flow";

describe("getCheckoutFlowValidationIssues — codDeposit validation", () => {
  const base = {
    checkoutMode: "all",
    partialPaymentEnabled: false,
    partialPaymentAmount: 0,
    availablePaymentMethods: ["cod", "stripe"],
    paymentProviders: undefined as any,
    currencyCode: "BDT",
  };

  it("adds issue when codDepositEnabled but COD not in available payment methods", () => {
    const issues = getCheckoutFlowValidationIssues({
      ...base,
      codDepositEnabled: true,
      codDepositMode: "fixed",
      codDepositAmount: 500,
      codDepositPercent: 0,
      availablePaymentMethods: ["stripe"],
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("Cash on Delivery to be enabled");
  });

  it("adds issue when codDepositEnabled in gateways_only mode", () => {
    const issues = getCheckoutFlowValidationIssues({
      ...base,
      checkoutMode: "gateways_only",
      codDepositEnabled: true,
      codDepositMode: "fixed",
      codDepositAmount: 500,
      codDepositPercent: 0,
      availablePaymentMethods: ["cod", "stripe"],
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("Online Gateways Only");
  });

  it("adds issue when fixed mode amount is zero or missing", () => {
    const issues = getCheckoutFlowValidationIssues({
      ...base,
      codDepositEnabled: true,
      codDepositMode: "fixed",
      codDepositAmount: 0,
      codDepositPercent: 0,
      availablePaymentMethods: ["cod", "stripe"],
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("greater than zero");
  });

  it("adds issue when percentage mode percent is out of range", () => {
    const issues = getCheckoutFlowValidationIssues({
      ...base,
      codDepositEnabled: true,
      codDepositMode: "percentage",
      codDepositAmount: 0,
      codDepositPercent: 100,
      availablePaymentMethods: ["cod", "stripe"],
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("between 1 and 99");
  });

  it("adds issue when percentage mode percent is zero", () => {
    const issues = getCheckoutFlowValidationIssues({
      ...base,
      codDepositEnabled: true,
      codDepositMode: "percentage",
      codDepositAmount: 0,
      codDepositPercent: 0,
      availablePaymentMethods: ["cod", "stripe"],
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("between 1 and 99");
  });

  it("adds issue when percentage mode percent is negative", () => {
    const issues = getCheckoutFlowValidationIssues({
      ...base,
      codDepositEnabled: true,
      codDepositMode: "percentage",
      codDepositAmount: 0,
      codDepositPercent: -5,
      availablePaymentMethods: ["cod", "stripe"],
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("between 1 and 99");
  });

  it("no issues when codDepositEnabled with valid fixed settings", () => {
    const issues = getCheckoutFlowValidationIssues({
      ...base,
      codDepositEnabled: true,
      codDepositMode: "fixed",
      codDepositAmount: 500,
      codDepositPercent: 0,
      availablePaymentMethods: ["cod", "stripe"],
    });
    expect(issues).toEqual([]);
  });

  it("no issues when codDepositEnabled with valid percentage settings", () => {
    const issues = getCheckoutFlowValidationIssues({
      ...base,
      codDepositEnabled: true,
      codDepositMode: "percentage",
      codDepositAmount: 0,
      codDepositPercent: 50,
      availablePaymentMethods: ["cod", "stripe"],
    });
    expect(issues).toEqual([]);
  });

  it("no issues when codDeposit is disabled", () => {
    const issues = getCheckoutFlowValidationIssues({
      ...base,
      codDepositEnabled: false,
      codDepositMode: "fixed",
      codDepositAmount: 0,
      codDepositPercent: 0,
      availablePaymentMethods: ["cod", "stripe"],
    });
    expect(issues).toEqual([]);
  });
});
