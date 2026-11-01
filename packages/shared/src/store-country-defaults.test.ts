import { describe, expect, it } from "vitest";
import { defaultCurrencyForCountry, defaultUnitSystemForCountry } from "./store-country-defaults";

describe("defaultCurrencyForCountry", () => {
  it("EG returns EGP", () => {
    expect(defaultCurrencyForCountry("EG")).toBe("EGP");
  });

  it("BD returns BDT", () => {
    expect(defaultCurrencyForCountry("BD")).toBe("BDT");
  });

  it("US returns USD (unsupported country falls back to USD)", () => {
    expect(defaultCurrencyForCountry("US")).toBe("USD");
  });

  it("normalizes case and trims whitespace", () => {
    expect(defaultCurrencyForCountry("  eg  ")).toBe("EGP");
    expect(defaultCurrencyForCountry("eg")).toBe("EGP");
  });
});

describe("defaultUnitSystemForCountry", () => {
  it("EG returns metric", () => {
    expect(defaultUnitSystemForCountry("EG")).toBe("metric");
  });

  it("US returns imperial", () => {
    expect(defaultUnitSystemForCountry("US")).toBe("imperial");
  });

  it("unsupported country defaults to metric", () => {
    expect(defaultUnitSystemForCountry("BD")).toBe("metric");
    expect(defaultUnitSystemForCountry("FR")).toBe("metric");
  });

  it("normalizes case and trims whitespace", () => {
    expect(defaultUnitSystemForCountry("  US  ")).toBe("imperial");
    expect(defaultUnitSystemForCountry("us")).toBe("imperial");
  });
});
