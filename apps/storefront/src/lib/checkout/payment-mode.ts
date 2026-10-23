import { isDepositPaymentRequired } from "@scalius/shared/checkout-payment";
export { isDepositPaymentRequired } from "@scalius/shared/checkout-payment";
import type { CheckoutConfig } from "./types";
import { CheckoutCopyError } from "./error-messages";

export type CheckoutPaymentRequest =
  | { paymentType: "deposit"; depositAmount: number }
  | { paymentType: "full" }
  | { paymentType: "balance" };

export function resolveExplicitCheckoutPaymentRequest(
  paymentType: NonNullable<CheckoutPaymentRequest["paymentType"]>,
  depositAmount?: number,
): CheckoutPaymentRequest {
  if (paymentType !== "deposit") return { paymentType };
  if (!Number.isFinite(depositAmount) || (depositAmount ?? 0) <= 0) {
    throw new CheckoutCopyError("paymentStartFailedText", "a deposit needs a positive advance amount");
  }
  return { paymentType: "deposit", depositAmount: depositAmount! };
}

export function resolveCheckoutPaymentRequest(
  config: Pick<CheckoutConfig, "partialPaymentEnabled" | "partialPaymentAmount">,
  totalAmount: number,
): CheckoutPaymentRequest {
  const configuredDeposit = Number(config.partialPaymentAmount);
  if (isDepositPaymentRequired(config, totalAmount)) {
    return { paymentType: "deposit", depositAmount: configuredDeposit };
  }

  return { paymentType: "full" };
}
