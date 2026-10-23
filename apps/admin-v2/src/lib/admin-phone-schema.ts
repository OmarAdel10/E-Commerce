// The dashboard's one phone rule for forms: the customer editor, an address
// book entry, a new or edited order. A Bangladesh mobile in any spacing, with
// +880/880/0 and Bangla digits, or a full international number; saved as
// E.164. Its messages say how to write the number (never a schema's own
// wording) and are read when validation runs, so they follow the language.
import { z } from "zod";
import { validateAndFormatPhone } from "@scalius/shared/customer-utils";
import { toLatinDigits } from "@scalius/shared/phone-input";
import { translate } from "~/i18n";
import { formMessages } from "~/i18n/forms";

/** The E.164 number for a typed phone, or null when it isn't one. */
export function toE164Phone(raw: string): string | null {
  const latin = toLatinDigits(raw).trim();
  const bdMobile = /^(?:\+?880|0)?(1[3-9]\d{8})$/.exec(latin.replace(/[\s\-().]/g, ""));
  if (bdMobile) return `+880${bdMobile[1]}`;
  try {
    return validateAndFormatPhone(latin);
  } catch {
    return null;
  }
}

/**
 * A phone field: E.164 out, or "" for an empty optional one. The server
 * applies the store's accepted-countries setting on save.
 */
export function adminPhoneSchema({ optional = false }: { optional?: boolean } = {}) {
  return z.string().transform((raw, context) => {
    if (!raw.trim()) {
      if (optional) return "";
      context.addIssue({ code: "custom", message: translate(formMessages, "phoneRequired") });
      return z.NEVER;
    }
    const phone = toE164Phone(raw);
    if (phone) return phone;
    context.addIssue({ code: "custom", message: translate(formMessages, "phoneInvalid") });
    return z.NEVER;
  });
}

/** The message for a typed phone that can't be saved, or null (empty is the caller's to judge). */
export function adminPhoneError(raw: string): string | null {
  return raw.trim() && !toE164Phone(raw) ? translate(formMessages, "phoneInvalid") : null;
}
