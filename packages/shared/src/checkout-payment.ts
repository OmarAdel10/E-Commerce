import { allowsCashOnDelivery, type FulfillmentType } from "./fulfilment";

/**
 * Whether an order takes the store's deposit plan: the advance online now and
 * the rest in cash on delivery. The rest is cash, so the plan applies only
 * where cash fits every line (`allowsCashOnDelivery`): an order with a
 * download or a gift card is paid in full online and delivers them at once,
 * never waiting for a courier to collect a balance. Amounts must use the same
 * currency/unit; gift-card and foreign-currency flows disable deposits before
 * calling.
 */
export function isDepositPaymentRequired(
  config: { partialPaymentEnabled: boolean; partialPaymentAmount: number },
  totalAmount: number,
  /** The order's line types (`fulfillmentType`; null: a physical line before its delivery method). */
  lineTypes: readonly (FulfillmentType | null)[],
): boolean {
  const deposit = Number(config.partialPaymentAmount);
  return config.partialPaymentEnabled && allowsCashOnDelivery(lineTypes)
    && Number.isFinite(deposit) && deposit > 0 && deposit < totalAmount;
}
