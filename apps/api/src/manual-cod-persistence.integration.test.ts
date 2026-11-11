import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGiftCardCheckoutFixture, DELIVERY, line, type GiftCardCheckoutFixture } from "../../../packages/core/src/testing/gift-card-checkout";
import { recordOrderFulfilment } from "../../../packages/core/src/modules/fulfilment/ledger";
import { bulkFulfillOrders, bulkShipOrders } from "../../../packages/core/src/modules/fulfilment/bulk";
import { reconcileOrderShipment } from "../../../packages/core/src/modules/fulfilment/reconcile";
import { processCodAction } from "../../../packages/core/src/modules/fulfilment/delivery-outcomes";
import { createCourierProviders, getDeliveryProviderReadinessSummary } from "@scalius/core/modules/delivery";
import { processRefund, recordOrderPayment } from "@scalius/core/modules/payments";
import { BACKGROUND_DRAINS } from "./scheduled-maintenance";
import { readDueDrains } from "./scheduled/due-work";

describe("manual COD checkout persistence and scheduled inventory recovery", () => {
  let fixture: GiftCardCheckoutFixture;
  beforeEach(() => { fixture = createGiftCardCheckoutFixture(); });
  afterEach(() => fixture.close());
  const input = () => ({ ...DELIVERY, shippingCountryCode: "BD", items: [line("p_mug", "v_mug", 1, 300)] });
  const options = () => ({ codDeposit: { amount: 100, instructions: "Transfer to merchant account 123" } });

  it("persists the prepared manual plan and snapshots in the actual checkout batch", async () => {
    const prepared = await fixture.prepare(input(), options());
    await fixture.commit(prepared);
    const plan = fixture.one("SELECT * FROM payment_plans WHERE order_id = ?", prepared.result.orderId);
    expect(plan.kind).toBe("manual");
    expect(plan.status).toBe("pending");
    expect(plan.deposit_amount_minor).toBe(10000);
    expect(plan.instructions).toBe("Transfer to merchant account 123");
    expect(JSON.parse(String(plan.contact_snapshot))).toHaveProperty("socialLinks");
    expect(Number(plan.total_amount_minor)).toBe(Number(plan.deposit_amount_minor) + Number(plan.balance_due_minor));
  });

  it("a failed commit leaves no plan or order behind", async () => {
    const prepared = await fixture.prepare(input(), options());
    fixture.failNextBatch(() => true);
    await expect(fixture.commit(prepared)).rejects.toThrow("Injected batch failure");
    expect(fixture.all("SELECT id FROM payment_plans WHERE order_id = ?", prepared.result.orderId)).toHaveLength(0);
    expect(fixture.all("SELECT id FROM orders WHERE id = ?", prepared.result.orderId)).toHaveLength(0);
  });

  it.each(["pending", "cancelled"])("single and bulk fulfillment reject a %s plan without inventory writes", async (status) => {
    const prepared = await fixture.prepare(input(), options());
    await fixture.commit(prepared);
    const orderId = prepared.result.orderId;
    fixture.sqlite.prepare("UPDATE orders SET status = 'confirmed' WHERE id = ?").run(orderId);
    fixture.sqlite.prepare("UPDATE payment_plans SET status = ? WHERE order_id = ?").run(status, orderId);
    const before = fixture.one("SELECT stock, reserved_stock FROM product_variants WHERE id = 'v_mug'");
    await expect(recordOrderFulfilment(fixture.db, orderId, { requestKey: "manual-send-test", kind: "ship" }, { type: "admin", id: null })).rejects.toThrow(/deposit/i);
    const bulk = await bulkFulfillOrders(fixture.db, [orderId], { requestKey: "bulk-send-test" });
    expect(bulk.length).toBeGreaterThan(0);
    expect(bulk[0]!.success).toBe(false);
    expect(bulk[0]!.error).toMatch(/deposit/i);
    expect(fixture.one("SELECT stock, reserved_stock FROM product_variants WHERE id = 'v_mug'")).toEqual(before);
    expect(fixture.one("SELECT status FROM orders WHERE id = ?", orderId).status).toBe("confirmed");
  });

  it.each(["pending", "cancelled"])("blocks courier booking and COD collection for a %s plan", async (status) => {
    const { orderId } = await fixture.checkout(input(), options());
    const providerType = "scalius.test:courier";
    fixture.sqlite.prepare(`
      INSERT INTO delivery_providers (id, name, type, is_active, credentials, config)
      VALUES ('dp_test', 'Courier', ?, 1, '{}', '{}')
    `).run(providerType);
    const createShipment = vi.fn();
    const couriers = createCourierProviders([{
      id: providerType, label: "Courier", countries: ["BD"], createShipment, trackShipment: vi.fn(),
      async setup(provider) {
        return {
          settings: {},
          readiness: getDeliveryProviderReadinessSummary({ type: provider.type, isActive: provider.isActive, activationBlockers: [] }),
        };
      },
    }]);
    fixture.sqlite.prepare("UPDATE payment_plans SET status=? WHERE order_id=?").run(status, orderId);
    fixture.sqlite.prepare("UPDATE orders SET status='confirmed' WHERE id=?").run(orderId);
    const result = await bulkShipOrders(fixture.db, [orderId], "dp_test", undefined, undefined, couriers);
    expect(result[0]).toMatchObject({ success: false, error: expect.stringMatching(/deposit/i) });
    expect(createShipment).not.toHaveBeenCalled();
    expect(fixture.all("SELECT id FROM delivery_shipments WHERE order_id=?", orderId)).toEqual([]);

    fixture.sqlite.prepare("UPDATE orders SET status='shipped' WHERE id=?").run(orderId);
    const before = fixture.one<{ balance_due_minor: number }>("SELECT balance_due_minor FROM orders WHERE id=?", orderId);
    await expect(processCodAction(fixture.db, orderId, {
      action: "collected", collectedAmount: before.balance_due_minor / 100, collectedBy: "Courier",
    })).rejects.toThrow(/deposit/i);
    expect(fixture.all("SELECT id FROM order_payments WHERE order_id=?", orderId)).toEqual([]);
    expect(fixture.one("SELECT status FROM orders WHERE id=?", orderId).status).toBe("shipped");
  });

  it("blocks recovery handover when the deposit was refunded after the shipped status write", async () => {
    const prepared = await fixture.prepare(input(), options());
    await fixture.commit(prepared);
    const orderId = prepared.result.orderId;
    fixture.sqlite.prepare("UPDATE orders SET status='shipped' WHERE id=?").run(orderId);
    fixture.sqlite.prepare("UPDATE payment_plans SET status='cancelled' WHERE order_id=?").run(orderId);
    fixture.sqlite.prepare(`
      INSERT INTO delivery_shipments (id, order_id, status, metadata)
      VALUES ('repair-parcel', ?, 'reconcile_required', ?)
    `).run(orderId, JSON.stringify({ orderStatusSync: { shipmentStatus: "in_transit", orderStatus: "shipped" } }));

    await expect(reconcileOrderShipment(fixture.db, orderId, "repair-parcel")).rejects.toThrow(/deposit was refunded/);
    expect(fixture.all("SELECT id FROM order_fulfillments WHERE order_id=?", orderId)).toEqual([]);
    expect(fixture.one("SELECT status FROM delivery_shipments WHERE id='repair-parcel'").status).toBe("reconcile_required");
  });

  it("recovers reserved inventory after a committed refund and retries safely", async () => {
    const prepared = await fixture.prepare(input(), options());
    await fixture.commit(prepared);
    const orderId = prepared.result.orderId;
    const secret = "refund-inventory-integration-test-secret";
    await recordOrderPayment(fixture.db, {
      orderId, amountMinor: 10000, via: "bank_transfer", requestKey: "record-deposit",
      recordedBy: "staff", paymentType: "deposit",
    });
    const before = fixture.one("SELECT stock, reserved_stock FROM product_variants WHERE id = 'v_mug'");
    expect(Number(before.reserved_stock)).toBeGreaterThan(0);
    fixture.sqlite.exec(`
      CREATE TRIGGER fail_inventory_recovery BEFORE UPDATE OF inventory_action ON orders
      WHEN NEW.inventory_action='restored'
      BEGIN SELECT RAISE(ABORT, 'test inventory write failure'); END;
    `);
    const request = {
      orderId, amountMinor: 10000, caller: "staff" as const, reason: "return",
      manualSettlementConfirmed: true, requestKey: "refund-deposit",
    };
    await expect(processRefund(fixture.db, request, secret)).resolves.toMatchObject({ success: true, isFullRefund: true });
    expect(fixture.one("SELECT status FROM payment_plans WHERE order_id = ?", orderId).status).toBe("cancelled");
    expect(fixture.one("SELECT status FROM refund_attempts WHERE order_id = ?", orderId).status).toBe("refunded");
    expect(fixture.one("SELECT status, payment_status, inventory_action FROM orders WHERE id = ?", orderId)).toEqual({
      status: "cancelled", payment_status: "refunded", inventory_action: "reserved",
    });

    const drain = BACKGROUND_DRAINS.find((entry) => entry.name === "refund_inventory_recovery_drain")!;
    const context = { db: fixture.db, timed: async (_name: string, run: () => Promise<unknown>) => run() } as Parameters<typeof drain.run>[0];
    await expect(readDueDrains(fixture.db, [drain])).resolves.toEqual(new Set([drain.name]));
    await expect(drain.run(context)).resolves.toMatchObject({ failed: 1, reconciled: 0 });
    await expect(readDueDrains(fixture.db, [drain])).resolves.toEqual(new Set());
    fixture.sqlite.exec("DROP TRIGGER fail_inventory_recovery; UPDATE orders SET last_inventory_failure_at=unixepoch()-3601");
    await expect(readDueDrains(fixture.db, [drain])).resolves.toEqual(new Set([drain.name]));
    await Promise.all([drain.run(context), drain.run(context)]);
    await expect(readDueDrains(fixture.db, [drain])).resolves.toEqual(new Set());
    await expect(processRefund(fixture.db, request, secret)).resolves.toMatchObject({ success: true, isFullRefund: true });
    expect(fixture.one("SELECT stock, reserved_stock FROM product_variants WHERE id = 'v_mug'")).toEqual({ stock: before.stock, reserved_stock: 0 });
    expect(fixture.one("SELECT inventory_action FROM orders WHERE id = ?", orderId).inventory_action).toBe("restored");
    expect(fixture.all("SELECT amount_minor FROM order_payments WHERE status='refunded'")).toEqual([{ amount_minor: 10000 }]);
  });
});
