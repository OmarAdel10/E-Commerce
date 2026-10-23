/**
 * A page whose data takes longer than this shows its skeleton (polish bar
 * L3: nothing flashes for a fast page), and once shown the skeleton stays at
 * least as long, so it never blinks. Until then the current page stays.
 */
export const ROUTE_PENDING_MS = 300;
export const ROUTE_PENDING_MIN_MS = 300;

/**
 * When the dashboard router runs a page's loader, and whether it waits for it.
 * React Query owns caching and freshness: a loader resolves at once from the
 * cache, or awaits a read on purpose, as an edit page does for its record
 * (`loadEditorRecord`). So the router re-runs loaders on every preload and
 * every visit, and a visit always waits for its loader.
 */
export const ROUTER_LOADING_OPTIONS = {
  // Hovering or focusing a link fetches the page's code and runs its loader,
  // so the click lands on data already in flight.
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  // The router keeps a page it showed before (30 minutes). By default a later
  // visit renders that kept page at once and runs the loader behind it, so an
  // editor mounted on the cached record and took its revision before the
  // loader's fresh read landed: open a page, trash and restore it from the
  // list, open it again, and the first save was refused as if someone else
  // had saved (CONTENT-004). Blocking costs a loader that resolves from the
  // cache nothing.
  defaultStaleReloadMode: "blocking",
  // A link to a page whose read is slow (a detail page opened from a push,
  // an email or a list) shows that page's skeleton inside the shell after
  // 300 ms instead of holding the old page or a blank one.
  defaultPendingMs: ROUTE_PENDING_MS,
  defaultPendingMinMs: ROUTE_PENDING_MIN_MS,
} as const;
