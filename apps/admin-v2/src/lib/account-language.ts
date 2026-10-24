import { getApiV1AdminAuthLanguage, putApiV1AdminAuthLanguage } from "@scalius/api-client/sdk";
import { getLocale, setLocale, type Locale } from "~/i18n";
import { apiData } from "~/lib/api";

/*
 * The dashboard language follows the staff member, not the browser. This
 * browser's last language is the first paint (`~/i18n` reads it before the
 * first render); the account's choice, once read, replaces it. A choice made
 * here (store menu, search palette: `setLocale`, then `saveAccountLocale`) is
 * saved to the account, so every other browser follows on its next load.
 * Loaded after the shell's first render, and by those choices.
 */

/** Saves the language the staff member just chose. A failed save leaves this browser in it; the next choice saves again. */
export function saveAccountLocale(locale: Locale): void {
  void putApiV1AdminAuthLanguage({ body: { language: locale } }).catch(() => undefined);
}

/** Once per dashboard load: the account's language, when the staff member chose one, replaces this browser's. */
export async function followAccountLocale(): Promise<void> {
  const shown = getLocale();
  const { language } = await apiData(getApiV1AdminAuthLanguage()).catch(() => ({ language: null }));
  // A choice made here while the read was in flight is newer than the account's answer.
  if (language && getLocale() === shown) setLocale(language);
}
