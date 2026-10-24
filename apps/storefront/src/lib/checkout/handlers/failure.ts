import type { CheckoutLanguageKey } from "@scalius/shared/checkout-language";
import type { PaymentContext, PaymentResult } from "../types";
import { CheckoutOrderError } from "../create-order";
import { checkoutFailureText, checkoutOrderFailureText } from "../error-messages";

/**
 * A handler's failed payment, in the buyer's words: the store's refusal of the
 * order (catalogue copy for its code/status), else the failure's
 * own copy key, else `fallback`. A developer's message never reaches the page.
 */
export function paymentFailure(
  error: unknown,
  ctx: Pick<PaymentContext, "copy">,
  fallback: CheckoutLanguageKey,
): PaymentResult {
  if (error instanceof CheckoutOrderError) {
    return {
      success: false,
      error: checkoutOrderFailureText(error.status, error.message, ctx.copy, error.errorCode, error.details),
      errorCode: error.errorCode,
      details: error.details,
      status: error.status,
      cartIssues: error.cartIssues,
      refusal: error.refusal,
    };
  }
  return { success: false, error: checkoutFailureText(error, ctx.copy, fallback) };
}
