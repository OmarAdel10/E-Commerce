// Manual COD deposit policy: a radio group with inherit / required / exempt.
// The card explains the effective behaviour based on the global default.
import React from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useMessages } from "~/i18n";
import { productMessages } from "~/i18n/products";
import type { ProductFormValues } from "./types";

export function CodDepositPolicyCard({ form, readOnly }: {
  form: UseFormReturn<ProductFormValues>;
  readOnly: boolean;
}) {
  const t = useMessages(productMessages);
  const codDepositPolicy = useWatch({ control: form.control, name: "codDepositPolicy" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("depositPolicy")}</CardTitle>
        <CardDescription>{t("depositPolicyHelp")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <RadioGroup
          value={codDepositPolicy ?? "inherit"}
          onValueChange={(value) => form.setValue("codDepositPolicy", value as "inherit" | "required" | "exempt")}
          disabled={readOnly}
        >
          <label className="flex items-start gap-2 py-1 text-body">
            <span className="flex h-lh items-center"><RadioGroupItem value="inherit" /></span>
            <span>
              <span className="block font-medium">{t("inheritGlobal")}</span>
              <span className="block text-muted-foreground text-caption">{t("inheritGlobalHelp")}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 py-1 text-body">
            <span className="flex h-lh items-center"><RadioGroupItem value="required" /></span>
            <span>
              <span className="block font-medium">{t("requireDeposit")}</span>
              <span className="block text-muted-foreground text-caption">{t("requireDepositHelp")}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 py-1 text-body">
            <span className="flex h-lh items-center"><RadioGroupItem value="exempt" /></span>
            <span>
              <span className="block font-medium">{t("exemptFromDeposit")}</span>
              <span className="block text-muted-foreground text-caption">{t("exemptFromDepositHelp")}</span>
            </span>
          </label>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
