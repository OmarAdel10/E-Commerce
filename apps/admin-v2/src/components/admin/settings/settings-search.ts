import { settingsNavMessages, settingsSummaryMessages } from "~/i18n/settings";
import { settingsSearchMessages } from "~/i18n/settings-search";
import { SETTINGS_NAV, type SettingsNavKey } from "./settings-nav";
export {
  SETTINGS_CARDS,
  settingsCardLink,
  subPageForHash,
  type SettingsCardEntry,
  type SettingsCardId,
  type SettingsCardLink,
} from "./settings-cards";
import { SETTINGS_CARDS } from "./settings-cards";

/**
 * Things merchants look for by another name (message templates, staff order
 * emails) or that live outside settings: My account, the store theme, and the
 * dashboard language and light/dark mode (account menu, so no link).
 * `section` names where each one is.
 */
export const SEARCH_SHORTCUTS = [
  { card: "accountPassword", section: "myAccount", to: "/admin/account", hash: "password" },
  { card: "accountTwoStep", section: "myAccount", to: "/admin/account", hash: "two-step" },
  { card: "accountSessions", section: "myAccount", to: "/admin/account", hash: "sessions" },
  { card: "messageTemplates", section: "notificationsPage", to: "/admin/settings/notifications", search: { part: "customers" }, hash: "customerNotifications" },
  { card: "staffOrderEmails", section: "notificationsPage", to: "/admin/settings/notifications", search: { part: "staff" }, hash: "staffNotifications" },
  { card: "storeTheme", section: "onlineStore", to: "/admin/online-store/theme" },
  { card: "dashboardLanguage", section: "accountMenu" },
  { card: "dashboardAppearance", section: "accountMenu" },
] as const satisfies ReadonlyArray<{
  card: keyof typeof settingsSearchMessages.en;
  section: keyof typeof settingsSearchMessages.en;
  to?: string;
  search?: { part: string };
  hash?: string;
}>;

export type SearchShortcut = (typeof SEARCH_SHORTCUTS)[number];

export function words(text: string): string[] {
  return text.normalize("NFC").toLocaleLowerCase().split(/[\s,.&/·()-]+/).filter(Boolean);
}

function haystack(...texts: string[]): string[] {
  return texts.flatMap(words);
}

/** Every query word must start one of the entry's words, in either language. */
export function matches(query: string[], entry: string[]): boolean {
  return query.every((term) => entry.some((word) => word.startsWith(term)));
}

/** How many query words are whole words of the entry: "cod" ranks Payment methods (cod) above a prefix hit. */
export function exactness(query: string[], entry: string[]): number {
  // A plural counts as the word itself ("zone" is a whole word of "zones").
  return query.filter((term) => entry.some((word) => word === term || word === `${term}s` || word === `${term}es`)).length;
}

/** Stable: stronger (whole-word) matches first, list order otherwise. */
function byExactness<T>(items: readonly T[], query: string[], wordsOf: (item: T) => string[]): T[] {
  return items
    .map((item, index) => ({ item, index, score: exactness(query, wordsOf(item)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}

const PAGE_WORDS = new Map(
  SETTINGS_NAV.map(({ key }) => [
    key,
    haystack(
      settingsNavMessages.en[key],
      settingsNavMessages.bn[key],
      settingsSummaryMessages.en[key],
      settingsSummaryMessages.bn[key],
    ),
  ]),
);

const CARD_WORDS = new Map(
  [...SETTINGS_CARDS, ...SEARCH_SHORTCUTS].map(({ card }) => [
    card,
    haystack(
      settingsSearchMessages.en[card],
      settingsSearchMessages.bn[card],
      settingsSearchMessages.en[`${card}Terms`],
      settingsSearchMessages.bn[`${card}Terms`],
    ),
  ]),
);

/** Pages, cards and shortcuts matching a settings search, in list order. */
export function searchSettings(query: string): {
  pages: SettingsNavKey[];
  cards: Array<(typeof SETTINGS_CARDS)[number]>;
  shortcuts: SearchShortcut[];
} {
  const terms = words(query);
  if (terms.length === 0) return { pages: SETTINGS_NAV.map((item) => item.key), cards: [], shortcuts: [] };
  return {
    pages: byExactness(
      SETTINGS_NAV.filter(({ key }) => matches(terms, PAGE_WORDS.get(key)!)),
      terms,
      ({ key }) => PAGE_WORDS.get(key)!,
    ).map((item) => item.key),
    cards: byExactness(SETTINGS_CARDS.filter(({ card }) => matches(terms, CARD_WORDS.get(card)!)), terms, ({ card }) => CARD_WORDS.get(card)!),
    shortcuts: byExactness(
      SEARCH_SHORTCUTS.filter(({ card }) => matches(terms, CARD_WORDS.get(card)!)),
      terms,
      ({ card }) => CARD_WORDS.get(card)!,
    ),
  };
}
