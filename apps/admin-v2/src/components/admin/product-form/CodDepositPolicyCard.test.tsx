// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useForm, type UseFormReturn } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { CodDepositPolicyCard } from "./CodDepositPolicyCard";
import type { ProductFormValues } from "./types";

type DepositPolicy = NonNullable<ProductFormValues["codDepositPolicy"]>;

function PolicyCardHarness({
  initialPolicy,
  readOnly = false,
  onForm,
}: {
  initialPolicy?: DepositPolicy;
  readOnly?: boolean;
  onForm: (form: UseFormReturn<ProductFormValues>) => void;
}) {
  const form = useForm<ProductFormValues>({
    defaultValues: initialPolicy ? { codDepositPolicy: initialPolicy } : {},
  });
  onForm(form);

  return <CodDepositPolicyCard form={form} readOnly={readOnly} />;
}

async function renderPolicyCard(options: {
  initialPolicy?: DepositPolicy;
  readOnly?: boolean;
}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  let form: UseFormReturn<ProductFormValues> | undefined;

  await act(async () => root.render(
    <PolicyCardHarness
      initialPolicy={options.initialPolicy}
      readOnly={options.readOnly}
      onForm={(nextForm) => {
        form = nextForm;
      }}
    />,
  ));

  const currentForm = form;
  if (!currentForm) throw new Error("Product form was not created");
  return { container, root, form: currentForm };
}

function radio(container: HTMLElement, value: DepositPolicy) {
  return container.querySelector<HTMLButtonElement>(`[role="radio"][value="${value}"]`)!;
}

async function unmount(root: Root, container: HTMLElement) {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
}

describe("CodDepositPolicyCard", () => {
  it("renders the inherit, required, and exempt policy options", async () => {
    const { container, root } = await renderPolicyCard({});

    try {
      expect(container.textContent).toContain("Inherit global settings");
      expect(container.textContent).toContain("Require deposit");
      expect(container.textContent).toContain("Do not require deposit");
      expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3);
    } finally {
      await unmount(root, container);
    }
  });

  it("defaults to inherit when the form has no policy value", async () => {
    const { container, root } = await renderPolicyCard({});

    try {
      expect(radio(container, "inherit").getAttribute("aria-checked")).toBe("true");
      expect(radio(container, "required").getAttribute("aria-checked")).toBe("false");
      expect(radio(container, "exempt").getAttribute("aria-checked")).toBe("false");
    } finally {
      await unmount(root, container);
    }
  });

  it("reflects the form's policy value as selected", async () => {
    const { container, root } = await renderPolicyCard({ initialPolicy: "required" });

    try {
      expect(radio(container, "required").getAttribute("aria-checked")).toBe("true");
      expect(radio(container, "inherit").getAttribute("aria-checked")).toBe("false");
      expect(radio(container, "exempt").getAttribute("aria-checked")).toBe("false");
    } finally {
      await unmount(root, container);
    }
  });

  it("updates the form with the picked policy", async () => {
    const { container, root, form } = await renderPolicyCard({});
    const setValue = vi.spyOn(form, "setValue");

    try {
      await act(async () => radio(container, "required").click());

      expect(setValue).toHaveBeenCalledWith("codDepositPolicy", "required", { shouldDirty: true });
      expect(form.getValues("codDepositPolicy")).toBe("required");
    } finally {
      await unmount(root, container);
    }
  });

  it("disables every policy option and keeps the value unchanged when read-only", async () => {
    const { container, root, form } = await renderPolicyCard({ readOnly: true });
    const required = radio(container, "required");

    try {
      expect(required.disabled).toBe(true);
      await act(async () => required.click());

      expect(form.getValues("codDepositPolicy")).toBeUndefined();
      expect(radio(container, "inherit").getAttribute("aria-checked")).toBe("true");
    } finally {
      await unmount(root, container);
    }
  });
});
