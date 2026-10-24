import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "@tanstack/react-router";
import { cn } from "@scalius/shared/utils";
import { InboxNavBadge } from "~/components/admin/inbox/InboxNavBadge";
import { ReviewsNavBadge } from "~/components/admin/reviews/ReviewsNavBadge";
import { useMessages } from "~/i18n";
import { shellMessages } from "~/i18n/shell";
import { activeNavChild, isSectionActive, type VisibleNavItem } from "./AdminNav";
import { atRest, record, restCheckIn, type PointerSample } from "./hover-intent";
import { NAV_ROW } from "./nav-button";
import { comboCaps, SHORTCUTS } from "./shortcuts";
import { ShellLink } from "./ShellLink";

/** Grace for the pointer to cross from the navigation into the flyout. */
const CLOSE_DELAY = 200;
/** How long a pointer heading into the flyout may cross other rows before they take over. */
const AIM_DELAY = 150;
/** The flyout's distance from the navigation, and its least distance from the window's edges. */
const GAP = 4;
const EDGE = 8;

interface Open {
  key: string;
  icon: HTMLElement;
  /** Opened from nothing (it fades in), not switched from another section's flyout. */
  fresh: boolean;
}

interface Tip {
  label: string;
  keys: boolean;
  /** The control's edge facing the page: its right, or its left in a right-to-left language. */
  edge: number;
  rtl: boolean;
  y: number;
}

const flyoutRow = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-flyout]") : null);
const inFlyout = (target: EventTarget | null) => target instanceof Element && target.closest("[data-flyout-panel]") !== null;
const keyboardFocus = (element: Element) => element.matches(":focus-visible");

/**
 * The desktop navigation's overlays, for the rail and the 240px panel alike,
 * loaded with the navigation: Shopify's flyouts and the tooltip.
 *
 * A section with sub-pages (`data-flyout`: every rail section that has them,
 * and on the panel each one but the open section, whose sub-pages already show)
 * opens a flyout beside the navigation: its title and sub-pages, every row a
 * link, the current page on the pill. It opens the moment the pointer comes to
 * rest over the row (`hover-intent.ts`: no fixed delay, and a sweep opens
 * nothing) or when the row takes keyboard focus. Once one is open, moving to
 * another row switches at once, unless the pointer is heading diagonally into
 * the flyout (aimed, as in Amazon's menus); leaving both closes it after a
 * moment. Tab or the arrow keys move in, Escape returns to the row; clicking
 * the row still opens its own page. Touch never opens one: a tap navigates.
 *
 * The flyout is portalled into the row's list item, so it follows the row in
 * Tab order, and fixed beside the navigation, since the frame clips.
 *
 * The tooltip names an icon-only `data-tip` control (`data-tip="keys"` adds the
 * collapse shortcut) on hover or keyboard focus, beside it on the page's side.
 * Both keep their own state: a hover re-renders them, not the navigation.
 */
export default function NavFlyouts({ frame, nav, inSettings }: { frame: RefObject<HTMLElement | null>; nav: VisibleNavItem[]; inSettings: boolean }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const tipBox = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = frame.current;
    if (!root) return;
    let current: Open | null = null;
    // Escape (or choosing the row itself) closed this section's flyout: it stays closed until its row is left.
    let dismissed: string | null = null;
    let hovered: Element | null = null;
    let timer = 0;
    const trail: PointerSample[] = [];
    const rtl = () => getComputedStyle(root).direction === "rtl";

    const show = (row: HTMLElement | null) => {
      if (row === (current?.icon ?? null)) return;
      current = row ? { key: row.dataset.flyout ?? "", icon: row, fresh: current === null } : null;
      setOpen(current);
    };
    const wait = (ms: number, then: () => void) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(then, ms);
    };

    // Moving toward the flyout's near edge: the slopes to its top and bottom corners both widen.
    // (Pointerover fires before the pointermove at the same spot, so the event gives the newest point.)
    const aiming = (to: PointerSample) => {
      const box = root.querySelector("[data-flyout-panel]")?.getBoundingClientRect();
      const from = trail[Math.max(0, trail.length - 3)];
      if (!box || !from || (from.x === to.x && from.y === to.y)) return false;
      const edge = rtl() ? box.right : box.left;
      const slope = (point: PointerSample, y: number) => (y - point.y) / Math.max(1, Math.abs(edge - point.x));
      return slope(to, box.top) < slope(from, box.top) && slope(to, box.bottom) > slope(from, box.bottom);
    };
    // Where the pointer is now decides (after an aimed crossing or a gap, or straight away).
    const settle = () => {
      if (inFlyout(hovered)) return;
      const row = flyoutRow(hovered);
      show(row && row.dataset.flyout !== dismissed ? row : null);
    };
    // Nothing open yet: open once the pointer rests on the row, looking again when it will have been still.
    const openOnRest = () => {
      window.clearTimeout(timer);
      const row = flyoutRow(hovered);
      if (!row || row.dataset.flyout === dismissed || current) return;
      const now = performance.now();
      if (atRest(trail, now)) show(row);
      else timer = window.setTimeout(openOnRest, restCheckIn(trail, now));
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      record(trail, { x: event.clientX, y: event.clientY, t: performance.now() });
      if (!current && flyoutRow(event.target)) openOnRest();
    };
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hovered = event.target as Element;
      record(trail, { x: event.clientX, y: event.clientY, t: performance.now() });
      showTip(event.target);
      const row = flyoutRow(hovered);
      if (inFlyout(hovered) || (row && row === current?.icon)) return window.clearTimeout(timer);
      if (row?.dataset.flyout !== dismissed) dismissed = null;
      if (!current) openOnRest();
      else if (aiming({ x: event.clientX, y: event.clientY, t: performance.now() })) wait(AIM_DELAY, settle);
      // The gaps between rows keep it a moment, so moving along the list goes from flyout to flyout.
      else if (!row && !hovered.closest("a, button")) wait(CLOSE_DELAY, settle);
      else {
        window.clearTimeout(timer);
        settle();
      }
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hovered = null;
      dismissed = null;
      trail.length = 0;
      setTip(null);
      const focused = document.activeElement;
      // A keyboard user's flyout stays while focus is in it.
      if (focused && current?.icon.parentElement?.contains(focused) && keyboardFocus(focused)) return window.clearTimeout(timer);
      wait(CLOSE_DELAY, () => show(null));
    };

    const showTip = (target: EventTarget | null, focus = false) => {
      const control = target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;
      if (!control || (focus && !keyboardFocus(control))) return setTip(null);
      const box = control.getBoundingClientRect();
      const tipRtl = getComputedStyle(control).direction === "rtl";
      const next = { label: control.getAttribute("aria-label") ?? "", keys: control.dataset.tip === "keys", edge: tipRtl ? box.left : box.right, rtl: tipRtl, y: box.top + box.height / 2 };
      setTip((previous) => (previous && previous.label === next.label && previous.edge === next.edge && previous.y === next.y ? previous : next));
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      showTip(target, true);
      if (inFlyout(target)) return window.clearTimeout(timer);
      const row = flyoutRow(target);
      if (row && keyboardFocus(target)) {
        window.clearTimeout(timer);
        if (row.dataset.flyout !== dismissed) show(row);
      } else if (!row) show(null);
    };
    const onFocusOut = (event: FocusEvent) => {
      setTip(null);
      const next = event.relatedTarget as Node | null;
      const item = current?.icon.parentElement;
      if (dismissed && !(next && flyoutRow(next)?.dataset.flyout === dismissed)) dismissed = null;
      // Within the section, or onto another navigation control (focusin decides), or the pointer still holds it.
      if (!item || (next && root.contains(next)) || (hovered && item.contains(hovered))) return;
      show(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const flyout = root.querySelector<HTMLElement>("[data-flyout-panel]");
      if (!current || !flyout) return;
      const target = event.target as HTMLElement;
      const links = [...flyout.querySelectorAll<HTMLElement>("a[href]")];
      const index = links.indexOf(target);
      const [inward, outward] = rtl() ? ["ArrowLeft", "ArrowRight"] : ["ArrowRight", "ArrowLeft"];
      const row = current.icon;
      if (event.key === "Escape" && (target === row || index >= 0)) {
        dismissed = current.key;
        show(null);
        row.focus();
      } else if (target === row && (event.key === "ArrowDown" || event.key === inward)) links[0]?.focus();
      else if (index < 0) return;
      else if (event.key === outward || (event.key === "ArrowUp" && index === 0)) row.focus();
      else if (event.key === "ArrowUp" || event.key === "ArrowDown") links[Math.min(links.length - 1, index + (event.key === "ArrowUp" ? -1 : 1))]?.focus();
      else if (event.key === "Home" || event.key === "End") links[event.key === "Home" ? 0 : links.length - 1]?.focus();
      else return;
      event.preventDefault();
    };

    const onClick = (event: MouseEvent) => {
      setTip(null);
      if (!current) return;
      // The row itself: its own page opens; the flyout steps aside until the pointer leaves the row.
      if (flyoutRow(event.target) === current.icon) {
        dismissed = current.key;
        return show(null);
      }
      if (!inFlyout(event.target)) return;
      // A sub-page chosen: close. A keyboard choice keeps focus on the navigation rather than on
      // nothing (and the flyout stays shut there); a pointer may come straight back and open it.
      if (event.detail === 0) {
        dismissed = current.key;
        current.icon.focus({ preventScroll: true });
      }
      show(null);
    };
    // A tap anywhere, or a press outside the navigation, closes it; so do scrolling it and resizing.
    const onPointerDown = (event: PointerEvent) => {
      if (current && (event.pointerType === "touch" || !root.contains(event.target as Node))) show(null);
    };
    const onScroll = (event: Event) => {
      if (!inFlyout(event.target)) show(null);
    };
    const onResize = () => show(null);

    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerover", onPointerOver);
    root.addEventListener("pointerleave", onPointerLeave);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("click", onClick);
    root.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerleave", onPointerLeave);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("click", onClick);
      root.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [frame]);

  // The open row can stop being one (its section became the open one): the flyout goes with it.
  const item =
    open?.icon.isConnected && open.icon.hasAttribute("data-flyout")
      ? nav.find((section) => section.key === open.key && section.children.length > 0)
      : undefined;
  const host = item ? open?.icon.parentElement : null;

  // Beside the navigation the row is in (on its left in a right-to-left language), the title row
  // level with the row, moved up as far as needed to stay on screen. Set before paint.
  useLayoutEffect(() => {
    const flyout = panel.current;
    const beside = open?.icon.closest("nav")?.getBoundingClientRect();
    if (!open || !flyout || !beside) return;
    const row = open.icon.getBoundingClientRect();
    const title = flyout.querySelector<HTMLElement>("[data-flyout-title]");
    const titleCentre = title ? title.offsetTop + title.offsetHeight / 2 : 0;
    const x = getComputedStyle(flyout).direction === "rtl" ? beside.left - GAP - flyout.offsetWidth : beside.right + GAP;
    const y = Math.max(EDGE, Math.min(row.top + row.height / 2 - titleCentre, window.innerHeight - EDGE - flyout.offsetHeight));
    flyout.style.setProperty("--tip-x", `${x}px`);
    flyout.style.setProperty("--tip-y", `${y}px`);
  }, [open, item]);

  // 8px beside the control, on the page's side: in a right-to-left page the tooltip ends there,
  // so its own width decides where it starts. Set before paint.
  useLayoutEffect(() => {
    if (tip && tipBox.current) tipBox.current.style.setProperty("--tip-x", `${tip.rtl ? tip.edge - 8 - tipBox.current.offsetWidth : tip.edge + 8}px`);
  }, [tip]);

  return (
    <>
      {tip ? (
        <span
          ref={tipBox}
          aria-hidden
          style={{ "--tip-y": `${tip.y}px` } as CSSProperties}
          className="pointer-events-none fixed left-(--tip-x) top-(--tip-y) z-50 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg bg-topbar px-2 py-1 text-body text-topbar-foreground shadow-popover"
        >
          {tip.label}
          {tip.keys ? (
            <span className="flex gap-1">
              {comboCaps(SHORTCUTS.navigation.combos[0]).map((cap) => (
                <kbd key={cap} className="border-topbar-hover bg-topbar-subdued text-caption">
                  {cap}
                </kbd>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
      {open && item && host ? createPortal(<Flyout ref={panel} item={item} inSettings={inSettings} fresh={open.fresh} />, host) : null}
    </>
  );
}

function Flyout({ ref, item, inSettings, fresh }: { ref: RefObject<HTMLDivElement | null>; item: VisibleNavItem; inSettings: boolean; fresh: boolean }) {
  const t = useMessages(shellMessages);
  const path = useLocation({ select: (location) => location.pathname });
  const activeChild = inSettings ? undefined : activeNavChild(path, item.children);
  const title = t(item.key);
  // A section without a page of its own (Content) opens its first sub-page: its title is a label, not a second link there.
  const ownPage = !item.children.some((child) => child.to === item.to);
  return (
    <div
      ref={ref}
      data-flyout-panel=""
      className={cn(
        // The tooltip's black, a step darker than the frame, so it stands apart where it covers
        // the navigation; positioned from the left in px (the navigation's side is measured).
        "fixed left-(--tip-x) top-(--tip-y) z-50 flex max-h-[calc(100dvh-1rem)] w-56 flex-col overflow-y-auto overscroll-contain rounded-xl bg-topbar p-1 text-sidebar-foreground shadow-popover",
        fresh && "motion-safe:animate-panel-in",
      )}
    >
      {ownPage ? null : (
        <p data-flyout-title="" aria-hidden className="flex h-11 shrink-0 items-center px-2 text-nav font-semibold md:h-7">
          {title}
        </p>
      )}
      <ul aria-label={title} className="flex flex-col gap-0.5">
        {ownPage ? (
          <li>
            <ShellLink
              data-flyout-title=""
              to={item.to}
              preload="intent"
              current={!inSettings && !activeChild && isSectionActive(path, item)}
              className={cn(NAV_ROW, "font-semibold")}
            >
              <span className="truncate">{title}</span>
              {item.badge === "inbox" ? <InboxNavBadge /> : null}
            </ShellLink>
          </li>
        ) : null}
        {item.children.map((child) => (
          <li key={child.to}>
            <ShellLink
              to={child.to}
              preload="intent"
              current={child === activeChild}
              className={cn(NAV_ROW, "text-sidebar-muted-foreground")}
            >
              {/* An app page's title is the app's own text (plain, never translated). */}
              <span className="truncate">{child.label ?? t(child.key)}</span>
              {child.badge === "reviews" ? <ReviewsNavBadge /> : null}
            </ShellLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
