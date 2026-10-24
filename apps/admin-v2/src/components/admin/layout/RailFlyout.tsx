import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "@tanstack/react-router";
import { cn } from "@scalius/shared/utils";
import { InboxNavBadge } from "~/components/admin/inbox/InboxNavBadge";
import { ReviewsNavBadge } from "~/components/admin/reviews/ReviewsNavBadge";
import { useMessages } from "~/i18n";
import { shellMessages } from "~/i18n/shell";
import { activeNavChild, isSectionActive, type VisibleNavItem } from "./AdminNav";
import { NAV_ROW } from "./nav-button";
import { ShellLink } from "./ShellLink";

/** Hover intent before the first flyout opens; later moves along the rail switch at once. */
const OPEN_DELAY = 120;
/** Grace for the pointer to cross from the rail into the flyout. */
const CLOSE_DELAY = 200;
/** How long a pointer heading into the flyout may cross other icons before they take over. */
const AIM_DELAY = 150;
/** The flyout's distance from the rail, and its least distance from the window's edges. */
const GAP = 4;
const EDGE = 8;

interface Open {
  key: string;
  icon: HTMLElement;
  /** Opened from nothing (it fades in), not switched from another section's flyout. */
  fresh: boolean;
}

interface Point {
  x: number;
  y: number;
}

const flyoutIcon = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-flyout]") : null);
const inPanel = (target: EventTarget | null) => target instanceof Element && target.closest("[data-flyout-panel]") !== null;
const keyboardFocus = (element: Element) => element.matches(":focus-visible");

/**
 * Shopify's flyouts on the collapsed rail: hovering (after a short intent
 * delay) or keyboard-focusing a section's icon shows its title and sub-pages
 * beside the rail, every row a link and the current page on the pill. The
 * pointer may travel diagonally into the flyout across other icons (it is
 * aimed at the flyout, as in Amazon's menus); leaving both closes it.
 * Arrow keys or Tab move into it, Escape returns to the icon. Touch never
 * opens one: a tap on an icon navigates.
 *
 * The flyout is portalled into the icon's own list item, so it follows the
 * icon in Tab order, and fixed beside the rail, since the frame clips.
 */
export default function RailFlyouts({ rail, nav, inSettings }: { rail: RefObject<HTMLElement | null>; nav: VisibleNavItem[]; inSettings: boolean }) {
  const [open, setOpen] = useState<Open | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rail.current;
    if (!root) return;
    let current: Open | null = null;
    // Escape closed this section's flyout: it stays closed until its icon is left.
    let dismissed: string | null = null;
    let hovered: Element | null = null;
    let timer = 0;
    const trail: Point[] = [];
    const rtl = () => getComputedStyle(root).direction === "rtl";

    const show = (icon: HTMLElement | null) => {
      if (icon === (current?.icon ?? null)) return;
      current = icon ? { key: icon.dataset.flyout ?? "", icon, fresh: current === null } : null;
      setOpen(current);
    };
    const wait = (ms: number, then: () => void) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(then, ms);
    };

    // Moving toward the flyout's near edge: the slopes to its top and bottom corners both widen.
    // (Pointerover fires before the pointermove at the same spot, so the event gives the newest point.)
    const aiming = (to: Point) => {
      const box = root.querySelector("[data-flyout-panel]")?.getBoundingClientRect();
      const from = trail[0];
      if (!box || !from || (from.x === to.x && from.y === to.y)) return false;
      const edge = rtl() ? box.right : box.left;
      const slope = (point: Point, y: number) => (y - point.y) / Math.max(1, Math.abs(edge - point.x));
      return slope(to, box.top) < slope(from, box.top) && slope(to, box.bottom) > slope(from, box.bottom);
    };
    // Where the pointer rests now decides (after an aimed crossing, or straight away).
    const settle = () => {
      if (inPanel(hovered)) return;
      const icon = flyoutIcon(hovered);
      show(icon && icon.dataset.flyout !== dismissed ? icon : null);
    };

    const onPointerMove = (event: PointerEvent) => {
      trail.push({ x: event.clientX, y: event.clientY });
      if (trail.length > 3) trail.shift();
    };
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hovered = event.target as Element;
      const icon = flyoutIcon(hovered);
      if (inPanel(hovered) || (icon && icon === current?.icon)) return window.clearTimeout(timer);
      if (icon?.dataset.flyout !== dismissed) dismissed = null;
      if (!current) {
        if (icon && !dismissed) wait(OPEN_DELAY, settle);
        else window.clearTimeout(timer);
      } else if (aiming({ x: event.clientX, y: event.clientY })) wait(AIM_DELAY, settle);
      // The gaps between icons keep it a moment, so moving along the rail goes from flyout to flyout.
      else if (!icon && !hovered.closest("a, button")) wait(CLOSE_DELAY, settle);
      else {
        window.clearTimeout(timer);
        settle();
      }
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hovered = null;
      dismissed = null;
      const focused = document.activeElement;
      // A keyboard user's flyout stays while focus is in it.
      if (focused && current?.icon.parentElement?.contains(focused) && keyboardFocus(focused)) return window.clearTimeout(timer);
      wait(CLOSE_DELAY, () => show(null));
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (inPanel(target)) return window.clearTimeout(timer);
      const icon = flyoutIcon(target);
      if (icon && keyboardFocus(target)) {
        window.clearTimeout(timer);
        if (icon.dataset.flyout !== dismissed) show(icon);
      } else if (!icon) show(null);
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      const item = current?.icon.parentElement;
      if (dismissed && !(next && flyoutIcon(next)?.dataset.flyout === dismissed)) dismissed = null;
      // Within the section, or onto another rail control (focusin decides), or the pointer still holds it.
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
      const icon = current.icon;
      if (event.key === "Escape" && (target === icon || index >= 0)) {
        dismissed = current.key;
        show(null);
        icon.focus();
      } else if (target === icon && (event.key === "ArrowDown" || event.key === inward)) links[0]?.focus();
      else if (index < 0) return;
      else if (event.key === outward || (event.key === "ArrowUp" && index === 0)) icon.focus();
      else if (event.key === "ArrowUp" || event.key === "ArrowDown") links[Math.min(links.length - 1, index + (event.key === "ArrowUp" ? -1 : 1))]?.focus();
      else if (event.key === "Home" || event.key === "End") links[event.key === "Home" ? 0 : links.length - 1]?.focus();
      else return;
      event.preventDefault();
    };

    const onClick = (event: MouseEvent) => {
      if (!current || !inPanel(event.target)) return;
      // Chosen: close. A keyboard choice keeps focus on the rail rather than on nothing (and the
      // flyout stays shut there); a pointer may come straight back to the icon and open it again.
      if (event.detail === 0) {
        dismissed = current.key;
        current.icon.focus({ preventScroll: true });
      }
      show(null);
    };
    // A tap anywhere, or a press outside the rail, closes it; so do scrolling the rail and resizing.
    const onPointerDown = (event: PointerEvent) => {
      if (current && (event.pointerType === "touch" || !root.contains(event.target as Node))) show(null);
    };
    const onScroll = (event: Event) => {
      if (!inPanel(event.target)) show(null);
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
  }, [rail]);

  const item = open ? nav.find((section) => section.key === open.key && section.children.length > 0) : undefined;
  const host = open?.icon.isConnected ? open.icon.parentElement : null;

  // Beside the rail (on its left in a right-to-left language), the title row level with the icon,
  // moved up as far as needed to stay on screen. Set before paint.
  useLayoutEffect(() => {
    const flyout = panel.current;
    const railBox = rail.current?.getBoundingClientRect();
    if (!open || !flyout || !railBox) return;
    const icon = open.icon.getBoundingClientRect();
    const title = flyout.querySelector<HTMLElement>("[data-flyout-title]");
    const titleCentre = title ? title.offsetTop + title.offsetHeight / 2 : 0;
    const x = getComputedStyle(flyout).direction === "rtl" ? railBox.left - GAP - flyout.offsetWidth : railBox.right + GAP;
    const y = Math.max(EDGE, Math.min(icon.top + icon.height / 2 - titleCentre, window.innerHeight - EDGE - flyout.offsetHeight));
    flyout.style.setProperty("--tip-x", `${x}px`);
    flyout.style.setProperty("--tip-y", `${y}px`);
  }, [open, rail, item]);

  if (!open || !item || !host) return null;
  return createPortal(<Flyout ref={panel} item={item} inSettings={inSettings} fresh={open.fresh} />, host);
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
        // the settings list; positioned from the left in px (the rail's side is measured).
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
