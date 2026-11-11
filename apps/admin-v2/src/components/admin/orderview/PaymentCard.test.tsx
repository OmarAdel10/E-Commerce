// @vitest-environment happy-dom

import { postApiV1AdminResourcesOrdersByIdPayments } from "@scalius/api-client/sdk";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PermissionProvider } from "~/contexts/PermissionContext";
import { orderPaymentsQueryOptions } from "~/lib/api-query-options/orders";
import { currencyQuery } from "~/lib/api-query-options/settings-screens";
import { PaymentCard } from "./PaymentCard";
import type { Order } from "./types";

vi.mock(import("@scalius/api-client/sdk"), async (importOriginal) => ({
  ...await importOriginal(),
  postApiV1AdminResourcesOrdersByIdPayments: vi.fn(),
}));

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

function paymentCard(client: QueryClient, override: Partial<Order> = {}, canRecord = true) {
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
  return (
    <QueryClientProvider client={client}>
      <PermissionProvider permissions={canRecord ? ["orders.record_payment"] : []}>
        <PaymentCard order={order} />
      </PermissionProvider>
    </QueryClientProvider>
  );
}

function renderOrder(override: Partial<Order> = {}, canRecord = true) {
  return renderToStaticMarkup(paymentCard(new QueryClient(), override, canRecord));
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

  it("rejects a mismatched amount and retries a lost response with the same deposit request", async () => {
    // Warm the real dialog module so assertions do not depend on the speed of
    // Vitest's on-demand transforms while the full suite is running.
    await import("./RecordPaymentDialog");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    // Deliver query notifications inside React's act instead of racing timers.
    notifyManager.setScheduler(queueMicrotask);
    const record = vi.mocked(postApiV1AdminResourcesOrdersByIdPayments);
    record.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          payment: {
            id: "payment_1",
            orderId: "order_1",
            status: "succeeded",
            method: "bank_transfer",
            type: "deposit",
            currency: "USD",
            amountMinor: 10_000,
            settlementCurrency: "USD",
            settlementAmountMinor: 10_000,
            providerRef: null,
            createdAt: "2026-01-01T01:00:00Z",
            updatedAt: "2026-01-01T01:00:00Z",
          },
        },
      },
      request: new Request("https://admin-api.invalid"),
      response: new Response(null, { status: 201 }),
    });
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: "static" } } });
    client.setQueryData(currencyQuery.queryKey, { currencyCode: "USD", currencySymbol: "$" });
    client.setQueryData(orderPaymentsQueryOptions("order_1").queryKey, {
      payments: [],
      plan: null,
      refundAttempts: [],
      activeRefundOperation: null,
      paymentWebhookIssues: [],
      paymentSessionAttempts: [],
      refundSources: [],
    });
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);

    try {
      await act(async () => root.render(paymentCard(client, { currencyCode: "USD", currencyDecimalPlaces: 2 })));
      const trigger = container.querySelector<HTMLButtonElement>("[data-cod-deposit] button")!;
      await act(async () => trigger.click());
      await act(async () => vi.dynamicImportSettled());
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.querySelector("h2")?.textContent).toBe("Record deposit");
      const amount = dialog.querySelector<HTMLInputElement>("#recordPaymentAmount")!;
      const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(amount.value).toBe("100.00");

      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        setValue.call(amount, "99");
        amount.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => submit.click());
      expect(amount.getAttribute("aria-invalid")).toBe("true");
      expect(dialog.textContent).toContain("The deposit must be exactly");
      expect(record).not.toHaveBeenCalled();

      await act(async () => {
        setValue.call(amount, "100");
        amount.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => submit.click());
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("Couldn't reach the server.");
      const first = record.mock.calls[0]?.[0];
      expect(first).toEqual({
        path: { id: "order_1" },
        headers: { "idempotency-key": expect.stringMatching(/^record-payment-/) },
        body: { amountMinor: 10_000, via: "bank_transfer", paymentType: "deposit", expectedRevision: 1 },
      });

      await act(async () => submit.click());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(record).toHaveBeenCalledTimes(2);
      expect(record.mock.calls[1]?.[0]).toEqual(first);
    } finally {
      await act(async () => root.unmount());
      client.clear();
      container.remove();
      notifyManager.setScheduler((callback) => setTimeout(callback, 0));
      vi.unstubAllGlobals();
    }
  });
});
