// What `pnpm plugin validate` tells a developer about the product card fields
// an app template names (`storefront.templates[].theme.blocks.card.fields`).
// A store applies a template keeping only the card fields that are
// storefront-visible product fields there (`withStorefrontCardFields`), so a
// field no store is sure to have is not an error, but the developer should
// know the template's cards may show less than its screenshots.
//
// - `custom.<key>` is the merchant's namespace: an app cannot create it, and
//   a store has it only if the merchant made it.
// - `<app id>.<key>` is the app's own field: declared in `customFields`, but a
//   store has its definition only once the app writes a value
//   (`ctx.customFields`); installing alone creates nothing.
// - any other namespace belongs to another app.

import { CUSTOM_FIELD_MERCHANT_NAMESPACE } from "../custom-field-keys";
import { storefrontAppTemplateCardFields } from "../storefront-theme/app-templates";
import type { PluginManifest } from "./manifest";

export interface StorefrontTemplateCardFieldNote {
  level: "warn" | "note";
  template: string;
  field: string;
  message: string;
}

export function storefrontTemplateCardFieldNotes(
  manifest: Pick<PluginManifest, "id" | "customFields" | "storefront">,
): StorefrontTemplateCardFieldNote[] {
  const notes: StorefrontTemplateCardFieldNote[] = [];
  for (const template of manifest.storefront.templates) {
    for (const field of storefrontAppTemplateCardFields(template.theme)) {
      const separator = field.lastIndexOf(".");
      const namespace = field.slice(0, separator);
      const key = field.slice(separator + 1);
      const note = (level: StorefrontTemplateCardFieldNote["level"], message: string) =>
        notes.push({ level, template: template.id, field, message: `Template ${template.id} shows ${field} on product cards: ${message}` });
      if (namespace === CUSTOM_FIELD_MERCHANT_NAMESPACE) {
        note("warn", "custom.* fields belong to the merchant and an app cannot create them. A store without a storefront-visible product field of that name applies the template without it. Declare the field in customFields and name it as "
          + `${manifest.id}.${key} (the app then writes its values), or leave card fields out and let the merchant choose them in the theme editor.`);
      } else if (namespace !== manifest.id) {
        note("warn", `the ${namespace} namespace belongs to another app. A store without that field applies the template without it.`);
      } else {
        const declared = manifest.customFields.find((entry) => entry.ownerType === "product" && entry.key === key);
        if (!declared) note("warn", `declare a product field "${key}" in customFields with storefrontVisible: true.`);
        else if (!declared.storefrontVisible) note("warn", `the declared product field "${key}" is not storefrontVisible, so no store's cards can show it.`);
        else note("note", "a store has this field once the app writes a value (ctx.customFields); until then the template applies without it.");
      }
    }
  }
  return notes;
}
