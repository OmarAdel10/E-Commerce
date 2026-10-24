/*
 * Back (the browser's button, Android's back gesture) closes the open modal
 * overlay instead of changing the page under it: the navigation drawer, the
 * search palette, a dialog or a sheet.
 *
 * The usual history-entry pattern. While any overlay is open the history has
 * one extra entry for the same address (pushed with the native method, so the
 * router never sees it). Back leaves that entry: the top overlay gets Escape,
 * so it closes exactly as Escape closes it (an overlay that refuses Escape,
 * such as a one-time secret, refuses Back too, and a menu open inside it
 * closes first), and the page stays. Closing the last overlay any other way
 * takes the entry back off. A page opened from inside an overlay (a drawer
 * link, a search result) replaces the entry, so history never keeps it: Back
 * from that page returns to the page under the overlay. Deep links and reloads
 * are untouched: the entry only exists while something is open.
 */

let open = 0;
/** The overlay's entry is the current history entry. */
let marked = false;
/** The address of that entry, which a replace while it is current may change. */
let markedHref = "";
/** Our own `history.back()` that takes the entry off is on its way. */
let leaving = false;
let release = 0;
let restore: (() => void) | null = null;

/** While the entry is current, the app's own history calls must step over it. */
function patch() {
  const { pushState, replaceState, go, back } = history;
  const unpatch = () => {
    if (history.pushState === patchedPush) history.pushState = pushState;
    if (history.replaceState === patchedReplace) history.replaceState = replaceState;
    if (history.go === patchedGo) history.go = go;
    if (history.back === patchedBack) history.back = back;
  };
  // A navigation from inside the overlay takes the entry's place (one that stays open gets a new one).
  const patchedPush: History["pushState"] = (data, unused, url) => {
    unmark();
    history.replaceState(data, unused, url);
    window.setTimeout(() => open > 0 && mark());
  };
  const patchedReplace: History["replaceState"] = (data, unused, url) => {
    replaceState.call(history, data, unused, url);
    markedHref = location.href;
  };
  // "Back to where settings were opened from" counts the pages the router knows.
  const patchedGo: History["go"] = (delta = 0) => go.call(history, delta < 0 ? delta - 1 : delta);
  const patchedBack: History["back"] = () => go.call(history, -2);
  history.pushState = patchedPush;
  history.replaceState = patchedReplace;
  history.go = patchedGo;
  history.back = patchedBack;
  restore = unpatch;
}

function mark() {
  if (marked) return;
  History.prototype.pushState.call(history, history.state, "");
  marked = true;
  markedHref = location.href;
  patch();
}

function unmark() {
  marked = false;
  restore?.();
  restore = null;
}

function closeTop() {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
}

function onPopState(event: PopStateEvent) {
  if (leaving) {
    leaving = false;
    // Back on the address the router already shows: nothing for it to do.
    if (location.href === markedHref) event.stopImmediatePropagation();
    return;
  }
  if (!marked) return;
  unmark();
  // A multi-step jump to another page is the router's; the overlay stays.
  if (location.href !== markedHref) {
    window.setTimeout(() => open > 0 && mark());
    return;
  }
  event.stopImmediatePropagation();
  closeTop();
  // Still open (Escape refused, or another overlay below): Back closes it next time.
  window.setTimeout(() => open > 0 && mark());
}

/**
 * The overlays Back closes: a `Dialog` (the search palette too), a `Sheet` and
 * the navigation drawer, never an `AlertDialog` (a decision, such as "Leave
 * page?", which can itself be on screen because Back was pressed) and never a
 * popover or menu. Radix portals each into its own child of <body>.
 */
const OVERLAY = ':is([data-slot="dialog-content"], [data-slot="sheet-content"], [role="dialog"][data-nav])[data-state="open"]';

function sync() {
  const was = open;
  open = document.querySelectorAll(OVERLAY).length;
  if (open > 0) {
    window.clearTimeout(release);
    mark();
  } else if (was > 0) {
    // After the click that closed it has run: a link inside may be navigating, and a new overlay may be opening.
    window.clearTimeout(release);
    release = window.setTimeout(() => {
      if (open > 0 || !marked) return;
      unmark();
      leaving = true;
      History.prototype.back.call(history);
    });
  }
}

let watching: MutationObserver | null = null;

/**
 * Starts once, after the dashboard's first paint: overlays are noticed as
 * their portals come and go. The capture listener runs before the router's,
 * so a Back that only closes an overlay never reaches it.
 */
export function watchOverlaysForBack(): void {
  if (watching) return;
  window.addEventListener("popstate", onPopState, { capture: true });
  watching = new MutationObserver(sync);
  watching.observe(document.body, { childList: true });
  sync();
}

/** For tests: forget everything between cases. */
export function resetBackClosesForTest() {
  watching?.disconnect();
  watching = null;
  window.removeEventListener("popstate", onPopState, { capture: true });
  window.clearTimeout(release);
  unmark();
  open = 0;
  leaving = false;
}
