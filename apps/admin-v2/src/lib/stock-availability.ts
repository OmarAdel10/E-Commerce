import { translate } from "~/i18n";
import { stockAvailabilityMessages } from "~/i18n/stock-availability";

/**
 * Units a product or SKU can still sell: on hand minus what open orders hold,
 * never below zero. The one basis every stock line outside Inventory shows.
 */
export function availableUnits(onHand: number, committed: number): number {
  return Math.max(0, onHand - committed);
}

/**
 * "12 available", "71 available for 3 variants", or "Not tracked" (`null`:
 * no SKU counts its stock). `variants` above one names how many SKUs share it.
 */
export function availableStockText(available: number | null, variants = 1): string {
  if (available === null) return translate(stockAvailabilityMessages, "notTracked");
  return variants > 1
    ? translate(stockAvailabilityMessages, "availableForVariants", { count: available, variants })
    : translate(stockAvailabilityMessages, "available", { count: available });
}
