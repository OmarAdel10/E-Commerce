import { manualCodPercentageDepositMinor, type ManualCodDepositTerms } from "@scalius/shared/checkout-payment";
import type { PricingCurrency } from "@scalius/shared/currency-policy";
import { toMinor } from "@scalius/shared/money";
import { CASH_ON_DELIVERY_AMOUNT_REASON, COD_PAYMENT_METHOD, type PaymentProviders } from "../payments";
import { ValidationError } from "../../errors";
import type { CheckoutFlowSettings } from "../settings";
import { buildStorefrontTaxAllocationLineId } from "../tax";
import type { TaxQuote } from "../tax/browser";

/** One cart line's authoritative, server-resolved facts used for the deposit decision. */
export interface CodDepositLineInput {
    /** The product the line sells. */
    productId: string;
    /** Line quantity. */
    quantity: number;
    /** Authoritative unit price in minor units (after the product's own sale/discount). */
    unitPriceMinor: number;
    /** Gift-card lines never qualify for a manual COD deposit. */
    isGiftCard: boolean;
    /**
     * Order-level discount allocated to this line (promotions/coupons/bundle
     * savings), in minor units. Already reflected in the tax quote's per-line
     * `discountMinor` — the authoritative source of truth. Reduces the deposit
     * calculation basis. Never subtract a separate raw bundle saving: the quote
     * already includes it exactly once when bundles won, and excludes it when
     * promotions won.
     */
    discountMinor: number;
}

/** The net qualifying value of one cart line after all applicable discounts. */
function lineQualifyingValue(line: CodDepositLineInput): number {
    const gross = line.unitPriceMinor * Math.floor(line.quantity);
    const afterDiscounts = gross - line.discountMinor;
    return afterDiscounts > 0 ? afterDiscounts : 0;
}

/**
 * The effective manual COD deposit policy for one product.
 *
 * `inherit` follows the global default: `all` means every product requires a
 * deposit (the previous behaviour), `selected` means inherit products do not.
 * `required` and `exempt` are explicit per-product overrides. A product policy
 * can never activate a deposit when the global feature is disabled; that check
 * belongs to the caller (`settings.codDepositEnabled`).
 */
export type CodDepositProductPolicy = "inherit" | "required" | "exempt";

/**
 * Resolve a product's effective deposit requirement from its stored policy and
 * the global default product policy. Stored values are plain strings from the
 * database.
 *
 * Valid policies: `inherit`, `required`, `exempt`. `inherit` follows the global
 * default: `all` means every product requires a deposit (the previous
 * behaviour), `selected` means inherit products do not. `required` and `exempt`
 * are explicit per-product overrides. A product policy can never activate a
 * deposit when the global feature is disabled; that check belongs to the
 * caller (`settings.codDepositEnabled`).
 *
 * Throws a ValidationError for unexpected or invalid stored values rather than
 * silently exempting the product (fails closed).
 */
export function resolveProductDepositPolicy(
    productPolicy: string | null | undefined,
    globalDefaultProductPolicy: "all" | "selected",
): "required" | "exempt" {
    // The global default product policy is a stored setting; validate it to
    // prevent silent misconfiguration from corrupted data.
    if (globalDefaultProductPolicy !== "all" && globalDefaultProductPolicy !== "selected") {
        throw new ValidationError(
            `Invalid manual COD default product policy: ${String(globalDefaultProductPolicy)}. Expected "all" or "selected".`,
        );
    }
    switch (productPolicy) {
        case "required":
            return "required";
        case "exempt":
            return "exempt";
        case "inherit":
        case null:
        case undefined:
            return globalDefaultProductPolicy === "all" ? "required" : "exempt";
        default:
            // Fails closed: an unexpected stored value must not silently remove
            // a required deposit. Reject with an actionable error.
            throw new ValidationError(
                `Invalid manual COD deposit policy: ${String(productPolicy)}. Expected inherit, required or exempt.`,
            );
    }
}

/**
 * The qualifying merchandise value and the products that contributed to it.
 */
export interface CodDepositQualifyingMerchandise {
  /** Qualifying merchandise value in minor units. */
  minor: number;
  /** Product ids that contributed to the basis, each once, in cart order. */
  productIds: string[];
}

/**
 * One pass over the cart lines: the qualifying merchandise value and the
 * products behind it.
 *
 * A line that contributes nothing (its value is zero after discounts) belongs
 * to no product's qualifying set: it adds no value to the basis, so it must
 * not appear in the deposit's product snapshot either.
 */
function resolveCodDepositQualifying(
    lines: readonly CodDepositLineInput[],
    productPolicyById: ReadonlyMap<string, string | null | undefined>,
    globalDefaultProductPolicy: "all" | "selected",
): CodDepositQualifyingMerchandise {
    let qualifyingMinor = 0;
    const productIds: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
        if (line.isGiftCard) continue;
        if (!Number.isFinite(line.unitPriceMinor) || line.unitPriceMinor < 0) {
            throw new ValidationError(
                `Invalid unit price for product ${line.productId}: ${String(line.unitPriceMinor)}. Must be a non-negative finite number.`,
            );
        }
        if (!Number.isFinite(line.quantity) || line.quantity < 1) {
            throw new ValidationError(
                `Invalid quantity for product ${line.productId}: ${String(line.quantity)}. Must be a finite number >= 1.`,
            );
        }
        // The order-level discount is authoritative data too: a corrupt value
        // must fail closed instead of silently changing the deposit basis.
        // Zero is legitimate; a discount above the line value clamps the
        // qualifying value to zero (see lineQualifyingValue).
        if (!Number.isFinite(line.discountMinor) || line.discountMinor < 0) {
            throw new ValidationError(
                `Invalid discount for product ${line.productId}: ${String(line.discountMinor)}. Must be a non-negative finite number.`,
            );
        }
        const stored = productPolicyById.get(line.productId);
        // A missing entry means the product's authoritative data was not loaded
        // into the policy map. This is distinct from an intentionally inherited
        // or explicitly null policy: we cannot determine the product's deposit
        // requirement without its authoritative data, so fail closed.
        if (!productPolicyById.has(line.productId)) {
            throw new ValidationError(
                `Missing authoritative deposit policy for product ${line.productId}.`,
            );
        }
        const effective = resolveProductDepositPolicy(
            stored,
            globalDefaultProductPolicy,
        );
        if (effective !== "required") continue;
        const lineValue = lineQualifyingValue(line);
        if (lineValue <= 0) continue;
        qualifyingMinor += lineValue;
        if (!seen.has(line.productId)) {
            seen.add(line.productId);
            productIds.push(line.productId);
        }
    }
    return { minor: qualifyingMinor, productIds };
}

/**
 * The qualifying merchandise value: the sum of net line values (unit price x
 * quantity, after product-specific and order-level discounts, after bundle
 * savings) for products whose effective policy is `required`. Gift cards and
 * exempt products never qualify. Shipping is not part of a line unit price, so
 * it is excluded by construction.
 *
 * Tax treatment: line prices are taken as-is from the authoritative tax quote.
 * If `pricesIncludeTax` is true, unit prices are tax-inclusive and the deposit
 * basis includes tax; if false, unit prices are tax-exclusive and the deposit
 * basis excludes tax. Either way, the same authoritative prices used for the
 * order total are used for the deposit basis, so tax is never double-counted
 * and shipping tax is never treated as qualifying merchandise.
 *
 * Computed server-side from authoritative product and pricing data; never
 * derived from client-supplied amounts.
 */
export function resolveCodDepositQualifyingValue(
    lines: readonly CodDepositLineInput[],
    productPolicyById: ReadonlyMap<string, string | null | undefined>,
    globalDefaultProductPolicy: "all" | "selected",
): number {
    return resolveCodDepositQualifying(lines, productPolicyById, globalDefaultProductPolicy).minor;
}

/** The authoritative inputs the deposit basis is read from. */
export interface CodDepositQualifyingMerchandiseInput {
  /** Authoritative tax quote lines: one per cart line, keyed by line id. */
  quoteLines: readonly { lineId: string; discountMinor?: number | null }[];
  /** Validated cart items, in cart order, with quantity and unit price. */
  cartItems: readonly {
    index: number;
    productId: string;
    variantId: string;
    quantity: number;
    unitPriceMinor: number;
    isGiftCard: boolean;
  }[];
  /** Authoritative per-product deposit policy, keyed by product id. */
  productPolicyById: ReadonlyMap<string, string | null | undefined>;
  globalDefaultProductPolicy: "all" | "selected";
}

/**
 * The qualifying merchandise for a manual COD deposit, computed from
 * authoritative tax quote lines, product policies and cart items.
 *
 * This is the single implementation of the deposit-basis preparation that was
 * previously duplicated across the storefront tax quote, the order commit and
 * the agent storefront quote. Per-line order-level discounts are read from the
 * authoritative tax quote, keyed by the stable tax-allocation line id; a cart
 * item whose line has no authoritative allocation is inconsistent pricing
 * data, not a legitimate zero discount, so it fails closed instead of being
 * silently priced at full value (which would overstate the deposit basis).
 *
 * The product ids come from the same pass as the value: a product qualifies
 * only when one of its lines contributed to the basis.
 */
export function resolveCodDepositQualifyingMerchandise(
    input: CodDepositQualifyingMerchandiseInput,
): CodDepositQualifyingMerchandise {
    const lineDiscountById = new Map(
        input.quoteLines.map((line) => [line.lineId, line.discountMinor ?? 0]),
    );
    const lines = input.cartItems.map((item) => {
        const lineId = buildStorefrontTaxAllocationLineId(item.index, item.variantId);
        // A missing authoritative allocation means the quote does not cover
        // this cart line: inconsistent pricing data, fail closed.
        if (!lineDiscountById.has(lineId)) {
            throw new ValidationError(
                `Missing authoritative line discount allocation for product ${item.productId}.`,
            );
        }
        return {
            productId: item.productId,
            quantity: item.quantity,
            unitPriceMinor: item.unitPriceMinor,
            isGiftCard: item.isGiftCard,
            discountMinor: lineDiscountById.get(lineId)!,
        };
    });
    return resolveCodDepositQualifying(lines, input.productPolicyById, input.globalDefaultProductPolicy);
}

/** The qualifying merchandise value alone, in minor units. */
export function resolveCodDepositQualifyingMerchandiseMinor(
    input: CodDepositQualifyingMerchandiseInput,
): number {
    return resolveCodDepositQualifyingMerchandise(input).minor;
}

/**
 * The qualifying merchandise, read only when a deposit can apply.
 *
 * A store with the manual deposit switched off (or an order that never pays
 * cash on delivery) carries no deposit terms, so the deposit basis is never
 * read there: a pricing inconsistency in the deposit policy must not fail a
 * checkout that carries no deposit.
 */
export function resolveCodDepositQualifyingMerchandiseWhenApplicable(
    applicable: boolean,
    input: CodDepositQualifyingMerchandiseInput,
): CodDepositQualifyingMerchandise {
    if (!applicable) return { minor: 0, productIds: [] };
    return resolveCodDepositQualifyingMerchandise(input);
}

/** The same deposit decision drives the offered COD method and its order. */
export function resolveManualCodDeposit(
    settings: Pick<CheckoutFlowSettings, "codDepositEnabled" | "codDepositMode" | "codDepositAmount" | "codDepositPercent" | "codDepositInstructions" | "codDepositDefaultProductPolicy"> | null,
    quote: Pick<TaxQuote, "totalMinor" | "currencyCode">,
    shopCurrency: PricingCurrency,
    cart: { allowsCashOnDelivery: boolean; giftCardsApplied: boolean },
    providers: PaymentProviders,
    /**
     * Qualifying merchandise value (required-products only, after discounts,
     * excluding shipping), computed server-side from authoritative product data.
     * Zero (or absent) means no qualifying merchandise: normal COD, no plan.
     */
    qualifyingMerchandiseMinor: number,
): { terms: ManualCodDepositTerms | null; error: ValidationError | null } {
    if (!settings?.codDepositEnabled) return { terms: null, error: null };
    if (!cart.allowsCashOnDelivery || cart.giftCardsApplied) {
        return { terms: null, error: new ValidationError("Cash on delivery is unavailable for this order.") };
    }
    if (!Number.isFinite(qualifyingMerchandiseMinor) || qualifyingMerchandiseMinor < 0 || qualifyingMerchandiseMinor === Infinity) {
        // Invalid authoritative financial data: NaN, negative, or Infinity values
        // indicate corrupted pricing data, not a legitimate zero-qualification case.
        // Fail closed rather than silently removing a deposit requirement.
        return {
            terms: null,
            error: new ValidationError("Cash on delivery is unavailable for this order: invalid qualifying merchandise value."),
        };
    }
    if (qualifyingMerchandiseMinor <= 0) {
        // No qualifying merchandise: normal COD without a manual deposit plan.
        // A cart priced in another market currency needs no deposit either, so
        // the deposit currency check below does not apply to it.
        return { terms: null, error: null };
    }
    if (quote.currencyCode !== shopCurrency.code) {
        // The deposit is priced in the store currency, so a cart in another
        // market currency cannot carry one. Normal COD in that currency stays
        // available; only the deposit is refused.
        return {
            terms: null,
            error: new ValidationError("Cash on delivery is unavailable for this order: the manual deposit is priced in the store currency."),
        };
    }

    const percent = settings.codDepositMode === "percentage" ? settings.codDepositPercent : null;
    // The currency increment is the smallest collectable cash amount (whole
    // taka for BDT). Every collected amount stays on that increment so the
    // balance collected on delivery is collectable too.
    const step = Math.max(1, shopCurrency.priceIncrementMinor);
    // A deposit may never exceed the qualifying merchandise value, and a
    // positive cash balance must remain for collection on delivery. The cap
    // stays on the currency increment, so a discounted basis never pushes the
    // deposit off the increment and leaves a balance the courier cannot
    // collect.
    const maxQualifyingDeposit = Math.floor(qualifyingMerchandiseMinor / step) * step;
    if (maxQualifyingDeposit <= 0) {
        // The qualifying merchandise is worth less than one currency increment,
        // so it cannot carry a collectable cash deposit. The order stays a
        // normal COD order without a deposit plan instead of being refused.
        return { terms: null, error: null };
    }
    // The originally configured amount before capping, persisted for auditability.
    // A fixed deposit may be capped at the qualifying merchandise value; the
    // original configured amount must be preserved to distinguish a merchant who
    // configured 200 EGP but was capped at 150 EGP from one who configured 150 EGP.
    const configuredAmountMinor = percent === null
        ? toMinor(settings.codDepositAmount, shopCurrency.decimalPlaces)
        : manualCodPercentageDepositMinor(qualifyingMerchandiseMinor, percent, step);
    if (percent !== null && percent <= 0) {
        // The configured percentage is not a usable deposit. A stored setting
        // like this is corrupt, so the order is refused instead of being
        // placed without the deposit the merchant configured.
        return { terms: null, error: new ValidationError("Cash on delivery is unavailable for this order: the deposit must be greater than zero.") };
    }
    if (percent !== null && configuredAmountMinor <= 0) {
        // The percentage cannot be collected on the currency increment without
        // consuming the whole qualifying merchandise. The order stays a normal
        // COD order without a deposit plan: the buyer is never charged the
        // configured percentage times over.
        return { terms: null, error: null };
    }
    const depositMinor = configuredAmountMinor;
    if (depositMinor <= 0) {
        return { terms: null, error: new ValidationError("Cash on delivery is unavailable for this order: the deposit must be greater than zero.") };
    }
    // A merchant-configured amount is kept exactly as configured: an
    // off-increment fixed deposit stays off the increment, and the cash balance
    // check below then refuses COD for that currency.
    const cappedDeposit = Math.min(depositMinor, maxQualifyingDeposit);
    if (cappedDeposit >= quote.totalMinor) {
        return { terms: null, error: new ValidationError("Cash on delivery is unavailable for this order: the deposit must be less than the order total.") };
    }

    const balanceMinor = quote.totalMinor - cappedDeposit;
    const cashIssue = providers.amountIssue(COD_PAYMENT_METHOD, balanceMinor, quote.currencyCode);
    if (cashIssue) return { terms: null, error: new ValidationError(cashIssue, { reason: CASH_ON_DELIVERY_AMOUNT_REASON }) };

    return {
        terms: {
            depositMinor: cappedDeposit,
            balanceMinor,
            percent,
            instructions: settings.codDepositInstructions || null,
            originalAmountMinor: depositMinor,
        },
        error: null,
    };
}
