import { storefrontLanguage } from "./storefront-language";

export interface PriceCopy {
  /** Visually hidden before a discounted price. */
  sale: string;
  /** Visually hidden before the struck regular price. */
  regular: string;
  /** Visually hidden before an undiscounted price. */
  price: string;
  /** A price that varies by option: "From ৳2,450". */
  from: (amount: string) => string;
  /** The saving beside a discounted price: "Save ৳600". */
  save: (amount: string) => string;
}

const EN: PriceCopy = {
  sale: "Sale price",
  regular: "Regular price",
  price: "Price",
  from: (amount) => `From ${amount}`,
  save: (amount) => `Save ${amount}`,
};
const BN: PriceCopy = {
  sale: "ছাড়ের দাম",
  regular: "নিয়মিত দাম",
  price: "দাম",
  from: (amount) => `${amount} থেকে`,
  save: (amount) => `${amount} সাশ্রয়`,
};

/** Price words without downloading unrelated storefront catalogues. */
export function priceCopy(language: unknown): PriceCopy {
  return storefrontLanguage(language) === "bn" ? BN : EN;
}
