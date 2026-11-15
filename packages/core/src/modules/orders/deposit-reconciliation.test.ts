import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1Database } from "@scalius/database/testing/sqlite-d1";
import { ManualCodDepositBlockedError } from "@scalius/core/modules/payments";
import { recordManualCodDepositReconciliationRequired } from "./deposit-reconciliation";

describe("recordManualCodDepositReconciliationRequired", () => {
  let fixture: ReturnType<typeof createSqliteD1Database>;
  beforeEach(() => {
    fixture = createSqliteD1Database();
    fixture.sqlite.exec(`
      INSERT INTO orders (id, customer_name, customer_phone, shipping_address, city, zone,
        status, payment_method, payment_status, total_amount_minor, paid_amount_minor,
        balance_due_minor, currency_code, currency_decimal_places, version)
      VALUES ('order_1', 'Buyer', '01711111111', 'Road 1', 'Dhaka', 'North',
        'pending', 'cod', 'unpaid', 10000, 0, 10000, 'BDT', 2, 1);
    `);
  });
  afterEach(() => fixture.sqlite.close());

  const input = (overrides: { shipmentId?: string; shipmentStatus?: string } = {}) => ({
    orderId: "order_1",
    shipmentId: overrides.shipmentId ?? "shipment_1",
    shipmentStatus: overrides.shipmentStatus ?? "in_transit",
    error: new ManualCodDepositBlockedError("The deposit must be recorded before this order can move on."),
  });

  it("records a deposit_reconciliation_required timeline line with the reason and shipment facts", async () => {
    await recordManualCodDepositReconciliationRequired(fixture.db, input());
    const row = fixture.sqlite.prepare(
      "SELECT kind, body, data FROM order_events WHERE order_id = ?",
    ).get("order_1") as { kind: string; body: string | null; data: string | null };
    expect(row.kind).toBe("deposit_reconciliation_required");
    expect(row.body).toBe("The deposit must be recorded before this order can move on.");
    const data = JSON.parse(row.data ?? "{}");
    expect(data.reason).toBe("manual_cod_deposit_not_verified");
    expect(data.shipmentId).toBe("shipment_1");
    expect(data.shipmentStatus).toBe("in_transit");
  });

  it("is idempotent: the same shipment and status records the line once", async () => {
    await recordManualCodDepositReconciliationRequired(fixture.db, input());
    await recordManualCodDepositReconciliationRequired(fixture.db, input());
    const count = fixture.sqlite.prepare(
      "SELECT count(*) AS n FROM order_events WHERE order_id = ? AND kind = 'deposit_reconciliation_required'",
    ).get("order_1") as { n: number };
    expect(count.n).toBe(1);
  });

  it("records separate lines for different shipments and statuses", async () => {
    await recordManualCodDepositReconciliationRequired(fixture.db, input({ shipmentId: "ship_a", shipmentStatus: "in_transit" }));
    await recordManualCodDepositReconciliationRequired(fixture.db, input({ shipmentId: "ship_a", shipmentStatus: "delivered" }));
    const count = fixture.sqlite.prepare(
      "SELECT count(*) AS n FROM order_events WHERE order_id = ? AND kind = 'deposit_reconciliation_required'",
    ).get("order_1") as { n: number };
    expect(count.n).toBe(2);
  });
});
