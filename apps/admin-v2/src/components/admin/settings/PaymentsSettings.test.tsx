// @vitest-environment happy-dom

import { putApiV1AdminSettingsCheckoutFlow } from "@scalius/api-client/sdk";
import type { PutApiV1AdminSettingsCheckoutFlowResponse } from "@scalius/api-client/types";
import { DEFAULT_NET_TERMS_SETTINGS } from "@scalius/shared/payment-terms";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SaveScope } from "~/components/admin/shared/SaveBar";
import { PermissionProvider } from "~/contexts/PermissionContext";
import { appPaymentProvidersQuery } from "~/lib/api-query-options/payment-providers";
import { marketCurrenciesQueryOptions } from "~/lib/api-query-options/markets";
import { checkoutFlowQuery, currencyQuery, paymentMethodsQuery } from "~/lib/api-query-options/settings-screens";
import { PaymentMethodsCard } from "./PaymentsSettings";

vi.mock(import("@scalius/api-client/sdk"), async (importOriginal) => ({
  ...await importOriginal(),
  putApiV1AdminSettingsCheckoutFlow: vi.fn(),
}));

function editField(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("validates and saves the active COD deposit mode through the checkout settings controls", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: "static" } } });
  const savedFlow: PutApiV1AdminSettingsCheckoutFlowResponse["data"] = {
    checkoutMode: "all",
    guestCheckoutEnabled: true,
    partialPaymentEnabled: false,
    partialPaymentAmount: 0,
    requireFullBillingAddress: false,
    autoFulfilMode: "after_payment",
    codDepositEnabled: false,
    codDepositMode: "fixed",
    codDepositAmount: 0,
    codDepositPercent: 0,
    codDepositInstructions: "",
    revision: 4,
  };
  let stored = savedFlow;
  const save = vi.mocked(putApiV1AdminSettingsCheckoutFlow);
  save.mockImplementation(async ({ body }) => {
    const { expectedRevision: _expectedRevision, ...changes } = body;
    stored = { ...stored, ...changes, revision: stored.revision + 1 };
    return {
      data: { success: true, data: stored },
      request: new Request("https://admin-api.invalid"),
      response: new Response(null, { status: 200 }),
    };
  });
  client.setQueryData(checkoutFlowQuery.queryKey, savedFlow);
  client.setQueryData(currencyQuery.queryKey, { currencyCode: "USD", currencySymbol: "$" });
  client.setQueryData(paymentMethodsQuery.queryKey, {
    enabledMethods: ["cod"],
    defaultMethod: "cod",
    revision: 2,
    gateways: [],
    gatewayStatus: { cod: { enabled: true, configured: true, usable: true } },
    netTerms: DEFAULT_NET_TERMS_SETTINGS,
  });
  client.setQueryData(appPaymentProvidersQuery.queryKey, []);
  client.setQueryData(marketCurrenciesQueryOptions().queryKey, { shopCurrencyCode: "USD", chargeable: "any", marketCurrencies: [] });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const field = <T extends HTMLElement,>(selector: string) => container.querySelector<T>(selector)!;
  const submit = () => field<HTMLButtonElement>("#submit-payment-settings").click();

  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}>
        <PermissionProvider permissions={["settings.general.edit"]}>
          <SaveScope render={(state) => (
            <button id="submit-payment-settings" type="button" onClick={() => void state.saveAll()}>Save</button>
          )}>
            <PaymentMethodsCard />
          </SaveScope>
        </PermissionProvider>
      </QueryClientProvider>,
    ));
    expect(container.querySelector("#cod-deposit-amount")).toBeNull();
    await act(async () => field<HTMLButtonElement>("#cod-deposit").click());

    const percentage = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((radio) => radio.closest("label")?.textContent?.includes("Percentage of total"))!;
    const group = percentage.closest('[role="radiogroup"]');
    const label = document.getElementById(group?.getAttribute("aria-labelledby") ?? "");
    expect(label?.textContent).toBe("Deposit mode");
    const fixed = field<HTMLInputElement>("#cod-deposit-amount");
    expect(fixed.getAttribute("aria-invalid")).toBe("true");
    await act(async () => submit());
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      editField(fixed, "12.50");
      editField(field<HTMLTextAreaElement>("#cod-deposit-instructions"), "Transfer to the store account.");
    });
    await act(async () => submit());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(client.getQueryData(checkoutFlowQuery.queryKey)).toMatchObject({ revision: 5 });
    });
    expect(save.mock.calls[0]?.[0].body).toEqual({
      checkoutMode: "all",
      guestCheckoutEnabled: true,
      partialPaymentEnabled: false,
      partialPaymentAmount: 0,
      requireFullBillingAddress: false,
      autoFulfilMode: "after_payment",
      expectedRevision: 4,
      codDepositEnabled: true,
      codDepositMode: "fixed",
      codDepositAmount: 12.5,
      codDepositInstructions: "Transfer to the store account.",
    });

    await act(async () => percentage.click());
    expect(container.querySelector("#cod-deposit-amount")).toBeNull();
    const percent = field<HTMLInputElement>("#cod-deposit-percent");
    await act(async () => editField(percent, "100"));
    expect(percent.getAttribute("aria-invalid")).toBe("true");
    await act(async () => submit());
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => editField(percent, "25"));
    await act(async () => submit());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(client.getQueryData(checkoutFlowQuery.queryKey)).toMatchObject({ revision: 6 });
    });
    expect(save.mock.calls[1]?.[0].body).toMatchObject({
      expectedRevision: 5,
      codDepositEnabled: true,
      codDepositMode: "percentage",
      codDepositPercent: 25,
      codDepositInstructions: "Transfer to the store account.",
    });
    expect(save.mock.calls[1]?.[0].body).not.toHaveProperty("codDepositAmount");

    await act(async () => field<HTMLButtonElement>("#cod-deposit").click());
    expect(container.querySelector("#cod-deposit-percent")).toBeNull();
    expect(container.querySelector("#cod-deposit-instructions")).toBeNull();
    await act(async () => submit());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(client.getQueryData(checkoutFlowQuery.queryKey)).toMatchObject({ revision: 7 });
    });
    expect(save.mock.calls[2]?.[0].body).toMatchObject({
      expectedRevision: 6,
      codDepositEnabled: false,
    });
    expect(save.mock.calls[2]?.[0].body).not.toHaveProperty("codDepositAmount");
    expect(save.mock.calls[2]?.[0].body).not.toHaveProperty("codDepositPercent");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});
