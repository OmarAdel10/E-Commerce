import type { Database } from "@scalius/database/client";
import { ValidationError } from "@scalius/core/errors";

import type { PaymentProviders } from "../payments";
import { getCheckoutFlowValidationIssues } from "./flow";
import { type AutoFulfilMode, checkoutDocument, type CheckoutFlowSettings, type CheckoutMode, toStoreMinor } from "../settings";
import { readStoreCurrency } from "../markets";

export interface CheckoutFlowSettingsDocument extends CheckoutFlowSettings {
    /** 0 until the first save. */
    revision: number;
}

export interface SaveCheckoutFlowSettingsInput {
    guestCheckoutEnabled: boolean;
    checkoutMode: CheckoutMode;
    partialPaymentEnabled: boolean;
    partialPaymentAmount: number;
    /** Omitted = keep the saved mode (Settings → Checkout → Downloads and gift cards sends it). */
    autoFulfilMode?: AutoFulfilMode;
    /** Omitted = keep the saved choice. */
    requireFullBillingAddress?: boolean;
    /** Omitted = keep the saved choice. */
    codDepositEnabled?: boolean;
    /** Omitted = keep the saved choice. */
    codDepositMode?: "fixed" | "percentage";
    /** Omitted = keep the saved choice. */
    codDepositAmount?: number;
    /** Omitted = keep the saved choice. */
    codDepositPercent?: number;
    /** Omitted = keep the saved choice. */
    codDepositInstructions?: string;
    expectedRevision: number;
    availablePaymentMethods: readonly string[];
    /** The request's gateways, for app gateways' amount limits. */
    paymentProviders?: PaymentProviders;
}

export async function getCheckoutFlowSettingsDocument(
    db: Database,
): Promise<CheckoutFlowSettingsDocument> {
    const { value, revision } = await checkoutDocument.readDetailed(db, {}, { skipCache: true });
    return { ...value, revision };
}

export async function saveCheckoutFlowSettingsDocument(
    db: Database,
    input: SaveCheckoutFlowSettingsInput,
): Promise<CheckoutFlowSettingsDocument> {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new ValidationError("A non-negative checkout settings revision is required.");
    }
    if (input.codDepositAmount !== undefined && (!Number.isFinite(input.codDepositAmount) || input.codDepositAmount < 0)) {
        throw new ValidationError("Cash on delivery deposit amount must be zero or greater.");
    }
    if (input.codDepositPercent !== undefined && (!Number.isInteger(input.codDepositPercent) || input.codDepositPercent < 0 || input.codDepositPercent > 99)) {
        throw new ValidationError("Cash on delivery deposit percentage must be a whole number between 0 and 99.");
    }

    const storeCurrency = await readStoreCurrency(db);
    const saved = await getCheckoutFlowSettingsDocument(db);
    const deposit = {
        codDepositEnabled: input.codDepositEnabled ?? saved.codDepositEnabled,
        codDepositMode: input.codDepositMode ?? saved.codDepositMode,
        codDepositAmount: input.codDepositAmount ?? saved.codDepositAmount,
        codDepositPercent: input.codDepositPercent ?? saved.codDepositPercent,
    };
    const issues = getCheckoutFlowValidationIssues({
        checkoutMode: input.checkoutMode,
        partialPaymentEnabled: input.partialPaymentEnabled,
        partialPaymentAmount: input.partialPaymentAmount,
        ...deposit,
        availablePaymentMethods: input.availablePaymentMethods,
        paymentProviders: input.paymentProviders,
        currencyCode: storeCurrency.code,
    });
    if (issues.length > 0) throw new ValidationError(issues.join(" "));
    // The advance a buyer pays online is money like any other: whole taka in BDT.
    if (input.partialPaymentEnabled) toStoreMinor(input.partialPaymentAmount, storeCurrency);
    // A supplied fixed amount must fit the store's price increment, even when
    // the buyer currently pays a percentage. Omitted inactive values stay saved.
    const fixedAmount = deposit.codDepositEnabled && deposit.codDepositMode === "fixed"
        ? deposit.codDepositAmount
        : input.codDepositAmount;
    if (fixedAmount !== undefined) toStoreMinor(fixedAmount, storeCurrency);

    const { value, revision } = await checkoutDocument.write(db, {
        guestCheckoutEnabled: input.guestCheckoutEnabled,
        checkoutMode: input.checkoutMode,
        partialPaymentEnabled: input.partialPaymentEnabled,
        partialPaymentAmount: input.partialPaymentAmount,
        ...(input.autoFulfilMode === undefined ? {} : { autoFulfilMode: input.autoFulfilMode }),
        ...(input.requireFullBillingAddress === undefined ? {} : { requireFullBillingAddress: input.requireFullBillingAddress }),
        ...(input.codDepositEnabled === undefined ? {} : { codDepositEnabled: input.codDepositEnabled }),
        ...(input.codDepositMode === undefined ? {} : { codDepositMode: input.codDepositMode }),
        ...(input.codDepositAmount === undefined ? {} : { codDepositAmount: input.codDepositAmount }),
        ...(input.codDepositPercent === undefined ? {} : { codDepositPercent: input.codDepositPercent }),
        ...(input.codDepositInstructions === undefined ? {} : { codDepositInstructions: input.codDepositInstructions }),
    }, {}, { expectedRevision: input.expectedRevision });
    return { ...value, revision };
}
