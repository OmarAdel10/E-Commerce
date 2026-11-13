import { describe, expect, it, vi } from "vitest";
import { createCourierProviders, getDeliveryProviderReadinessSummary } from "@scalius/core/modules/delivery";
import { createGiftCardCheckoutFixture, DELIVERY, line } from "@scalius/core/testing/gift-card-checkout";
import { getShipment } from "@scalius/core/modules/delivery";
import { checkAndSyncShipmentStatus } from "./shipment-status-sync";

/**
 * The admin refresh route asks the courier for the parcel's status and lets
 * the order follow it. A manual COD deposit that is pending or was refunded
 * is a permanent business rule: the courier's status stays saved, the order
 * does not move, and staff get a timeline line to reconcile by hand.
 */
describe("admin shipment refresh with a blocked manual COD deposit", () => {
  it("keeps the courier status, leaves the order alone and records the mismatch", async () => {
    const fixture = createGiftCardCheckoutFixture();
    try {
      const { orderId } = await fixture.checkout({
        ...DELIVERY,
        shippingCountryCode: "BD",
        items: [line("p_mug", "v_mug", 1, 300)],
      }, { codDeposit: { amount: 100, instructions: "Transfer the deposit" } });
      const providerType = "scalius.test:courier";
      fixture.sqlite.prepare(`
        INSERT INTO delivery_providers (id, name, type, is_active, credentials, config)
        VALUES ('dp_test', 'Courier', ?, 1, '{}', '{}')
      `).run(providerType);
      fixture.sqlite.prepare(`
        INSERT INTO delivery_shipments (id, order_id, provider_id, provider_type, external_id, status)
        VALUES ('parcel-1', ?, 'dp_test', ?, 'courier-parcel', 'in_transit')
      `).run(orderId, providerType);
      fixture.sqlite.prepare("UPDATE orders SET status='shipped' WHERE id=?").run(orderId);
      fixture.sqlite.prepare("UPDATE payment_plans SET status='cancelled' WHERE order_id=?").run(orderId);

      const couriers = createCourierProviders([{
        id: providerType,
        label: "Courier",
        countries: ["BD"],
        createShipment: vi.fn(),
        trackShipment: vi.fn().mockResolvedValue({
          status: "delivered",
          rawStatus: "delivered",
          updatedAt: "2026-04-01T10:00:00Z",
        }),
        async setup(provider) {
          return {
            settings: {},
            readiness: getDeliveryProviderReadinessSummary({
              type: provider.type, isActive: provider.isActive, activationBlockers: [],
            }),
          };
        },
      }]);
      const shipment = await getShipment(fixture.db, "parcel-1");
      expect(shipment).toBeTruthy();

      const result = await checkAndSyncShipmentStatus({
        db: fixture.db,
        shipment: shipment!,
        couriers,
        c: { env: {} as Env },
        source: "orders-shipment-refresh",
      });

      // The refusal is reported, not thrown: the route still answers.
      expect(result.payload.reconciliationRequired).toBe(true);
      expect(result.payload.reconciliationReason).toMatch(/deposit/i);
      expect(result.payload.status).toBe("delivered");
      // The order was not moved and no status change was announced.
      expect(result.orderStatusChange).toBeNull();
      expect(fixture.one("SELECT status FROM orders WHERE id=?", orderId).status).toBe("shipped");
      expect(fixture.all("SELECT id FROM order_fulfillments WHERE order_id=?", orderId)).toEqual([]);
      // Staff can see the mismatch on the order timeline.
      const events = fixture.all("SELECT kind, data FROM order_events WHERE order_id=? ORDER BY created_at", orderId);
      expect(events).toHaveLength(1);
      expect(events[0]!.kind).toBe("deposit_reconciliation_required");
      expect(JSON.parse(String(events[0]!.data))).toMatchObject({
        reason: "manual_cod_deposit_not_verified",
        shipmentId: "parcel-1",
        shipmentStatus: "delivered",
      });
    } finally {
      fixture.close();
    }
  });

  it("records the timeline line once for a repeated refresh of the same status", async () => {
    const fixture = createGiftCardCheckoutFixture();
    try {
      const { orderId } = await fixture.checkout({
        ...DELIVERY,
        shippingCountryCode: "BD",
        items: [line("p_mug", "v_mug", 1, 300)],
      }, { codDeposit: { amount: 100, instructions: "Transfer the deposit" } });
      const providerType = "scalius.test:courier";
      fixture.sqlite.prepare(`
        INSERT INTO delivery_providers (id, name, type, is_active, credentials, config)
        VALUES ('dp_test', 'Courier', ?, 1, '{}', '{}')
      `).run(providerType);
      fixture.sqlite.prepare(`
        INSERT INTO delivery_shipments (id, order_id, provider_id, provider_type, external_id, status)
        VALUES ('parcel-1', ?, 'dp_test', ?, 'courier-parcel', 'in_transit')
      `).run(orderId, providerType);
      fixture.sqlite.prepare("UPDATE orders SET status='shipped' WHERE id=?").run(orderId);
      fixture.sqlite.prepare("UPDATE payment_plans SET status='cancelled' WHERE order_id=?").run(orderId);

      const couriers = createCourierProviders([{
        id: providerType,
        label: "Courier",
        countries: ["BD"],
        createShipment: vi.fn(),
        trackShipment: vi.fn().mockResolvedValue({
          status: "delivered",
          rawStatus: "delivered",
          updatedAt: "2026-04-01T10:00:00Z",
        }),
        async setup(provider) {
          return {
            settings: {},
            readiness: getDeliveryProviderReadinessSummary({
              type: provider.type, isActive: provider.isActive, activationBlockers: [],
            }),
          };
        },
      }]);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const shipment = await getShipment(fixture.db, "parcel-1");
        await checkAndSyncShipmentStatus({
          db: fixture.db,
          shipment: shipment!,
          couriers,
          c: { env: {} as Env },
          source: "orders-shipment-refresh",
        });
      }

      expect(fixture.all("SELECT id FROM order_events WHERE order_id=? AND kind='deposit_reconciliation_required'", orderId))
        .toHaveLength(1);
    } finally {
      fixture.close();
    }
  });
});
