import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Database } from "@scalius/database/client";
import { getCheckoutConfig } from "./config";
import {
    checkoutDocument,
    currencyDocument,
    customerAuthDocument,
    customerCountriesDocument,
    marketingConsentDocument,
    paymentMethodsDocument,
    stripeDocument,
    selectDocumentsWithSellingCountries,
} from "../settings";
import { getOfferedCustomerIdentity } from "../customers";
import { readPresenceMarketWithDocuments, readStoreCurrency } from "../markets";
import { getCheckoutReadiness } from "./readiness";
import { isReady } from "@scalius/shared/readiness";
import { getPaymentGatewaySettingsSnapshot } from "../payments";
import type { CheckoutConfig } from "./config";

vi.mock("../settings", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as Record<string, unknown>),
        checkoutDocument: {
            fromRows: vi.fn(),
        },
        currencyDocument: {
            fromRows: vi.fn(),
        },
        customerAuthDocument: {
            fromRows: vi.fn(),
        },
        customerCountriesDocument: {
            fromRows: vi.fn(),
        },
        marketingConsentDocument: {
            fromRows: vi.fn(),
        },
        paymentMethodsDocument: {
            fromRows: vi.fn(),
        },
        stripeDocument: {
            fromRows: vi.fn(),
        },
        selectDocumentsWithSellingCountries: vi.fn(),
        acceptedCustomerCountries: vi.fn(() => ({
            allowedCountries: ["BD"],
            allowedCountriesMode: "include",
        })),
    };
});

vi.mock("../customers", () => ({
    getOfferedCustomerIdentity: vi.fn(),
}));

vi.mock("../markets", () => ({
    readPresenceMarketWithDocuments: vi.fn(),
    readStoreCurrency: vi.fn(),
}));

vi.mock("./readiness", () => ({
    getCheckoutReadiness: vi.fn(),
}));

vi.mock("@scalius/shared/readiness", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as Record<string, unknown>),
        isReady: vi.fn(() => true),
    };
});

vi.mock("../payments", () => ({
    getPaymentGatewaySettingsSnapshot: vi.fn(),
    BUILT_IN_PAYMENT_PROVIDERS: {},
}));

vi.mock("./flow", () => ({
    isCheckoutGatewayUsableForFlow: vi.fn(() => true),
}));

vi.mock("../translations", () => ({
    translationScope: vi.fn(() => null),
    applyTranslation: vi.fn((gateway) => gateway),
    readTranslationChains: vi.fn(),
}));

function mockDb(rows: any[]): Database {
    return {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue(rows[0]),
                }),
            }),
        }) as any,
    } as unknown as Database;
}

describe("getCheckoutConfig — codDeposit output", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("returns codDeposit with enabled=false when checkout settings have codDepositEnabled=false", async () => {
        const checkout = {
            guestCheckoutEnabled: true,
            checkoutMode: "all" as const,
            partialPaymentEnabled: false,
            partialPaymentAmount: 0,
            autoFulfilMode: "after_payment" as const,
            requireFullBillingAddress: false,
            codDepositEnabled: false,
            codDepositMode: "fixed" as const,
            codDepositAmount: 0,
            codDepositPercent: 0,
            codDepositInstructions: "",
        };
        const currency = { code: "BDT", currencyCode: "BDT" as const, symbol: "Tk", currencySymbol: "Tk" };
        const customerAuth = {
            email: "optional" as const,
            whatsapp: "off" as const,
            channels: ["email"],
            phoneOptionalForDigital: false,
        };
        const merchantCountries = { allowedCountries: ["BD"], allowedCountriesMode: "include" as const };
        const marketing = {
            checkout: { enabled: false, channels: [], label: { en: "", bn: "" } },
            emailDoubleOptIn: false,
        };

        (vi.mocked(selectDocumentsWithSellingCountries)).mockResolvedValue({
            rows: [],
            sellingCountries: ["BD"],
        });
        (vi.mocked(checkoutDocument.fromRows)).mockResolvedValue({ value: checkout } as any);
        (vi.mocked(currencyDocument.fromRows)).mockResolvedValue({ value: currency } as any);
        (vi.mocked(customerAuthDocument.fromRows)).mockResolvedValue({ value: customerAuth } as any);
        (vi.mocked(customerCountriesDocument.fromRows)).mockResolvedValue({ value: merchantCountries } as any);
        (vi.mocked(marketingConsentDocument.fromRows)).mockResolvedValue({ value: marketing } as any);
        (vi.mocked(getOfferedCustomerIdentity)).mockResolvedValue({
            email: "optional",
            whatsapp: "off",
            channels: ["email"],
            phoneOptionalForDigital: false,
        });
        (vi.mocked(getCheckoutReadiness)).mockResolvedValue({
            status: "ready",
            issues: [],
            hasActiveShippingMethod: true,
            hasActiveDeliveryHierarchy: true,
            customerSignInRequired: false,
            hasUsableCustomerSignIn: true,
        });
        (vi.mocked(isReady)).mockReturnValue(true);
        (vi.mocked(getPaymentGatewaySettingsSnapshot)).mockResolvedValue({
            preferences: { enabledMethods: [], defaultMethod: "cod", hasExplicitEnabledMethods: false, netTerms: { dueInDays: 30, customerTags: [], segmentIds: [], appsDecide: false } },
            activePaymentMethods: { enabledMethods: [], defaultMethod: "cod", netTerms: { dueInDays: 30, customerTags: [], segmentIds: [], appsDecide: false } },
            providers: undefined,
            settings: { stripe: null, cod: { enabled: true } },
        });

        const db = mockDb([]) as any;
        const config = await getCheckoutConfig(db);
        expect(config.codDeposit).toMatchObject({
            enabled: false,
            mode: "fixed",
            amount: 0,
            percent: 0,
            instructions: "",
        });
    });

    it("returns codDeposit with enabled=true when checkout settings have codDepositEnabled=true", async () => {
        const checkout = {
            guestCheckoutEnabled: true,
            checkoutMode: "all" as const,
            partialPaymentEnabled: false,
            partialPaymentAmount: 0,
            autoFulfilMode: "after_payment" as const,
            requireFullBillingAddress: false,
            codDepositEnabled: true,
            codDepositMode: "percentage" as const,
            codDepositAmount: 0,
            codDepositPercent: 10,
            codDepositInstructions: "Pay 10% deposit before delivery.",
        };
        const currency = { code: "BDT", currencyCode: "BDT" as const, symbol: "Tk", currencySymbol: "Tk" };
        const customerAuth = {
            email: "optional" as const,
            whatsapp: "off" as const,
            channels: ["email"],
            phoneOptionalForDigital: false,
        };
        const merchantCountries = { allowedCountries: ["BD"], allowedCountriesMode: "include" as const };
        const marketing = {
            checkout: { enabled: false, channels: [], label: { en: "", bn: "" } },
            emailDoubleOptIn: false,
        };

        (vi.mocked(selectDocumentsWithSellingCountries)).mockResolvedValue({
            rows: [],
            sellingCountries: ["BD"],
        });
        (vi.mocked(checkoutDocument.fromRows)).mockResolvedValue({ value: checkout } as any);
        (vi.mocked(currencyDocument.fromRows)).mockResolvedValue({ value: currency } as any);
        (vi.mocked(customerAuthDocument.fromRows)).mockResolvedValue({ value: customerAuth } as any);
        (vi.mocked(customerCountriesDocument.fromRows)).mockResolvedValue({ value: merchantCountries } as any);
        (vi.mocked(marketingConsentDocument.fromRows)).mockResolvedValue({ value: marketing } as any);
        (vi.mocked(getOfferedCustomerIdentity)).mockResolvedValue({
            email: "optional",
            whatsapp: "off",
            channels: ["email"],
            phoneOptionalForDigital: false,
        });
        (vi.mocked(getCheckoutReadiness)).mockResolvedValue({
            status: "ready",
            issues: [],
            hasActiveShippingMethod: true,
            hasActiveDeliveryHierarchy: true,
            customerSignInRequired: false,
            hasUsableCustomerSignIn: true,
        });
        (vi.mocked(isReady)).mockReturnValue(true);
        (vi.mocked(getPaymentGatewaySettingsSnapshot)).mockResolvedValue({
            preferences: { enabledMethods: [], defaultMethod: "cod", hasExplicitEnabledMethods: false, netTerms: { dueInDays: 30, customerTags: [], segmentIds: [], appsDecide: false } },
            activePaymentMethods: { enabledMethods: [], defaultMethod: "cod", netTerms: { dueInDays: 30, customerTags: [], segmentIds: [], appsDecide: false } },
            providers: undefined,
            settings: { stripe: null, cod: { enabled: true } },
        });

        const db = mockDb([]) as any;
        const config = await getCheckoutConfig(db);
        expect(config.codDeposit).toMatchObject({
            enabled: true,
            mode: "percentage",
            amount: 0,
            percent: 10,
            instructions: "Pay 10% deposit before delivery.",
        });
    });

    it("returns codDeposit instructions from checkout settings", async () => {
        const checkout = {
            guestCheckoutEnabled: true,
            checkoutMode: "all" as const,
            partialPaymentEnabled: false,
            partialPaymentAmount: 0,
            autoFulfilMode: "after_payment" as const,
            requireFullBillingAddress: false,
            codDepositEnabled: true,
            codDepositMode: "fixed" as const,
            codDepositAmount: 500,
            codDepositPercent: 0,
            codDepositInstructions: "Deposit 500 BDT before fulfilment.",
        };
        const currency = { code: "BDT", currencyCode: "BDT" as const, symbol: "Tk", currencySymbol: "Tk" };
        const customerAuth = {
            email: "optional" as const,
            whatsapp: "off" as const,
            channels: ["email"],
            phoneOptionalForDigital: false,
        };
        const merchantCountries = { allowedCountries: ["BD"], allowedCountriesMode: "include" as const };
        const marketing = {
            checkout: { enabled: false, channels: [], label: { en: "", bn: "" } },
            emailDoubleOptIn: false,
        };

        (vi.mocked(selectDocumentsWithSellingCountries)).mockResolvedValue({
            rows: [],
            sellingCountries: ["BD"],
        });
        (vi.mocked(checkoutDocument.fromRows)).mockResolvedValue({ value: checkout } as any);
        (vi.mocked(currencyDocument.fromRows)).mockResolvedValue({ value: currency } as any);
        (vi.mocked(customerAuthDocument.fromRows)).mockResolvedValue({ value: customerAuth } as any);
        (vi.mocked(customerCountriesDocument.fromRows)).mockResolvedValue({ value: merchantCountries } as any);
        (vi.mocked(marketingConsentDocument.fromRows)).mockResolvedValue({ value: marketing } as any);
        (vi.mocked(getOfferedCustomerIdentity)).mockResolvedValue({
            email: "optional",
            whatsapp: "off",
            channels: ["email"],
            phoneOptionalForDigital: false,
        });
        (vi.mocked(getCheckoutReadiness)).mockResolvedValue({
            status: "ready",
            issues: [],
            hasActiveShippingMethod: true,
            hasActiveDeliveryHierarchy: true,
            customerSignInRequired: false,
            hasUsableCustomerSignIn: true,
        });
        (vi.mocked(isReady)).mockReturnValue(true);
        (vi.mocked(getPaymentGatewaySettingsSnapshot)).mockResolvedValue({
            preferences: { enabledMethods: [], defaultMethod: "cod", hasExplicitEnabledMethods: false, netTerms: { dueInDays: 30, customerTags: [], segmentIds: [], appsDecide: false } },
            activePaymentMethods: { enabledMethods: [], defaultMethod: "cod", netTerms: { dueInDays: 30, customerTags: [], segmentIds: [], appsDecide: false } },
            providers: undefined,
            settings: { stripe: null, cod: { enabled: true } },
        });

        const db = mockDb([]) as any;
        const config = await getCheckoutConfig(db);
        expect(config.codDeposit.instructions).toBe("Deposit 500 BDT before fulfilment.");
    });
});
