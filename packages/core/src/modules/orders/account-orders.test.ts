import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1Database } from "@scalius/database/testing/sqlite-d1";
import { OrderStatus, PaymentMethod, PaymentPlanStatus, PaymentStatus, PaymentRecordStatus } from "@scalius/database/schema";
import { eq, and } from "drizzle-orm";
import { orders, paymentPlans } from "@scalius/database/schema";

describe("account-orders — pendingManualBalanceDueMinor for COD manual pending plans", () => {
  let fixture: ReturnType<typeof createSqliteD1Database>;
  beforeEach(() => {
    fixture = createSqliteD1Database();
  });
  afterEach(() => fixture.sqlite.close());

  const insertCODOrderWithManualPlan = (overrides: Partial<{
    orderId: string;
    planStatus: string;
    depositAmountMinor: number;
    balanceDueMinor: number;
  }> = {}) => {
    const id = overrides.orderId ?? "order_cod_manual_pending";
    fixture.sqlite.exec(`
      INSERT INTO orders (id, customer_name, customer_phone, shipping_address, city, zone,
        status, payment_method, payment_status, total_amount_minor, paid_amount_minor,
        balance_due_minor, currency_code, currency_decimal_places, version,
        requires_shipping, sales_channel_id)
      VALUES ('${id}', 'Buyer', '01711111111', 'Road 1', 'Dhaka', 'North',
        'pending', 'cod', 'unpaid', 10000, 0, 10000, 'BDT', 2, 1,
        1, 'web');
      INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor,
        balance_due_minor, kind, status)
      VALUES ('plan_${id}', '${id}', 10000, ${overrides.depositAmountMinor ?? 2000},
        ${overrides.balanceDueMinor ?? 8000}, 'manual', '${overrides.planStatus ?? PaymentPlanStatus.PENDING}');
    `);
    return id;
  };

  const getPendingManualBalanceDue = (orderId: string): number | null =>
    (fixture.sqlite.prepare(
      `SELECT payment_plans.balance_due_minor AS pending_manual_balance_due_minor
       FROM orders
       LEFT JOIN payment_plans ON payment_plans.order_id = orders.id
         AND orders.payment_method = 'cod'
         AND payment_plans.kind = 'manual'
         AND payment_plans.status = 'pending'
       WHERE orders.id = ?`,
    ).get(orderId) as { pending_manual_balance_due_minor: number | null })?.pending_manual_balance_due_minor ?? null;

  it("returns pending manual balance due for COD order with pending manual plan", async () => {
    const id = insertCODOrderWithManualPlan({ planStatus: PaymentPlanStatus.PENDING, depositAmountMinor: 2000, balanceDueMinor: 8000 });
    const balance = getPendingManualBalanceDue(id);
    expect(balance).toBe(8000);
  });

  it("returns null for COD order with non-pending manual plan", async () => {
    const id = insertCODOrderWithManualPlan({ planStatus: PaymentPlanStatus.DEPOSIT_PAID, depositAmountMinor: 2000, balanceDueMinor: 0 });
    const balance = getPendingManualBalanceDue(id);
    expect(balance).toBeNull();
  });

  it("returns null for non-COD order with manual plan", async () => {
    const id = "order_noncod_manual";
    fixture.sqlite.exec(`
      INSERT INTO orders (id, customer_name, customer_phone, shipping_address, city, zone,
        status, payment_method, payment_status, total_amount_minor, paid_amount_minor,
        balance_due_minor, currency_code, currency_decimal_places, version,
        requires_shipping, sales_channel_id)
      VALUES ('${id}', 'Buyer', '01711111111', 'Road 1', 'Dhaka', 'North',
        'pending', 'stripe', 'unpaid', 10000, 0, 10000, 'BDT', 2, 1,
        1, 'web');
      INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor,
        balance_due_minor, kind, status)
      VALUES ('plan_${id}', '${id}', 10000, 2000, 8000, 'manual', 'pending');
    `);
    const balance = getPendingManualBalanceDue(id);
    expect(balance).toBeNull();
  });
});
