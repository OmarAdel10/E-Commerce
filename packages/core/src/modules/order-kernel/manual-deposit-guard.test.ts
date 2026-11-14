import { describe, expect, it } from "vitest";
import { createSqliteD1Database, type SqliteTestDatabase } from "@scalius/database/testing/sqlite-d1";
import { PaymentPlanStatus } from "@scalius/database/schema";
import { ValidationError } from "@scalius/core/errors";
import {
    assertManualCodDepositVerified,
    ManualCodDepositBlockedError,
    readPaymentPlan,
} from "./manual-deposit-guard";

/**
 * Seed an order and, unless `withPlan` is false, its payment plan. The guard
 * reads the plan of the order it is given, so the order row has to exist for
 * the plan's foreign key.
 */
function seedOrderWithPlan(
    fixture: SqliteTestDatabase,
    options: {
        orderId?: string;
        planId?: string;
        kind?: string;
        status?: string;
        withPlan?: boolean;
    } = {},
): void {
    const orderId = options.orderId ?? "order_1";
    fixture.sqlite.exec(`
      INSERT INTO orders (id, customer_name, customer_phone, shipping_address, city, zone,
        status, payment_method, payment_status, total_amount_minor, paid_amount_minor,
        balance_due_minor, currency_code, currency_decimal_places, version)
      VALUES ('${orderId}', 'Buyer', '01711111111', 'Road 1', 'Dhaka', 'North',
        'pending', 'cod', 'unpaid', 10000, 0, 10000, 'BDT', 2, 1);
    `);
    if (options.withPlan === false) return;
    fixture.sqlite.exec(`
      INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor,
        balance_due_minor, kind, status)
      VALUES ('${options.planId ?? "plan_1"}', '${orderId}', 10000, 2000, 8000,
        '${options.kind ?? "manual"}', '${options.status ?? PaymentPlanStatus.PENDING}');
    `);
}

describe("readPaymentPlan", () => {
    it("returns null when the order has no payment plan", async () => {
        const fixture = createSqliteD1Database();
        try {
            seedOrderWithPlan(fixture, { withPlan: false });
            await expect(readPaymentPlan(fixture.db, "order_1")).resolves.toBeNull();
        } finally {
            fixture.sqlite.close();
        }
    });

    it("returns the plan row of the given order", async () => {
        const fixture = createSqliteD1Database();
        try {
            seedOrderWithPlan(fixture, { status: PaymentPlanStatus.PENDING });
            await expect(readPaymentPlan(fixture.db, "order_1")).resolves.toEqual({
                id: "plan_1",
                status: PaymentPlanStatus.PENDING,
                kind: "manual",
            });
        } finally {
            fixture.sqlite.close();
        }
    });

    it("reads each order's own plan", async () => {
        const fixture = createSqliteD1Database();
        try {
            seedOrderWithPlan(fixture, { orderId: "order_1", planId: "plan_1", status: PaymentPlanStatus.DEPOSIT_PAID });
            seedOrderWithPlan(fixture, { orderId: "order_2", planId: "plan_2", status: PaymentPlanStatus.CANCELLED });
            await expect(readPaymentPlan(fixture.db, "order_2")).resolves.toEqual({
                id: "plan_2",
                status: PaymentPlanStatus.CANCELLED,
                kind: "manual",
            });
        } finally {
            fixture.sqlite.close();
        }
    });
});

describe("assertManualCodDepositVerified", () => {
    it("refuses an order whose manual deposit was never recorded", async () => {
        const fixture = createSqliteD1Database();
        try {
            seedOrderWithPlan(fixture, { status: PaymentPlanStatus.PENDING });
            await expect(assertManualCodDepositVerified(fixture.db, "order_1")).rejects.toThrow(
                "The deposit must be recorded before this order can move on.",
            );
        } finally {
            fixture.sqlite.close();
        }
    });

    it("refuses an order whose manual deposit was refunded", async () => {
        const fixture = createSqliteD1Database();
        try {
            seedOrderWithPlan(fixture, { status: PaymentPlanStatus.CANCELLED });
            await expect(assertManualCodDepositVerified(fixture.db, "order_1")).rejects.toThrow(
                "This order's deposit was refunded. Fulfilment is blocked.",
            );
        } finally {
            fixture.sqlite.close();
        }
    });

    it("raises the typed refusal, not a plain error, so callers can treat it as permanent", async () => {
        const fixture = createSqliteD1Database();
        try {
            seedOrderWithPlan(fixture, { status: PaymentPlanStatus.PENDING });
            const error = await assertManualCodDepositVerified(fixture.db, "order_1").catch((e: unknown) => e);
            expect(error).toBeInstanceOf(ManualCodDepositBlockedError);
            expect(error).toBeInstanceOf(ValidationError);
        } finally {
            fixture.sqlite.close();
        }
    });

    it("allows the order once the deposit is recorded", async () => {
        const fixture = createSqliteD1Database();
        try {
            seedOrderWithPlan(fixture, { status: PaymentPlanStatus.DEPOSIT_PAID });
            await expect(assertManualCodDepositVerified(fixture.db, "order_1")).resolves.toBeUndefined();
        } finally {
            fixture.sqlite.close();
        }
    });

    it("allows the order when the plan is completed", async () => {
        const fixture = createSqliteD1Database();
        try {
            seedOrderWithPlan(fixture, { status: PaymentPlanStatus.COMPLETED });
            await expect(assertManualCodDepositVerified(fixture.db, "order_1")).resolves.toBeUndefined();
        } finally {
            fixture.sqlite.close();
        }
    });

    it("allows an order that has no payment plan", async () => {
        const fixture = createSqliteD1Database();
        try {
            seedOrderWithPlan(fixture, { withPlan: false });
            await expect(assertManualCodDepositVerified(fixture.db, "order_1")).resolves.toBeUndefined();
        } finally {
            fixture.sqlite.close();
        }
    });

    it("does not hold an online payment plan", async () => {
        const fixture = createSqliteD1Database();
        try {
            seedOrderWithPlan(fixture, { kind: "online", status: PaymentPlanStatus.PENDING });
            await expect(assertManualCodDepositVerified(fixture.db, "order_1")).resolves.toBeUndefined();
        } finally {
            fixture.sqlite.close();
        }
    });
});
