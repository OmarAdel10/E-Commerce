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
 * The current section: of the rendered ones whose top has passed the
 * boundary (the bar's bottom edge plus a little), the one that starts
 * lowest. At the end of the page every section already on screen counts as
 * passed, so a short last section can still be current. Before any has
 * passed, the first section of the page is current.
 */
export function currentSection(
  sections: readonly SectionPlacement[],
  view: { boundary: number; height: number; atEnd: boolean },
): string | null {
  const shown = sections.filter((section) => section.rendered);
  if (shown.length === 0) return null;
  const reached = (section: SectionPlacement) => section.top <= view.boundary || (view.atEnd && section.top < view.height);
  let current: SectionPlacement | null = null;
  for (const section of shown) {
    if (reached(section) && (!current || section.top > current.top)) current = section;
  }
  if (current) return current.id;
  return shown.reduce((first, section) => (section.top < first.top ? section : first)).id;
}
