import { describe, expect, it } from "vitest";
import { isCodOnly, type CheckoutConfig } from "./checkout";

describe("cart checkout mode", () => {
  const codOnly: CheckoutConfig = {
    gateways: [{ id: "cod", name: "Cash on delivery" }],
    checkoutMode: "guest_cod_only",
  };

  it("lets ordinary COD orders submit from the cart", () => {
    expect(isCodOnly(codOnly)).toBe(true);
  });

  it("requires the payment review step when the COD order needs a deposit", () => {
    expect(isCodOnly({
      ...codOnly,
      codDeposit: { enabled: true, mode: "fixed", amount: 20, percent: 0 },
    })).toBe(false);
  });
});
