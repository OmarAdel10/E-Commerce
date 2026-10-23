import type { CheckoutLanguageData } from "@scalius/shared/checkout-language";
import { isQualifiedProviderId, parseQualifiedProviderId } from "@scalius/shared/plugins/providers/kinds";

/** The Bangladesh pack's SSLCommerz. */
export const SSLCOMMERZ_GATEWAY_ID = "scalius.bangladesh:sslcommerz";

export type GatewayPresentation = {
  buyerLabel: string;
  description: string;
  providerLabel: string | null;
  markSrc: string | null;
  darkMarkSrc?: string;
  markKind: "wordmark" | "icon" | "none";
  hosted: boolean;
};

/** The checkout-language words a built-in method is named and described with. */
export const GATEWAY_PRESENTATION_COPY_KEYS = [
  "creditDebitCardText",
  "paySecurelyByCardText",
  "onlinePaymentText",
  "onlinePaymentDescriptionText",
  "cashOnDeliveryText",
  "payOnDeliveryText",
  "invoicePaymentText",
  "giftCardTitleText",
] as const satisfies readonly (keyof CheckoutLanguageData)[];

export type GatewayPresentationCopy = Pick<CheckoutLanguageData, (typeof GATEWAY_PRESENTATION_COPY_KEYS)[number]>;
type GatewayPresentationCopyKey = keyof GatewayPresentationCopy;

type BuiltInGatewayPresentation = Omit<GatewayPresentation, "buyerLabel" | "description"> & {
  label: GatewayPresentationCopyKey;
  description: GatewayPresentationCopyKey | null;
};

/**
 * Buyer-facing payment names stay stable and familiar, in the page's language
 * (and the merchant's edits): each built-in method names its checkout-language
 * words. Provider marks are exact, locally bundled first-party assets copied
 * from the audited admin manifest; capability copy is limited to the public
 * gateway contract.
 */
const GATEWAY_PRESENTATION: Record<string, BuiltInGatewayPresentation> = {
  stripe: {
    label: "creditDebitCardText",
    description: "paySecurelyByCardText",
    providerLabel: "Stripe",
    markSrc: "/payment-marks/stripe-blurple.svg",
    markKind: "wordmark",
    hosted: false,
  },
  // The Bangladesh pack's SSLCommerz: its page offers cards, wallets and
  // banking, so buyers read it as paying online; its mark is a copy of the one
  // the pack declares. "Continue to SSLCommerz" keeps the provider's name.
  [SSLCOMMERZ_GATEWAY_ID]: {
    label: "onlinePaymentText",
    description: "onlinePaymentDescriptionText",
    providerLabel: "SSLCommerz",
    markSrc: "/payment-marks/sslcommerz.png",
    markKind: "wordmark",
    hosted: true,
  },
  // Every method shows a mark in the same badge (Shopify's payment rows):
  // methods without a brand show a plain icon.
  cod: {
    label: "cashOnDeliveryText",
    description: "payOnDeliveryText",
    providerLabel: null,
    markSrc: "/payment-marks/cash.svg",
    markKind: "icon",
    hosted: false,
  },
  // The store's invoice (net terms): placed now, paid by its due date.
  net_terms: {
    label: "invoicePaymentText",
    description: null,
    providerLabel: null,
    markSrc: "/payment-marks/invoice.svg",
    markKind: "icon",
    hosted: false,
  },
  gift_card: {
    label: "giftCardTitleText",
    description: null,
    providerLabel: null,
    markSrc: "/payment-marks/gift.svg",
    markKind: "icon",
    hosted: false,
  },
};

/**
 * A neutral wallet: an app's payment method that ships no mark here never
 * borrows a brand asset or shows a broken image.
 */
export const APP_GATEWAY_MARK_SRC = "/payment-marks/wallet.svg";

/**
 * The first-party apps' payment providers' marks, by provider id: copies of
 * the mark each declares (`providers.payment[].icon`; a test keeps them equal).
 */
export const APP_PROVIDER_MARKS: Readonly<Record<string, string>> = {
  [SSLCOMMERZ_GATEWAY_ID]: "/payment-marks/sslcommerz.png",
  "scalius.bangladesh:bkash": "/payment-marks/bkash.svg",
  "scalius.bangladesh:nagad": "/payment-marks/nagad.svg",
};

/** A payment method an app provides: `<plugin id>:<provider id>`. */
export function isAppGatewayId(gatewayId: string): boolean {
  return isQualifiedProviderId(gatewayId);
}

/**
 * The name buyers read for an app's method: the checkout name the store
 * serves (`GET /checkout/config`), else the provider id in words ("Bkash"
 * for `scalius.bangladesh:bkash`); never the stored id. Null for other methods.
 */
export function appGatewayName(
  gatewayId: string,
  gateways?: readonly { id: string; name?: unknown }[] | null,
): string | null {
  const app = parseQualifiedProviderId(gatewayId);
  if (!app) return null;
  const configured = gateways?.find((gateway) => gateway.id === gatewayId)?.name;
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  const words = app.providerId.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * How a method reads to the buyer: a built-in one in the page's checkout
 * language, any other by `fallbackLabel` (the store's or the app's name).
 */
export function getGatewayPresentation(
  gatewayId: string,
  fallbackLabel: string,
  copy: GatewayPresentationCopy,
): GatewayPresentation {
  const known = GATEWAY_PRESENTATION[gatewayId];
  if (known) {
    const { label, description, ...rest } = known;
    return { ...rest, buyerLabel: copy[label], description: description ? copy[description] : "" };
  }
  if (isAppGatewayId(gatewayId)) {
    // An app's hosted wallet: its own checkout name, and its provider's mark
    // or a neutral one. The name doubles as the provider in "Continue to …" copy.
    const name = fallbackLabel.trim() && fallbackLabel !== gatewayId
      ? fallbackLabel.trim()
      : appGatewayName(gatewayId) ?? fallbackLabel;
    const logo = APP_PROVIDER_MARKS[gatewayId];
    return {
      buyerLabel: name,
      description: "",
      providerLabel: null,
      markSrc: logo ?? APP_GATEWAY_MARK_SRC,
      markKind: logo ? "wordmark" : "icon",
      hosted: true,
    };
  }
  return {
    buyerLabel: fallbackLabel,
    description: "",
    providerLabel: null,
    markSrc: APP_GATEWAY_MARK_SRC,
    markKind: "icon",
    hosted: true,
  };
}
