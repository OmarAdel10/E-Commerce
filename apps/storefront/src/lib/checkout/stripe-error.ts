import type { CheckoutLanguageKey } from "@scalius/shared/checkout-language";

/** Stripe.js's error (https://docs.stripe.com/api/errors): its `code` names the field or the decline. */
export interface StripeError {
  type?: string;
  code?: string;
  decline_code?: string;
  message?: string;
}

/**
 * The buyer's words for Stripe's error: the field to check or the decline, by
 * its code. Stripe's own message is in Stripe's language (it has no Bangla),
 * so the page never shows it.
 */
export function stripeErrorCopyKey(error: StripeError | undefined, fallback: CheckoutLanguageKey): CheckoutLanguageKey {
  const code = error?.code ?? "";
  if (code === "card_declined" || error?.decline_code) return "cardDeclinedText";
  if (code === "payment_intent_authentication_failure") return "cardAuthenticationFailedText";
  if (code === "expired_card" || code.includes("expiry")) return "cardExpiryInvalidText";
  if (code.includes("number")) return "cardNumberInvalidText";
  if (code.includes("cvc")) return "cardCvcInvalidText";
  if (code.includes("zip") || code.includes("postal")) return "cardPostalCodeInvalidText";
  return fallback;
}
