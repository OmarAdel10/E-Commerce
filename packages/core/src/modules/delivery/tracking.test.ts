import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1Database, type SqliteTestDatabase } from "@scalius/database/testing/sqlite-d1";
import { updateOrderStatusFromShipment } from "./tracking";

function seedOrder(f: SqliteTestDatabase, overrides: {
    status?: string;
    paymentMethod?: string;
    planKind?: string | null;
    planStatus?: string | null;
    orderId?: string;
    shipmentStatus?: string;
} = {}) {
    const orderId = overrides.orderId ?? "o1";
    const status = overrides.status ?? "confirmed";
    const paymentMethod = overrides.paymentMethod ?? "cod";
    const shipmentStatus = overrides.shipmentStatus ?? "delivered";

    f.sqlite.exec(`
      INSERT INTO orders (id, customer_name, customer_phone, shipping_address, city, zone, status, payment_method, payment_status, total_amount_minor, paid_amount_minor, balance_due_minor, currency_code, currency_decimal_places, version)
      VALUES ('${orderId}', 'Buyer', '01711111111', 'Road', 'Dhaka', 'North', '${status}', '${paymentMethod}', 'partial', 10000, 3000, 7000, 'BDT', 2, 1);
      INSERT INTO delivery_shipments (id, order_id, status) VALUES ('s1', '${orderId}', '${shipmentStatus}');
    `);

    if (overrides.planKind !== null) {
        const planKind = overrides.planKind ?? "manual";
        const planStatus = overrides.planStatus ?? "pending";
        f.sqlite.prepare(`INSERT INTO payment_plans (id, order_id, total_amount_minor, deposit_amount_minor, balance_due_minor, kind, status) VALUES ('p1', '${orderId}', 10000, 2000, 8000, '${planKind}', '${planStatus}')`).run();
    }
}

describe("tracking — manual COD deposit guard on all fulfilment-eligible statuses", () => {
  let f: SqliteTestDatabase;

  beforeEach(() => {
    f = createSqliteD1Database();
  });

  afterEach(() => f.sqlite.close());

  it("blocks COD order with pending deposit from transitioning to confirmed via failed delivery", async () => {
    seedOrder(f, { status: "shipped", paymentMethod: "cod", shipmentStatus: "failed" });
    await expect(updateOrderStatusFromShipment(f.db, "s1", "failed")).rejects.toThrow(/deposit/);
  });

  it("blocks COD order with pending deposit from transitioning to shipped", async () => {
    seedOrder(f, { status: "confirmed", paymentMethod: "cod", shipmentStatus: "picked_up" });
    await expect(updateOrderStatusFromShipment(f.db, "s1", "picked_up")).rejects.toThrow(/deposit/);
  });

  it("blocks COD order with pending deposit from transitioning to delivered", async () => {
    seedOrder(f, { status: "confirmed", paymentMethod: "cod", shipmentStatus: "delivered" });
    await expect(updateOrderStatusFromShipment(f.db, "s1", "delivered")).rejects.toThrow(/deposit/);
  });

  it("allows COD order with deposit_paid plan to transition to delivered", async () => {
    seedOrder(f, { status: "confirmed", paymentMethod: "cod", shipmentStatus: "delivered", planStatus: "deposit_paid" });
    const result = await updateOrderStatusFromShipment(f.db, "s1", "delivered");
    expect(result).toBeDefined();
    expect(result!.statusChange!.newStatus).toBe("delivered");
  });

  it("does not block non-COD order (no manual plan) from transitioning to delivered", async () => {
    seedOrder(f, { status: "confirmed", paymentMethod: "stripe", shipmentStatus: "delivered", planKind: null });
    const result = await updateOrderStatusFromShipment(f.db, "s1", "delivered");
    expect(result).toBeDefined();
  });
});
