import { expect, it } from "vitest";
import * as checkout from "@scalius/core/modules/checkout";
import * as tax from "@scalius/core/modules/tax";

it("keeps checkout proof symbols off the production domain exports", () => {
  expect(checkout).not.toHaveProperty("STOREFRONT_CART_VALIDATION_RESULT_PROOF");
  expect(checkout).not.toHaveProperty("STOREFRONT_DELIVERY_PREFLIGHT_RESULT_PROOF");
  expect(tax).not.toHaveProperty("STOREFRONT_TAX_AUTHORITY_PROOF");
});
