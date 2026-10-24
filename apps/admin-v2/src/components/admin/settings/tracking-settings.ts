// The tracking settings document (`/admin/settings/tracking`): the cookie
// banner's choice and the sales sent to Google Analytics 4 and TikTok from the
// store's server, each section at its own revision. Customer privacy edits the
// banner; Integrations' Google and TikTok cards edit their own section. Pure:
// both pages' code imports it without the other's cards.
import {
  getApiV1AdminAnalyticsTrackingHealth,
  getApiV1AdminSettingsTracking,
  type getApiV1AdminAnalytics,
  type postApiV1AdminSettingsTracking,
} from "@scalius/api-client/sdk";
import type { ConsentRegime } from "@scalius/shared/tracking-consent";
import { apiData, type ApiBody, type ApiResult } from "~/lib/api";
import type { SettingsPrivacyMessageKey } from "~/i18n/settings-privacy";
import { sameFormValue } from "~/lib/form-values";
import type { AnalyticsScriptType } from "~/lib/analytics-script-types";

type TrackingSettings = ApiResult<typeof getApiV1AdminSettingsTracking>;
export type TrackingHealth = ApiResult<typeof getApiV1AdminAnalyticsTrackingHealth>;
export type Destination = TrackingHealth["destinations"][number]["destination"];
type SaveBody = ApiBody<typeof postApiV1AdminSettingsTracking>;
type ScriptSummary = ApiResult<typeof getApiV1AdminAnalytics>["scripts"][number];

export interface PrivacyValues {
  otherRegions: ConsentRegime;
  ga4: { isEnabled: boolean; measurementId: string; apiSecret: string; debugMode: boolean };
  tiktok: { isEnabled: boolean; pixelCode: string; accessToken: string; testEventCode: string };
}
export type Revisions = { consent: number; ga4: number; tiktok: number };
export type Loaded = PrivacyValues & { revision: Revisions };

export const trackingSettingsQuery = {
  queryKey: ["settings", "tracking"] as const,
  queryFn: async (): Promise<Loaded> => loadedFrom(await apiData(getApiV1AdminSettingsTracking())),
};

export const trackingHealthQuery = {
  queryKey: ["settings", "tracking", "health"] as const,
  queryFn: () => apiData(getApiV1AdminAnalyticsTrackingHealth()),
};

/** The API's document as the form's values, with each section's revision beside them. */
export function loadedFrom(settings: TrackingSettings): Loaded {
  return {
    otherRegions: settings.consent.otherRegions,
    ga4: {
      isEnabled: settings.ga4.isEnabled,
      measurementId: settings.ga4.measurementId ?? "",
      apiSecret: settings.ga4.apiSecret ?? "",
      debugMode: settings.ga4.debugMode,
    },
    tiktok: {
      isEnabled: settings.tiktok.isEnabled,
      pixelCode: settings.tiktok.pixelCode ?? "",
      accessToken: settings.tiktok.accessToken ?? "",
      testEventCode: settings.tiktok.testEventCode ?? "",
    },
    revision: { consent: settings.consent.revision, ga4: settings.ga4.revision, tiktok: settings.tiktok.revision },
  };
}

/**
 * Only the sections that changed, each at its own revision; a secret goes
 * only when the merchant typed a new one (the masked value keeps it).
 */
export function trackingSaveBody(values: PrivacyValues, saved: PrivacyValues, revision: Revisions): SaveBody {
  const body: SaveBody = {};
  if (values.otherRegions !== saved.otherRegions) {
    body.consent = { otherRegions: values.otherRegions, expectedRevision: revision.consent };
  }
  if (!sameFormValue(values.ga4, saved.ga4)) {
    const { apiSecret, ...rest } = values.ga4;
    body.ga4 = { ...rest, measurementId: rest.measurementId.trim(), ...(apiSecret !== saved.ga4.apiSecret ? { apiSecret } : {}), expectedRevision: revision.ga4 };
  }
  if (!sameFormValue(values.tiktok, saved.tiktok)) {
    const { accessToken, ...rest } = values.tiktok;
    body.tiktok = {
      ...rest,
      pixelCode: rest.pixelCode.trim(),
      testEventCode: rest.testEventCode.trim(),
      ...(accessToken !== saved.tiktok.accessToken ? { accessToken } : {}),
      expectedRevision: revision.tiktok,
    };
  }
  return body;
}

/**
 * The IDs the browser tags already carry (the API reads them from each saved
 * tag): the server's sales reuse them, so a merchant types a pixel code once.
 * An active tag wins over one that is off.
 */
export interface TagIds {
  ga4?: string;
  meta?: string;
  tiktok?: string;
}

const TAG_TYPES = { ga4: "google_analytics", meta: "facebook_pixel", tiktok: "tiktok_pixel" } as const;

export function tagIdsFrom(scripts: readonly Pick<ScriptSummary, "type" | "identifier" | "isActive">[]): TagIds {
  const ids: TagIds = {};
  for (const destination of Object.keys(TAG_TYPES) as Array<keyof typeof TAG_TYPES>) {
    const tags = scripts.filter((script) => script.type === TAG_TYPES[destination] && script.identifier);
    const id = (tags.find((script) => script.isActive) ?? tags[0])?.identifier;
    if (id) ids[destination] = id;
  }
  return ids;
}

/** The values a save sends: an ID left empty is the tag's. */
export function withTagIds(values: PrivacyValues, ids: TagIds, section: "ga4" | "tiktok"): PrivacyValues {
  if (section === "ga4") {
    return values.ga4.measurementId.trim() || !ids.ga4 ? values : { ...values, ga4: { ...values.ga4, measurementId: ids.ga4 } };
  }
  return values.tiktok.pixelCode.trim() || !ids.tiktok ? values : { ...values, tiktok: { ...values.tiktok, pixelCode: ids.tiktok } };
}

const GA4_ID = /^G-[A-Z0-9]{4,}$/i;
const PIXEL_CODE = /^[A-Z0-9]+$/i;

export type PrivacyProblemField = "ga4-measurement-id" | "ga4-enabled" | "tiktok-pixel-code" | "tiktok-enabled";

/** What blocks saving, by field id (the API refuses the same). An ID the tag carries counts. */
export function privacyProblems(values: PrivacyValues, ids: TagIds = {}): Partial<Record<PrivacyProblemField, SettingsPrivacyMessageKey>> {
  const problems: ReturnType<typeof privacyProblems> = {};
  const measurementId = values.ga4.measurementId.trim();
  if (measurementId && !GA4_ID.test(measurementId)) problems["ga4-measurement-id"] = "measurementIdInvalid";
  if (values.ga4.isEnabled && (!(measurementId || ids.ga4) || !values.ga4.apiSecret.trim())) problems["ga4-enabled"] = "ga4Needs";
  const pixelCode = values.tiktok.pixelCode.trim();
  if (pixelCode && !PIXEL_CODE.test(pixelCode)) problems["tiktok-pixel-code"] = "pixelCodeInvalid";
  if (values.tiktok.isEnabled && (!(pixelCode || ids.tiktok) || !values.tiktok.accessToken.trim())) problems["tiktok-enabled"] = "tiktokNeeds";
  return problems;
}

/**
 * Each destination hears about the store two ways: the tag or pixel in the
 * customer's browser, and the store's own server (Measurement Protocol,
 * Conversions API, Events API). The browser is on with an active tag; the
 * server once it is turned on with its ID and secret.
 */
/**
 * The tags each destination owns (Google, Facebook and Instagram, TikTok).
 * The Other tracking card keeps the rest: your own code and Cloudflare Web
 * Analytics.
 */
export const DESTINATION_SCRIPT_TYPES = {
  ga4: ["google_analytics", "google_tag_manager"],
  meta: ["facebook_pixel"],
  tiktok: ["tiktok_pixel"],
} as const satisfies Record<Destination, readonly AnalyticsScriptType[]>;

export type BrowserChannel = "on" | "off" | "missing";
export type ServerChannel = "on" | "test" | "off" | "missing";
export type DestinationStatus = "both" | "browser" | "server" | "none";

export function browserChannel(scripts: readonly Pick<ScriptSummary, "type" | "isActive">[], types: readonly string[]): BrowserChannel {
  const tags = scripts.filter((script) => types.includes(script.type));
  return tags.some((script) => script.isActive) ? "on" : tags.length > 0 ? "off" : "missing";
}

/** `ready`: its ID and secret are saved; `saved`: something is (switched off, not never set up). */
export function serverChannel({ enabled, ready, saved, testMode }: { enabled: boolean; ready: boolean; saved: boolean; testMode: boolean }): ServerChannel {
  if (enabled && ready) return testMode ? "test" : "on";
  return enabled || saved ? "off" : "missing";
}

export function destinationStatus(browser: BrowserChannel, server: ServerChannel): DestinationStatus {
  const viaBrowser = browser === "on";
  const viaServer = server === "on" || server === "test";
  return viaBrowser && viaServer ? "both" : viaBrowser ? "browser" : viaServer ? "server" : "none";
}

export const PRIVACY_DEFAULTS: PrivacyValues = {
  otherRegions: "notice",
  ga4: { isEnabled: false, measurementId: "", apiSecret: "", debugMode: false },
  tiktok: { isEnabled: false, pixelCode: "", accessToken: "", testEventCode: "" },
};
