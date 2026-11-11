import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PermissionProvider } from "~/contexts/PermissionContext";
import { PaymentCard } from "./PaymentCard";
import type { Order } from "./types";

const pendingPlan = {
  kind: "manual",
  status: "pending",
  totalAmount: 350,
  depositAmount: 100,
  balanceDue: 250,
  balanceDueDate: null,
  depositPaidAt: null,
  balancePaidAt: null,
  createdAt: null,
  updatedAt: null,
};

function renderOrder(override: Partial<Order> = {}, canRecord = true) {
  const order: Order = {
    id: "order_1",
    version: 1,
    customerName: "Buyer",
    customerPhone: null,
    customerEmail: null,
    customerId: null,
    shippingAddress: "House 1",
    city: "Dhaka",
    zone: "North",
    area: null,
    notes: null,
    discountAmount: null,
    discounts: [],
    appRiskChecks: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    items: [],
    paymentMethod: "cod",
    paymentStatus: "unpaid",
    status: "pending",
    paymentPlan: pendingPlan,
    shippingCharge: 50,
    totalAmount: 350,
    paidAmount: 0,
    balanceDue: 350,
    orderNumber: 1,
    archivedAt: null,
    channel: "online_store",
    channelSource: null,
    refundDue: 0,
    refundedAmount: 0,
    editReadiness: {
      items: { allowed: true, reason: null },
      details: { allowed: true, reason: null },
    },
    ...override,
  };
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <PermissionProvider permissions={canRecord ? ["orders.record_payment"] : []}>
        <PaymentCard order={order} />
      </PermissionProvider>
    </QueryClientProvider>,
  );
}

describe("PaymentCard manual COD deposit", () => {
  it("renders the required deposit amount and a Record deposit action for staff with permission", () => {
    const markup = renderOrder();
    expect(markup).toContain("Deposit required before dispatch");
    expect(markup).toContain("100.00");
    expect(markup).toContain("Record deposit");
  });

  it("shows the pending requirement without an action to staff lacking permission", () => {
    const markup = renderOrder({}, false);
    expect(markup).toContain("Deposit required before dispatch");
    expect(markup).not.toContain("Record deposit");
  });

  it.each([
    { status: "cancelled" },
    { paymentPlan: { ...pendingPlan, kind: "online" } },
  ])("omits the manual deposit section for %o", (override) => {
    expect(renderOrder(override)).not.toContain("data-cod-deposit");
  });
});
