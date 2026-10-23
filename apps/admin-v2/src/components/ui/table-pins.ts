/**
 * The checkbox column's width, and so where a pinned title column after it
 * sticks (`--pinned-select` in `table.tsx`). One number for both: the column
 * is held at exactly this width (never its narrower content width, which an
 * overflowing auto table shrinks it to), so the title never slides over its
 * neighbour. Its own module, so column code reads it without the table.
 */
export const PINNED_SELECT_WIDTH = 40;
