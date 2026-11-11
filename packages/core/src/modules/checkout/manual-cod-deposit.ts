import { manualCodPercentageDepositMinor, type ManualCodDepositTerms } from "@scalius/shared/checkout-payment";
import type { PricingCurrency } from "@scalius/shared/currency-policy";
import { toMinor } from "@scalius/shared/money";
import { CASH_ON_DELIVERY_AMOUNT_REASON, COD_PAYMENT_METHOD, type PaymentProviders } from "../payments";
import { ValidationError } from "../../errors";
import type { CheckoutFlowSettings } from "../settings";
import type { TaxQuote } from "../tax/browser";

/** The same deposit decision drives the offered COD method and its order. */
export function resolveManualCodDeposit(
    settings: Pick<CheckoutFlowSettings, "codDepositEnabled" | "codDepositMode" | "codDepositAmount" | "codDepositPercent" | "codDepositInstructions"> | null,
    quote: Pick<TaxQuote, "totalMinor" | "currencyCode">,
    shopCurrency: PricingCurrency,
    cart: { allowsCashOnDelivery: boolean; giftCardsApplied: boolean },
    providers: PaymentProviders,
): { terms: ManualCodDepositTerms | null; error: ValidationError | null } {
    if (!settings?.codDepositEnabled) return { terms: null, error: null };
    if (!cart.allowsCashOnDelivery || cart.giftCardsApplied || quote.currencyCode !== shopCurrency.code) {
        return { terms: null, error: new ValidationError("Cash on delivery is unavailable for this order.") };
    }

    const percent = settings.codDepositMode === "percentage" ? settings.codDepositPercent : null;
    const depositMinor = percent === null
        ? toMinor(settings.codDepositAmount, shopCurrency.decimalPlaces)
        : manualCodPercentageDepositMinor(quote.totalMinor, percent, shopCurrency.priceIncrementMinor);
    if (depositMinor <= 0) {
        return { terms: null, error: new ValidationError("Cash on delivery is unavailable for this order: the deposit must be greater than zero.") };
    }
    if (depositMinor >= quote.totalMinor) {
        return { terms: null, error: new ValidationError("Cash on delivery is unavailable for this order: the deposit must be less than the order total.") };
    }

    const balanceMinor = quote.totalMinor - depositMinor;
    const cashIssue = providers.amountIssue(COD_PAYMENT_METHOD, balanceMinor, quote.currencyCode);
    if (cashIssue) return { terms: null, error: new ValidationError(cashIssue, { reason: CASH_ON_DELIVERY_AMOUNT_REASON }) };

    return {
        terms: { depositMinor, balanceMinor, percent, instructions: settings.codDepositInstructions || null },
        error: null,
    };
}
