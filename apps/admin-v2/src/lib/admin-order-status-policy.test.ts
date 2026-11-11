import { describe, expect, it } from "vitest";
import { getAdminOrderStatusOptions } from "./admin-order-status-policy";
import { orderSkipReason } from "../components/admin/order-list/order-bulk-actions";
import { orderNextStep } from "../components/admin/order-list/order-row-facts";
import { statusBlockText } from "../components/admin/orderview/OrderStatusCard";
import { canMarkDelivered, resolveOrderPrimaryAction } from "../components/admin/orderview/primary-action";
import type { Order } from "../components/admin/orderview/types";
import { orderDetailMessages } from "../i18n/order-detail";

describe("admin order status menu", () => {
  it("keeps cancellation available while blocking confirmation of an unverified manual deposit", () => {
    expect(getAdminOrderStatusOptions("pending", {
      paymentMethod: "cod",
      paymentStatus: "unpaid",
      paidAmount: 0,
      hasUnverifiedManualDeposit: true,
    })).toEqual([
      { status: "confirmed", block: { code: "deposit_not_verified" } },
      { status: "cancelled", block: null },
    ]);
  });

  it("permits confirmation of a COD order when the API reports no unverified manual deposit", () => {
    expect(getAdminOrderStatusOptions("pending", {
      paymentMethod: "cod",
      hasUnverifiedManualDeposit: false,
    })).toContainEqual({ status: "confirmed", block: null });
  });

  it("explains why a manual deposit blocks the detail status change", () => {
    expect(statusBlockText(
      { code: "deposit_not_verified" },
      { items: [] },
      (key) => orderDetailMessages.en[key],
    )).toBe("The deposit must be recorded before this order can move on.");
  });

  it("does not offer the detail page's primary Confirm action for an unverified manual deposit", () => {
    const order = {
      status: "pending",
      paymentMethod: "cod",
      hasUnverifiedManualDeposit: true,
      items: [],
    } as unknown as Order;
    const permissions = {
      canChangeOrderStatus: true,
      canManageOrderShipments: true,
      canUpdateOrderCod: true,
    };
    expect(resolveOrderPrimaryAction(order, permissions)).toBeNull();
    expect(resolveOrderPrimaryAction({ ...order, hasUnverifiedManualDeposit: false }, permissions)).toBe("confirm");
  });

  it.each([
    { action: "confirm", status: "pending" },
    { action: "send", status: "confirmed" },
    { action: "ship", status: "confirmed" },
  ] as const)("omits an unverified deposit from bulk $action", ({ action, status }) => {
    expect(orderSkipReason({ status, hasUnverifiedManualDeposit: true }, action)).toEqual({
      kind: "block", reason: "manualDeposit",
    });
    expect(orderSkipReason({ status, hasUnverifiedManualDeposit: false }, action)).toBeNull();
  });

  it("offers cash collection in the shipped order row only after the manual deposit is verified", () => {
    const order = {
      status: "shipped",
      fulfillmentStatus: "complete",
      paymentMethod: "cod",
      paymentStatus: "partial",
      totalAmount: 350,
      paidAmount: 100,
      archivedAt: null,
      onHold: false,
    };
    expect(orderNextStep({ ...order, hasUnverifiedManualDeposit: true })).toBeNull();
    expect(orderNextStep({ ...order, hasUnverifiedManualDeposit: false })).toBe("collect");
  });

  it("allows a fully sent COD order to be marked delivered only after the manual deposit is verified", () => {
    const order = {
      status: "shipped",
      paymentMethod: "cod",
      paymentStatus: "partial",
      balanceDue: 250,
      archivedAt: null,
      items: [{
        id: "line_1",
        productId: "product_1",
        variantId: null,
        quantity: 2,
        fulfilledQuantity: 2,
        fulfillmentType: "ship" as const,
        price: 175,
        productName: "Product",
        productImage: null,
        variantLabel: null,
      }],
    };
    expect(canMarkDelivered({ ...order, hasUnverifiedManualDeposit: true })).toBe(false);
    expect(canMarkDelivered({ ...order, hasUnverifiedManualDeposit: false })).toBe(true);
  });
});
