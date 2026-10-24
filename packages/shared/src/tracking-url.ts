// The page URL a tracking destination hears with a browser event (Meta
// Conversions API `event_source_url`, TikTok Events API `page.url`): the
// page's origin and path, plus the campaign parameters an ad platform
// attributes by, and nothing else. A query string or fragment can carry what
// a theme or an app put there (an email, a phone, a sign-in code, a token),
// so everything outside this list is dropped, never matched against a list of
// known secrets. The storefront projects before it sends and the API projects
// again at the relay, so a direct call cannot widen it.

/** The query parameters a tracking page URL keeps (exact, lower-case names). */
export const TRACKING_URL_PARAMETERS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "ttclid",
  "gclid",
] as const;

/** A kept parameter's longest value; a longer one is dropped, not cut. */
const MAX_VALUE_LENGTH = 500;

/**
 * The tracking projection of a page URL: `origin + path` and the kept
 * campaign parameters, without credentials, other parameters or the
 * fragment. Null for a URL that does not parse or is not http(s).
 */
export function trackingPageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const projected = new URL(`${parsed.origin}${parsed.pathname}`);
  for (const name of TRACKING_URL_PARAMETERS) {
    const value = parsed.searchParams.get(name);
    if (value !== null && value.length > 0 && value.length <= MAX_VALUE_LENGTH) projected.searchParams.set(name, value);
  }
  return projected.toString();
}
