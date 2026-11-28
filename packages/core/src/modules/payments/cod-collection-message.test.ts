import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1Database, type SqliteTestDatabase } from "@scalius/database/testing/sqlite-d1";
import { recordCODCollection } from "./cod";

describe("recordCODCollection — manual vs online deposit validation message", () => {
  let fixture: SqliteTestDatabase;
  beforeEach(() => {
    fixture = createSqliteD1Database();
  });
  afterEach(() => fixture.sqlite.close());

  const now = 1780000000;

  function insertOrder(id: string, paidAmountMinor = 0, balanceDueMinor = 10000): void {
    fixture.sqlite.exec(`
      INSERT INTO orders (id, customer_name, customer_phone, shipping_address, city, zone,
        status, payment_method, payment_status, total_amount_minor, paid_amount_minor,
        balance_due_minor, currency_code, currency_decimal_places, version)
      VALUES ('${id}', 'Test Customer', '+880****1111', 'House 1, Road 1', 'Dhaka', 'North',
        'pending', 'cod', 'unpaid', 10000, ${paidAmountMinor}, ${balanceDueMinor}, 'BDT', 2, 1);
    `);
  }

  function insertManualPlan(orderId: string, status: string = "pending"): void {
    fixture.sqlite.exec(`
      INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor,
        balance_due_minor, kind, status, instructions, contact_snapshot, created_at, updated_at)
      VALUES ('plan_${orderId}', '${orderId}', 10000, 2000, 8000, 'manual', '${status}',
        'Transfer to merchant account 123', '{}', ${now}, ${now});
    `);
  }

  function insertOnlinePlan(orderId: string, status: string = "pending"): void {
    fixture.sqlite.exec(`
      INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor,
        balance_due_minor, kind, status, created_at, updated_at)
      VALUES ('plan_${orderId}', '${orderId}', 10000, 2000, 8000, 'online', '${status}',
        ${now}, ${now});
    `);
  }

  function insertCODTracking(orderId: string, status: string = "pending"): void {
    fixture.sqlite.exec(`
      INSERT INTO cod_tracking (id, order_id, delivery_attempts, cod_status, created_at, updated_at)
      VALUES ('ct_${orderId}', '${orderId}', 0, '${status}', ${now}, ${now});
    `);
  }

  it("throws manual deposit message for manual-kind pending plan", async () => {
    // Deposit (2000) already recorded as paid, remaining balance (8000) to collect
    insertOrder("order_manual", 2000, 8000);
    insertManualPlan("order_manual");
    insertCODTracking("order_manual");

    await expect(recordCODCollection(fixture.db, {
      orderId: "order_manual",
      collectedBy: "staff",
      collectedAmountMinor: 8000,
    })).rejects.toThrow("The manual deposit must be verified before collecting the cash balance on delivery.");
  });

  it("throws online deposit message for online-kind pending plan", async () => {
    insertOrder("order_online", 2000, 8000);
    insertOnlinePlan("order_online");
    insertCODTracking("order_online");

    await expect(recordCODCollection(fixture.db, {
      orderId: "order_online",
      collectedBy: "staff",
      collectedAmountMinor: 8000,
    })).rejects.toThrow("The online deposit must be paid before collecting the cash balance on delivery.");
  });

  it("allows collection when manual plan is deposit_paid", async () => {
    insertOrder("order_paid", 2000, 8000);
    insertManualPlan("order_paid", "deposit_paid");
    insertCODTracking("order_paid");

    const result = await recordCODCollection(fixture.db, {
      orderId: "order_paid",
      collectedBy: "staff",
      collectedAmountMinor: 8000,
    });
    expect(result.success).toBe(true);
  });

  it("allows collection when online plan is deposit_paid", async () => {
    insertOrder("order_online_paid", 2000, 8000);
    insertOnlinePlan("order_online_paid", "deposit_paid");
    insertCODTracking("order_online_paid");

    const result = await recordCODCollection(fixture.db, {
      orderId: "order_online_paid",
      collectedBy: "staff",
      collectedAmountMinor: 8000,
    });
    expect(result.success).toBe(true);
  });

  it("allows collection when no payment plan exists (full COD order)", async () => {
    insertOrder("order_noplan", 0, 10000);
    insertCODTracking("order_noplan");

    const result = await recordCODCollection(fixture.db, {
      orderId: "order_noplan",
      collectedBy: "staff",
      collectedAmountMinor: 10000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects collection when manual plan is cancelled", async () => {
    insertOrder("order_cancelled", 2000, 8000);
    insertManualPlan("order_cancelled", "cancelled");
    insertCODTracking("order_cancelled");

    await expect(recordCODCollection(fixture.db, {
      orderId: "order_cancelled",
      collectedBy: "staff",
      collectedAmountMinor: 8000,
    })).rejects.toThrow("The deposit plan for this order was cancelled, so the cash balance cannot be collected.");
  });

  it("rejects collection when online plan is cancelled", async () => {
    insertOrder("order_online_cancelled", 2000, 8000);
    insertOnlinePlan("order_online_cancelled", "cancelled");
    insertCODTracking("order_online_cancelled");

    await expect(recordCODCollection(fixture.db, {
      orderId: "order_online_cancelled",
      collectedBy: "staff",
      collectedAmountMinor: 8000,
    })).rejects.toThrow("The deposit plan for this order was cancelled, so the cash balance cannot be collected.");
  });
});
