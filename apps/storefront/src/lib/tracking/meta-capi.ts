// src/lib/tracking/meta-capi.ts

/**
 * Client-side dispatcher for Meta Conversions API
 */
import {
  sendMetaCapiEvent,
  type MetaCapiEventPayload,
} from "../api/tracking";
import { trackingPageUrl } from "@scalius/shared/tracking-url";
import { marketingAllowed, saleOfDataRefused } from "./consent";
export { createMetaEventId } from "./meta-event-id";

function getCookie(name: string): string {
  if (typeof document === "undefined") {
    return "";
  }
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(";").shift() || "";
  }
  return "";
}

function getFromSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch (e: unknown) {
    console.warn("Could not access sessionStorage:", e);
    return null;
  }
}

function getBrowserUserData(): Partial<MetaCapiEventPayload["userData"]> {
  if (typeof window === "undefined") {
    return {};
  }

  const fbc = getCookie("_fbc") || getFromSession("scalius_fbc") || undefined;
  const fbp = getCookie("_fbp") || undefined;

  // TikTok's browser id and click id ride along for the Events API relay.
  const ttp = getCookie("_ttp") || undefined;
  const ttclid = getCookie("scalius_ttclid") || undefined;
  const userData: Partial<MetaCapiEventPayload["userData"]> = {
    client_user_agent: navigator.userAgent,
    fbp: fbp,
    fbc: fbc,
    ...(ttp ? { ttp } : {}),
    ...(ttclid ? { ttclid: decodeURIComponent(ttclid) } : {}),
  };

  return userData;
}

/** The page as tracking hears it: origin, path and campaign parameters only (the API projects it again). */
function eventSourceUrl(): string {
  return trackingPageUrl(window.location.href) ?? `${window.location.origin}/`;
}

/**
 * Sends a server-side event to Meta's CAPI.
 */
export function sendServerEvent(
  event: Omit<MetaCapiEventPayload, "eventSourceUrl" | "userData"> & {
    userData?: Partial<MetaCapiEventPayload["userData"]>;
  },
) {
  if (typeof window === "undefined") {
    return;
  }
  // Server relays need the same marketing consent as the pixels.
  if (window.__META_CAPI_BROWSER_EVENTS_ENABLED__ !== true || !marketingAllowed()) {
    return;
  }

  // Construct the full payload
  const fullPayload: MetaCapiEventPayload = {
    eventId: event.eventId,
    eventName: event.eventName,
    eventSourceUrl: eventSourceUrl(),
    userData: {
      ...getBrowserUserData(),
      ...(event.userData || {}),
    },
    customData: event.customData,
    ...(saleOfDataRefused() ? { limitedDataUse: true } : {}),
  };

  try {
    sendMetaCapiEvent(fullPayload);
  } catch (error: unknown) {
    console.error(
      `[Meta CAPI] Failed to dispatch event '${event.eventName}':`,
      error,
    );
  }
}
