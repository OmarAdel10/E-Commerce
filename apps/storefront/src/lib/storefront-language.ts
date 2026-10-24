import { checkoutLanguageBaseCode } from "@scalius/shared/checkout-language-format";

export type StorefrontLanguage = "en" | "bn";

/** The store language the storefront speaks: Bangla for `bn…`, else English. */
export function storefrontLanguage(code: unknown): StorefrontLanguage {
  return checkoutLanguageBaseCode(code) === "bn" ? "bn" : "en";
}
