import { replaceEmailAddresses } from "@scalius/shared/text-scan";

// What of an SMS provider's status text may be kept: every app's answer is
// cut to this before it reaches a delivery receipt or a log (no phone number,
// e-mail address or credential). Whether to retry is the provider's answer
// (`retryable`), not guessed here.

export function sanitizeSmsProviderDiagnostic(rawStatus: string | undefined): string | undefined {
  const sanitized = replaceEmailAddresses(rawStatus ?? "")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[phone]")
    .replace(/((?:bearer|token|api[_ -]?key|secret))\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return sanitized || undefined;
}
