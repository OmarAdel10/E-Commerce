import type { CheckoutLanguageData, CheckoutLanguageKey } from "@scalius/shared/checkout-language";

const DEFAULT_CHECKOUT_ERROR = "Order creation failed";
/** Placeholders the proxies write when the API said nothing a buyer can act on. */
const GENERIC_CHECKOUT_ERRORS = new Set(["", DEFAULT_CHECKOUT_ERROR, "Payment failed"]);

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === "object" && value !== null;
}

function parseJsonErrorString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed || !["[", "{"].includes(trimmed[0])) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function collectMessages(value: unknown): string[] {
  if (typeof value === "string") {
    const parsed = parseJsonErrorString(value);
    if (parsed !== null) return collectMessages(parsed);

    const message = value.trim();
    return message && message !== "[object Object]" ? [message] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMessages(item));
  }

  if (!isRecord(value)) return [];

  const messages: string[] = [];

  for (const key of ["details", "issues", "errors", "itemIssues", "lineIssues"]) {
    if (key in value) {
      messages.push(...collectMessages(value[key]));
    }
  }

  if ("error" in value) {
    messages.push(...collectMessages(value.error));
  }

  if (typeof value.message === "string") {
    messages.push(...collectMessages(value.message));
  }

  return messages;
}

export function getCheckoutErrorMessage(
  error: unknown,
  fallback = DEFAULT_CHECKOUT_ERROR,
): string {
  const messages = collectMessages(error);
  const uniqueMessages = [...new Set(messages.map((message) => message.trim()))]
    .filter(Boolean)
    .filter((message) => message !== "Invalid input data");

  if (uniqueMessages.length > 0) {
    return uniqueMessages.join(". ");
  }

  return fallback;
}

/**
 * What the buyer reads when the store refused an order: the API's own message
 * for a request it refused (4xx), else the page's copy for the status. A
 * server failure (5xx) never shows its text: it is a proxy's or a provider's,
 * not the buyer's.
 */
export function checkoutOrderFailureText(
  status: number | undefined,
  message: string,
  copy: CheckoutLanguageData,
): string {
  const text = message.trim();
  if (status !== undefined && status >= 500) {
    return status >= 502 && status <= 504 ? copy.checkoutUnavailableMessage : copy.orderProcessingFailedText;
  }
  if (!GENERIC_CHECKOUT_ERRORS.has(text)) return text;
  switch (status) {
    case 401:
      return copy.signInToCheckoutText;
    case 409:
      return copy.checkoutConflictText;
    case 429:
      return copy.tooManyCheckoutAttemptsText;
    default:
      return copy.orderProcessingFailedText;
  }
}

/**
 * A checkout failure the buyer reads: it names its words by checkout-language
 * key, so they are the page's language and the merchant's edits. The message
 * is the developer's detail and stays internal.
 */
export class CheckoutCopyError extends Error {
  constructor(readonly copyKey: CheckoutLanguageKey, detail?: string) {
    super(detail ?? copyKey);
    this.name = "CheckoutCopyError";
  }
}

/** A failure already in the buyer's words (the page's copy, or the store's refusal of the order). */
export class CheckoutBuyerMessage extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutBuyerMessage";
  }
}

/**
 * The buyer's words for a failure: its own copy key or buyer message, else
 * `fallback`'s copy. A raw error message never reaches the page.
 */
export function checkoutFailureText(
  error: unknown,
  copy: CheckoutLanguageData,
  fallback: CheckoutLanguageKey,
): string {
  if (error instanceof CheckoutBuyerMessage) return error.message;
  return copy[error instanceof CheckoutCopyError ? error.copyKey : fallback];
}
