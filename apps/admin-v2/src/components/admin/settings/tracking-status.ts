// Each tracking destination's two channels as the dashboard reads them: the
// tag or pixel in the browser, and the events the store's server sends. One
// reading for the destination cards and the Integrations page's row, so both
// always say the same thing.
import { useQuery } from "@tanstack/react-query";
import { metaQuery, trackingQuery } from "~/lib/api-query-options/settings-screens";
import {
  DESTINATION_SCRIPT_TYPES,
  browserChannel,
  destinationStatus,
  serverChannel,
  tagIdsFrom,
  trackingSettingsQuery,
  type BrowserChannel,
  type Destination,
  type DestinationStatus,
  type ServerChannel,
  type TagIds,
} from "./tracking-settings";

export interface DestinationReading {
  browser: BrowserChannel;
  /** Null until its settings have loaded. */
  server: ServerChannel | null;
  status: DestinationStatus | null;
  /** The ID the server sends as (its own, else the tag's). */
  sendingAs?: string;
}

export function useTrackingStatus(): { ids: TagIds; destinations: Record<Destination, DestinationReading> } {
  const scripts = useQuery(trackingQuery).data?.scripts ?? [];
  const settings = useQuery(trackingSettingsQuery).data;
  const meta = useQuery(metaQuery).data;
  const ids = tagIdsFrom(scripts);
  const reading = (destination: Destination, server: ServerChannel | null, sendingAs: string | undefined): DestinationReading => {
    const browser = browserChannel(scripts, DESTINATION_SCRIPT_TYPES[destination]);
    return { browser, server, status: server ? destinationStatus(browser, server) : null, sendingAs };
  };
  const ga4 = settings?.ga4;
  const ga4Id = ga4 ? ga4.measurementId.trim() || ids.ga4 : undefined;
  const tiktok = settings?.tiktok;
  const tiktokId = tiktok ? tiktok.pixelCode.trim() || ids.tiktok : undefined;
  const metaSaved = meta?.settings;
  const metaId = metaSaved?.pixelId?.trim() || ids.meta;
  return {
    ids,
    destinations: {
      ga4: reading("ga4", ga4
        ? serverChannel({ enabled: ga4.isEnabled, ready: Boolean(ga4Id && ga4.apiSecret), saved: Boolean(ga4.measurementId || ga4.apiSecret), testMode: ga4.debugMode })
        : null, ga4Id),
      meta: reading("meta", meta
        ? serverChannel({
            enabled: metaSaved?.isEnabled === true,
            ready: Boolean(metaId && metaSaved?.accessToken),
            saved: Boolean(metaSaved?.pixelId || metaSaved?.accessToken),
            testMode: Boolean(metaSaved?.testEventCode),
          })
        : null, metaId),
      tiktok: reading("tiktok", tiktok
        ? serverChannel({ enabled: tiktok.isEnabled, ready: Boolean(tiktokId && tiktok.accessToken), saved: Boolean(tiktok.pixelCode || tiktok.accessToken), testMode: Boolean(tiktok.testEventCode) })
        : null, tiktokId),
    },
  };
}
