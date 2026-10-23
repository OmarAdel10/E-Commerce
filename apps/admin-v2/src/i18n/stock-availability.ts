import { defineMessages } from "./index";

/**
 * Stock outside Inventory (Products, pickers, order lines) says one thing:
 * Available, what can still be sold (on hand minus open orders), the same
 * number and word as Inventory's Available column. "On hand" is only used
 * where the physical count itself is meant (Inventory, the quantity field).
 */
export const stockAvailabilityMessages = defineMessages({
  en: {
    available: "{count} available",
    availableForVariants: "{count} available for {variants, plural, one {# variant} other {# variants}}",
    notTracked: "Stock not tracked",
  },
  bn: {
    available: "{count}টি বাকি",
    availableForVariants: "{variants}টি ভ্যারিয়েন্টে {count}টি বাকি",
    notTracked: "স্টকের হিসাব রাখা হয় না",
  },
});
