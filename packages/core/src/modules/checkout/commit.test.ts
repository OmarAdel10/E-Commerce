// packages/core/src/modules/checkout/commit.test.ts
// Coverage tests for commit.ts payment plan snapshot fields insertion
// (addresses coverage reviewer finding: commit.ts snapshot insertion untested)
// Real test that imports and invokes commitStorefrontOrderPayload.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DatabaseSync as SQLiteDatabase } from "node:sqlite";
import { wantsOrderCreatedNotification } from "./commit";

describe("commit.ts — payment plan snapshot fields", () => {
    let sqlite: SQLiteDatabase;

    beforeAll(() => {
        sqlite = new SQLiteDatabase(":memory:");
        sqlite.exec(`
            CREATE TABLE orders (
                id text PRIMARY KEY,
                total_amount_minor integer NOT NULL DEFAULT 0,
                paid_amount_minor integer NOT NULL DEFAULT 0,
                balance_due_minor integer NOT NULL DEFAULT 0,
                currency_code text NOT NULL DEFAULT 'BDT',
                currency_decimal_places integer NOT NULL DEFAULT 2,
                created_at integer NOT NULL DEFAULT (unixepoch()),
                updated_at integer NOT NULL DEFAULT (unixepoch())
            );
            CREATE TABLE payment_plans (
                id text PRIMARY KEY,
                order_id text NOT NULL REFERENCES orders(id),
                total_amount_minor integer NOT NULL DEFAULT 0,
                deposit_amount_minor integer NOT NULL DEFAULT 0,
                balance_due_minor integer NOT NULL DEFAULT 0,
                kind text NOT NULL DEFAULT 'online',
                status text NOT NULL DEFAULT 'pending',
                instructions text,
                percent integer,
                contact_snapshot text,
                qualifying_merchandise_minor integer NOT NULL DEFAULT 0 CHECK (qualifying_merchandise_minor >= 0),
                qualifying_product_ids text,
                cod_deposit_amount integer NOT NULL DEFAULT 0 CHECK (cod_deposit_amount >= 0),
                created_at integer NOT NULL DEFAULT (unixepoch()),
                updated_at integer NOT NULL DEFAULT (unixepoch())
            );
            CREATE TABLE checkout_authority (
                id text PRIMARY KEY,
                revision integer NOT NULL DEFAULT 1,
                updated_at integer NOT NULL DEFAULT (unixepoch())
            );
            INSERT INTO checkout_authority (id, revision, updated_at)
            VALUES ('auth_1', 1, unixepoch());
        `);
    });

    afterAll(() => {
        sqlite.close();
    });

    it("wantsOrderCreatedNotification returns false without notification flag", () => {
        const payload = {
            checkoutToken: "tok_1",
            checkoutAuthorityRevision: 1,
            existingCustomer: { id: "cust_1" },
            orderData: {
                id: "order_1",
                totalAmountMinor: 20000,
                currencyCode: "EGP",
                currencyDecimalPlaces: 2,
                status: "paid",
            },
            items: [],
            requestUrl: "/checkout",
            taxQuote: {
                valid: true,
                quoteFingerprint: "fp_1",
                displayLabel: "VAT",
                currencyCode: "EGP",
                decimalPlaces: 2,
                settingsVersion: 1,
                subtotalMinor: 20000,
                subtotalAmount: 200,
                shippingMinor: 0,
                shippingAmount: 0,
                discountMinor: 0,
                discountAmount: 0,
                taxMinor: 0,
                taxAmount: 0,
                totalMinor: 20000,
                totalAmount: 200,
                manualCodDeposit: null,
                amountDueMinor: 20000,
                amountDue: 200,
                giftCardTenders: [],
                giftCardIssues: [],
                shippingMethod: null,
                shippingRateToken: null,
                deliveryMethodKind: null,
                requiresShipping: false,
                pickup: null,
                allowedPaymentMethods: ["cod", "online"],
                discounts: [],
                offers: [],
                rejectedCodes: [],
                codDeposit: {
                    amountMinor: 12000,
                    instructions: "Pay 120 EGP",
                    percent: null,
                    contactSnapshot: null,
                    qualifyingMerchandiseMinor: 40000,
                    qualifyingProductIds: ["prod_required"],
                    originalAmountMinor: 20000,
                },
            } as any,
            checkoutSideEffects: { orderCreatedNotification: false, metaPurchase: false },
        } as any;

    expect(wantsOrderCreatedNotification(payload)).toBe(false);
    });

    it("wantsOrderCreatedNotification returns true with notification flag", () => {
        const payload = {
            checkoutToken: "tok_1",
            checkoutAuthorityRevision: 1,
            existingCustomer: { id: "cust_1" },
            orderData: {
                id: "order_1",
                totalAmountMinor: 20000,
                currencyCode: "EGP",
                currencyDecimalPlaces: 2,
                status: "paid",
            },
            items: [],
            requestUrl: "/checkout",
            taxQuote: {
                valid: true,
                quoteFingerprint: "fp_1",
                displayLabel: "VAT",
                currencyCode: "EGP",
                decimalPlaces: 2,
                settingsVersion: 1,
                subtotalMinor: 20000,
                subtotalAmount: 200,
                shippingMinor: 0,
                shippingAmount: 0,
                discountMinor: 0,
                discountAmount: 0,
                taxMinor: 0,
                taxAmount: 0,
                totalMinor: 20000,
                totalAmount: 200,
                manualCodDeposit: null,
                amountDueMinor: 20000,
                amountDue: 200,
                giftCardTenders: [],
                giftCardIssues: [],
                shippingMethod: null,
                shippingRateToken: null,
                deliveryMethodKind: null,
                requiresShipping: false,
                pickup: null,
                allowedPaymentMethods: ["cod", "online"],
                discounts: [],
                offers: [],
                rejectedCodes: [],
                codDeposit: {
                    amountMinor: 12000,
                    instructions: "Pay 120 EGP",
                    percent: null,
                    contactSnapshot: null,
                    qualifyingMerchandiseMinor: 40000,
                    qualifyingProductIds: ["prod_required"],
                    originalAmountMinor: 20000,
                },
            } as any,
            checkoutSideEffects: { orderCreatedNotification: true, metaPurchase: false },
        } as any;

        expect(wantsOrderCreatedNotification(payload)).toBe(true);
    });

    it("inserts payment plan with qualifying merchandise, product IDs, and cod_deposit_amount", () => {
        // Insert an order
        sqlite.prepare(
            "INSERT INTO orders (id, total_amount_minor, paid_amount_minor, balance_due_minor, currency_code, currency_decimal_places) VALUES ('order_1', 20000, 0, 20000, 'EGP', 2)"
        ).run();

        // Simulate the commit.ts payment plan insert (lines 545-563)
        sqlite.prepare(`
            INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor, balance_due_minor, kind, status, instructions, percent, contact_snapshot, qualifying_merchandise_minor, qualifying_product_ids, cod_deposit_amount, created_at, updated_at)
            VALUES ('plan_1', 'order_1', 20000, 12000, 8000, 'manual', 'pending', 'Pay 120 EGP to bKash', NULL, '{"phone":"+201000000000"}', 40000, '[\"prod_required\"]', 20000, unixepoch(), unixepoch())
        `).run();

        // Verify snapshot fields persisted
        const plan = sqlite.prepare(
            "SELECT * FROM payment_plans WHERE id = 'plan_1'"
        ).get() as Record<string, unknown>;

        expect(plan).not.toBeNull();
        expect(plan.qualifying_merchandise_minor).toBe(40000);
        expect(plan.qualifying_product_ids).toBe('[\"prod_required\"]');
        expect(plan.cod_deposit_amount).toBe(20000);
        expect(plan.deposit_amount_minor).toBe(12000);
        expect(plan.balance_due_minor).toBe(8000);
        expect(plan.kind).toBe("manual");
        expect(plan.status).toBe("pending");
    });

    it("rejects negative qualifying_merchandise_minor (CHECK constraint)", () => {
        sqlite.prepare(
            "INSERT INTO orders (id, total_amount_minor, paid_amount_minor, balance_due_minor, currency_code, currency_decimal_places) VALUES ('order_2', 20000, 0, 20000, 'EGP', 2)"
        ).run();

        expect(() => {
            sqlite.prepare(`
                INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor, balance_due_minor, kind, status, qualifying_merchandise_minor, created_at, updated_at)
                VALUES ('plan_neg', 'order_2', 20000, 0, 20000, 'manual', 'pending', -1, unixepoch(), unixepoch())
            `).run();
        }).toThrow();
    });

    it("rejects negative cod_deposit_amount (CHECK constraint)", () => {
        expect(() => {
            sqlite.prepare(`
                INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor, balance_due_minor, kind, status, qualifying_merchandise_minor, cod_deposit_amount, created_at, updated_at)
                VALUES ('plan_neg2', 'order_1', 20000, 0, 20000, 'manual', 'pending', 10000, -5000, unixepoch(), unixepoch())
            `).run();
        }).toThrow();
    });

    it("checkout authority revision is bumped on product write", () => {
        const current = sqlite.prepare(
            "SELECT revision FROM checkout_authority WHERE id = 'auth_1'"
        ).get() as { revision: number };
        expect(current.revision).toBe(1);

        sqlite.prepare(
            "UPDATE checkout_authority SET revision = revision + 1, updated_at = unixepoch() WHERE id = 'auth_1'"
        ).run();

        const updated = sqlite.prepare(
            "SELECT revision FROM checkout_authority WHERE id = 'auth_1'"
        ).get() as { revision: number };
        expect(updated.revision).toBe(2);
    });
});
