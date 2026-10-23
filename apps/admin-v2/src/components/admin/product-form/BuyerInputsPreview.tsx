import React from "react";
import type { CustomizationSchema } from "@scalius/shared/line-properties";
import { Button } from "@/components/ui/button";
import {
  LinePropertyFields,
  linePropertyErrors,
  linePropertyFieldId,
  type LinePropertyError,
} from "@/components/admin/order-form/LinePropertyFields";
import { useMessages } from "~/i18n";
import { orderFormMessages } from "~/i18n/order-form";
import { productMessages } from "~/i18n/products";

/**
 * The block the buyer fills on the product page, live from the editor's
 * inputs (loaded when the merchant opens the preview). It judges the values
 * as the product page does, with the one shared rule (`lineInputIssues`): a
 * count that turns red over its limit while typing, and on "Try Add to cart"
 * a message under every field to fix, the first one focused. Editing a field
 * clears its message, as on the product page.
 */
export function BuyerInputsPreview({ schema, surcharge }: {
  schema: CustomizationSchema;
  surcharge: (priceMinor: number) => string;
}) {
  const t = useMessages(productMessages);
  const o = useMessages(orderFormMessages);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<LinePropertyError[]>([]);
  const [accepted, setAccepted] = React.useState(false);
  const tryAdd = () => {
    const found = linePropertyErrors(schema, values, o);
    setErrors(found);
    setAccepted(found.length === 0);
    if (found[0]) document.getElementById(linePropertyFieldId(found[0].key))?.focus();
  };
  return (
    <div className="space-y-3">
      <LinePropertyFields
        schema={schema}
        values={values}
        onChange={(key, value) => {
          setValues((current) => ({ ...current, [key]: value }));
          setErrors((current) => current.filter((entry) => entry.key !== key));
          setAccepted(false);
        }}
        errors={errors}
        surcharge={surcharge}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={tryAdd}>{t("buyerInputsTryAdd")}</Button>
        <p className="text-body text-muted-foreground" role="status">{accepted ? t("buyerInputsAccepted") : ""}</p>
      </div>
    </div>
  );
}
