import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1Database } from "@scalius/database/testing/sqlite-d1";
import { OrderStatus } from "@scalius/database/schema";
import { applyInventoryForStatusChangeWithImpact } from "../../inventory";
import { reconcileInventoryForStatus, reconcileRefundedOrderInventory } from "../status/lifecycle";

describe("reconcileInventoryForStatus — restores inventoryAction to 'restored' (real DB)", () => {
  let fixture: ReturnType<typeof createSqliteD1Database>;
  beforeEach(() => {
    fixture = createSqliteD1Database();
  });
  afterEach(() => fixture.sqlite.close());

  const insertCancelledRefundedOrder = (overrides: Partial<{
    id: string;
    inventoryAction: "reserved" | "deducted" | "restored";
    lastInventoryFailureAt: number | null;
  }> = {}) => {
    const id = overrides.id ?? "order_inventory_recovery";
    fixture.sqlite.exec(`
      INSERT INTO orders (id, customer_name, customer_phone, shipping_address, city, zone,
        status, payment_method, payment_status, total_amount_minor, paid_amount_minor,
        balance_due_minor, currency_code, currency_decimal_places, version,
        inventory_action, last_inventory_failure_at)
      VALUES ('${id}', 'Buyer', '01711111111', 'Road 1', 'Dhaka', 'North',
        'cancelled', 'cod', 'refunded', 10000, 0, 10000, 'BDT', 2, 1,
        '${overrides.inventoryAction ?? "deducted"}', ${overrides.lastInventoryFailureAt ?? null});
    `);
    return id;
  };

  const getInventoryAction = (id: string): string | null =>
    (fixture.sqlite.prepare(`SELECT inventory_action FROM orders WHERE id = ?`).get(id) as { inventory_action: string | null })?.inventory_action ?? null;

  const getLastInventoryFailureAt = (id: string): number | null =>
    (fixture.sqlite.prepare(`SELECT last_inventory_failure_at FROM orders WHERE id = ?`).get(id) as { last_inventory_failure_at: number | null })?.last_inventory_failure_at ?? null;

  it("restores inventoryAction to 'restored' for a cancelled refunded order with 'deducted' action", async () => {
    const id = insertCancelledRefundedOrder({ inventoryAction: "deducted" });
    expect(getInventoryAction(id)).toBe("deducted");

    await reconcileInventoryForStatus(fixture.db, id, OrderStatus.CANCELLED);

    expect(getInventoryAction(id)).toBe("restored");
  });

  it("restores inventoryAction to 'restored' for a cancelled refunded order with 'reserved' action", async () => {
    const id = insertCancelledRefundedOrder({ inventoryAction: "reserved" });
    expect(getInventoryAction(id)).toBe("reserved");

    await reconcileInventoryForStatus(fixture.db, id, OrderStatus.CANCELLED);

    expect(getInventoryAction(id)).toBe("restored");
  });

  it("is idempotent: restoring an already-restored order leaves inventoryAction unchanged", async () => {
    const id = insertCancelledRefundedOrder({ inventoryAction: "restored" });
    const before = getInventoryAction(id);

    await reconcileInventoryForStatus(fixture.db, id, OrderStatus.CANCELLED);

    expect(getInventoryAction(id)).toBe(before);
  });

  it("clears lastInventoryFailureAt after successful reconciliation via the drain", async () => {
    const id = insertCancelledRefundedOrder({
      inventoryAction: "deducted",
      lastInventoryFailureAt: Math.floor(Date.now() / 1000) - 70 * 60, // 70 min ago, past cooldown
    });
    expect(getLastInventoryFailureAt(id)).not.toBeNull();

    const result = await reconcileRefundedOrderInventory(fixture.db, { limit: 25 });

    expect(result.reconciled).toBe(1);
    expect(getInventoryAction(id)).toBe("restored");
    expect(getLastInventoryFailureAt(id)).toBeNull();
  });
});

describe("reconcileRefundedOrderInventory — drain restores inventoryAction and stops re-selecting (real DB)", () => {
  let fixture: ReturnType<typeof createSqliteD1Database>;
  beforeEach(() => {
    fixture = createSqliteD1Database();
  });
  afterEach(() => fixture.sqlite.close());

  const insertOrders = () => {
    fixture.sqlite.exec(`
      INSERT INTO orders (id, customer_name, customer_phone, shipping_address, city, zone,
        status, payment_method, payment_status, total_amount_minor, paid_amount_minor,
        balance_due_minor, currency_code, currency_decimal_places, version,
        inventory_action, last_inventory_failure_at)
      VALUES
        ('order_needs_recovery', 'Buyer', '01711111111', 'Road 1', 'Dhaka', 'North',
          'cancelled', 'cod', 'refunded', 10000, 0, 10000, 'BDT', 2, 1,
          'deducted', NULL),
        ('order_already_restored', 'Buyer', '01711111111', 'Road 1', 'Dhaka', 'North',
          'cancelled', 'cod', 'refunded', 10000, 0, 10000, 'BDT', 2, 1,
          'restored', NULL),
        ('order_not_refunded', 'Buyer', '01711111111', 'Road 1', 'Dhaka', 'North',
          'cancelled', 'cod', 'unpaid', 10000, 0, 10000, 'BDT', 2, 1,
          'deducted', NULL),
        ('order_not_cancelled', 'Buyer', '01711111111', 'Road 1', 'Dhaka', 'North',
          'confirmed', 'cod', 'refunded', 10000, 0, 10000, 'BDT', 2, 1,
          'deducted', NULL),
        ('order_in_cooldown', 'Buyer', '01711111111', 'Road 1', 'Dhaka', 'North',
          'cancelled', 'cod', 'refunded', 10000, 0, 10000, 'BDT', 2, 1,
          'deducted', unixepoch());
    `);
  };

  const getInventoryAction = (id: string): string | null =>
    (fixture.sqlite.prepare(`SELECT inventory_action FROM orders WHERE id = ?`).get(id) as { inventory_action: string | null })?.inventory_action ?? null;

  const getLastInventoryFailureAt = (id: string): number | null =>
    (fixture.sqlite.prepare(`SELECT last_inventory_failure_at FROM orders WHERE id = ?`).get(id) as { last_inventory_failure_at: number | null })?.last_inventory_failure_at ?? null;

  it("restores inventoryAction for eligible orders and leaves ineligible ones untouched", async () => {
    insertOrders();

    const result = await reconcileRefundedOrderInventory(fixture.db, { limit: 25 });

    expect(result.scanned).toBe(1);
    expect(result.reconciled).toBe(1);
    expect(result.failed).toBe(0);

    expect(getInventoryAction("order_needs_recovery")).toBe("restored");
    expect(getInventoryAction("order_already_restored")).toBe("restored");
    expect(getInventoryAction("order_not_refunded")).toBe("deducted");
    expect(getInventoryAction("order_not_cancelled")).toBe("deducted");
    expect(getInventoryAction("order_in_cooldown")).toBe("deducted");
    expect(getLastInventoryFailureAt("order_needs_recovery")).toBeNull();
  });

  it("does not re-select an order after its inventoryAction has been restored", async () => {
    insertOrders();

    // First run restores order_needs_recovery
    const result1 = await reconcileRefundedOrderInventory(fixture.db, { limit: 25 });
    expect(result1.reconciled).toBe(1);
    expect(getInventoryAction("order_needs_recovery")).toBe("restored");

    // Second run should not re-select it
    const result2 = await reconcileRefundedOrderInventory(fixture.db, { limit: 25 });
    expect(result2.scanned).toBe(0);
    expect(result2.reconciled).toBe(0);
    expect(result2.failed).toBe(0);
    expect(getInventoryAction("order_needs_recovery")).toBe("restored");
  });
});

describe("applyInventoryForStatusChangeWithImpact — writes inventoryAction='restored' (real DB)", () => {
  let fixture: ReturnType<typeof createSqliteD1Database>;
  beforeEach(() => {
    fixture = createSqliteD1Database();
  });
  afterEach(() => fixture.sqlite.close());

  const insertCancelledOrder = (inventoryAction: "reserved" | "deducted"): string => {
    const id = `order_${inventoryAction}_direct`;
    fixture.sqlite.exec(`
      INSERT INTO orders (id, customer_name, customer_phone, shipping_address, city, zone,
        status, payment_method, payment_status, total_amount_minor, paid_amount_minor,
        balance_due_minor, currency_code, currency_decimal_places, version,
        inventory_action)
      VALUES ('${id}', 'Buyer', '01711111111', 'Road 1', 'Dhaka', 'North',
        'cancelled', 'cod', 'refunded', 10000, 0, 10000, 'BDT', 2, 1,
        '${inventoryAction}');
    `);
    return id;
  };

  const getInventoryAction = (id: string): string | null =>
    (fixture.sqlite.prepare(`SELECT inventory_action FROM orders WHERE id = ?`).get(id) as { inventory_action: string | null })?.inventory_action ?? null;

  it("sets inventoryAction to 'restored' for a cancelled order with 'deducted' action", async () => {
    const id = insertCancelledOrder("deducted");
    expect(getInventoryAction(id)).toBe("deducted");

    const impact = await applyInventoryForStatusChangeWithImpact(fixture.db, id, OrderStatus.CANCELLED);

    expect(impact.inventoryAction).toBe("restored");
    expect(getInventoryAction(id)).toBe("restored");
  });

  it("sets inventoryAction to 'restored' for a cancelled order with 'reserved' action", async () => {
    const id = insertCancelledOrder("reserved");
    expect(getInventoryAction(id)).toBe("reserved");

    const impact = await applyInventoryForStatusChangeWithImpact(fixture.db, id, OrderStatus.CANCELLED);

    expect(impact.inventoryAction).toBe("restored");
    expect(getInventoryAction(id)).toBe("restored");
  });
});
