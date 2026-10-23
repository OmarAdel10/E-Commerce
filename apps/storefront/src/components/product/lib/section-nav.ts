// Which product section the reader is in, for the anchor bar
// (ProductSectionNav.astro). Decided by where the sections are on screen,
// never by the bar's link order: a skin or template may place Reviews above
// Details, or Similar below Reviews, while the bar keeps its own order.

export interface SectionPlacement {
  id: string;
  /** The section's top edge in viewport pixels. */
  top: number;
  /** False for a section that is not laid out (display: none, a closed tab's panel). */
  rendered: boolean;
}

/**
 * Where a followed section link lands a section, plus a little: the page's
 * scroll padding (header, bar and gap) or the bar's pinned bottom edge. Read
 * from styles, never from the bar's current place, which is far down the
 * page until it pins.
 */
export function sectionLandingLine(styles: { scrollPaddingTop: string; barTop: string; barHeight: number }): number {
  const padding = Number.parseFloat(styles.scrollPaddingTop);
  const pinned = (Number.parseFloat(styles.barTop) || 0) + styles.barHeight;
  return Math.max(Number.isFinite(padding) ? padding : 0, pinned) + 16;
}

/**
 * The current section: of the rendered ones whose top has passed the
 * boundary (where a followed link lands it, under the pinned header and
 * bar, plus a little), the one that starts
 * lowest. At the end of the page every section already on screen counts as
 * passed, so a short last section can still be current. Before any has
 * passed (the product itself is on screen), none is.
 */
export function currentSection(
  sections: readonly SectionPlacement[],
  view: { boundary: number; height: number; atEnd: boolean },
): string | null {
  const shown = sections.filter((section) => section.rendered);
  const reached = (section: SectionPlacement) => section.top <= view.boundary || (view.atEnd && section.top < view.height);
  let current: SectionPlacement | null = null;
  for (const section of shown) {
    if (reached(section) && (!current || section.top > current.top)) current = section;
  }
  return current?.id ?? null;
}
