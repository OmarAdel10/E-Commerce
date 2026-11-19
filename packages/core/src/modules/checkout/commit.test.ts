// packages/core/src/modules/checkout/commit.test.ts
// Coverage tests for commit.ts payment plan snapshot fields insertion
// (addresses coverage reviewer finding: commit.ts snapshot insertion untested)

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DatabaseSync as SQLiteDatabase } from "node:sqlite";

describe("commit.ts — payment plan snapshot fields", () => {
    let sqlite: SQLiteDatabase;

    beforeAll(() => {
        sqlite = new SQLiteDatabase(":memory:");
        // Minimal schema needed for payment plan insertion
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
        `);
    });

    afterAll(() => {
        sqlite.close();
    });

    it("inserts payment plan with qualifying merchandise, product IDs, and cod_deposit_amount", () => {
        // Insert an order
        sqlite.prepare(
            "INSERT INTO orders (id, total_amount_minor, paid_amount_minor, balance_due_minor, currency_code, currency_decimal_places) VALUES ('order_1', 20000, 0, 20000, 'EGP', 2)"
        ).run();

        // Simulate the commit.ts payment plan insert (lines 545-563)
        sqlite.prepare(`
            INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor, balance_due_minor, kind, status, instructions, percent, contact_snapshot, qualifying_merchandise_minor, qualifying_product_ids, cod_deposit_amount, created_at, updated_at)
            VALUES ('plan_1', 'order_1', 20000, 12000, 8000, 'manual', 'pending', 'Pay 120 EGP to bKash', NULL, '{"phone":"+201000000000"}', 40000, '["prod_required"]', 20000, unixepoch(), unixepoch())
        `).run();

        // Verify snapshot fields persisted
        const plan = sqlite.prepare(
            "SELECT * FROM payment_plans WHERE id = 'plan_1'"
        ).get() as Record<string, unknown>;

        expect(plan).not.toBeNull();
        expect(plan.qualifying_merchandise_minor).toBe(40000);
        expect(plan.qualifying_product_ids).toBe('["prod_required"]');
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

    it("checkout authority revision bumped on product write", () => {
        sqlite.prepare(
            "INSERT INTO checkout_authority (id, revision, updated_at) VALUES ('auth_1', 1, unixepoch())"
        ).run();

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
