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
        ...actual,
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
        ...actual,
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
            checkoutMode: "all",
            partialPaymentEnabled: false,
            partialPaymentAmount: 0,
            requireFullBillingAddress: false,
            codDepositEnabled: false,
            codDepositMode: "fixed",
            codDepositAmount: 0,
            codDepositPercent: 0,
            codDepositInstructions: "",
        };
        const currency = { code: "BDT", currencyCode: "BDT", symbol: "Tk", currencySymbol: "Tk" };
        const customerAuth = {};
        const merchantCountries = { allowedCountries: ["BD"], allowedCountriesMode: "include" };
        const marketing = { checkout: { enabled: false, channels: [], label: { en: "", bn: "" } } };

        (vi.mocked(selectDocumentsWithSellingCountries)).mockResolvedValue({
            rows: [],
            sellingCountries: ["BD"],
        });
        (vi.mocked(checkoutDocument.fromRows)).mockResolvedValue({ value: checkout });
        (vi.mocked(currencyDocument.fromRows)).mockResolvedValue({ value: currency });
        (vi.mocked(customerAuthDocument.fromRows)).mockResolvedValue({ value: customerAuth });
        (vi.mocked(customerCountriesDocument.fromRows)).mockResolvedValue({ value: merchantCountries });
        (vi.mocked(marketingConsentDocument.fromRows)).mockResolvedValue({ value: marketing });
        (vi.mocked(getOfferedCustomerIdentity)).mockResolvedValue({});
        (vi.mocked(getCheckoutReadiness)).mockResolvedValue({});
        (vi.mocked(isReady)).mockReturnValue(true);
        (vi.mocked(getPaymentGatewaySettingsSnapshot)).mockResolvedValue({
            activePaymentMethods: { enabledMethods: [], defaultMethod: undefined, netTerms: { dueInDays: 0 } },
            providers: undefined,
            settings: {},
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
            checkoutMode: "all",
            partialPaymentEnabled: false,
            partialPaymentAmount: 0,
            requireFullBillingAddress: false,
            codDepositEnabled: true,
            codDepositMode: "percentage",
            codDepositAmount: 0,
            codDepositPercent: 10,
            codDepositInstructions: "Pay 10% deposit before delivery.",
        };
        const currency = { code: "BDT", currencyCode: "BDT", symbol: "Tk", currencySymbol: "Tk" };
        const customerAuth = {};
        const merchantCountries = { allowedCountries: ["BD"], allowedCountriesMode: "include" };
        const marketing = { checkout: { enabled: false, channels: [], label: { en: "", bn: "" } } };

        (vi.mocked(selectDocumentsWithSellingCountries)).mockResolvedValue({
            rows: [],
            sellingCountries: ["BD"],
        });
        (vi.mocked(checkoutDocument.fromRows)).mockResolvedValue({ value: checkout });
        (vi.mocked(currencyDocument.fromRows)).mockResolvedValue({ value: currency });
        (vi.mocked(customerAuthDocument.fromRows)).mockResolvedValue({ value: customerAuth });
        (vi.mocked(customerCountriesDocument.fromRows)).mockResolvedValue({ value: merchantCountries });
        (vi.mocked(marketingConsentDocument.fromRows)).mockResolvedValue({ value: marketing });
        (vi.mocked(getOfferedCustomerIdentity)).mockResolvedValue({});
        (vi.mocked(getCheckoutReadiness)).mockResolvedValue({});
        (vi.mocked(isReady)).mockReturnValue(true);
        (vi.mocked(getPaymentGatewaySettingsSnapshot)).mockResolvedValue({
            activePaymentMethods: { enabledMethods: [], defaultMethod: undefined, netTerms: { dueInDays: 0 } },
            providers: undefined,
            settings: {},
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
            checkoutMode: "all",
            partialPaymentEnabled: false,
            partialPaymentAmount: 0,
            requireFullBillingAddress: false,
            codDepositEnabled: true,
            codDepositMode: "fixed",
            codDepositAmount: 500,
            codDepositPercent: 0,
            codDepositInstructions: "Deposit 500 BDT before fulfilment.",
        };
        const currency = { code: "BDT", currencyCode: "BDT", symbol: "Tk", currencySymbol: "Tk" };
        const customerAuth = {};
        const merchantCountries = { allowedCountries: ["BD"], allowedCountriesMode: "include" };
        const marketing = { checkout: { enabled: false, channels: [], label: { en: "", bn: "" } } };

        (vi.mocked(selectDocumentsWithSellingCountries)).mockResolvedValue({
            rows: [],
            sellingCountries: ["BD"],
        });
        (vi.mocked(checkoutDocument.fromRows)).mockResolvedValue({ value: checkout });
        (vi.mocked(currencyDocument.fromRows)).mockResolvedValue({ value: currency });
        (vi.mocked(customerAuthDocument.fromRows)).mockResolvedValue({ value: customerAuth });
        (vi.mocked(customerCountriesDocument.fromRows)).mockResolvedValue({ value: merchantCountries });
        (vi.mocked(marketingConsentDocument.fromRows)).mockResolvedValue({ value: marketing });
        (vi.mocked(getOfferedCustomerIdentity)).mockResolvedValue({});
        (vi.mocked(getCheckoutReadiness)).mockResolvedValue({});
        (vi.mocked(isReady)).mockReturnValue(true);
        (vi.mocked(getPaymentGatewaySettingsSnapshot)).mockResolvedValue({
            activePaymentMethods: { enabledMethods: [], defaultMethod: undefined, netTerms: { dueInDays: 0 } },
            providers: undefined,
            settings: {},
        });

        const db = mockDb([]) as any;
        const config = await getCheckoutConfig(db);
        expect(config.codDeposit.instructions).toBe("Deposit 500 BDT before fulfilment.");
    });
});
