/**
 * Hover intent from the pointer's own motion, not a fixed delay: the
 * navigation opens a section's flyout the moment the pointer comes to rest
 * over it, so a deliberate hover feels instant and a sweep across the list
 * opens nothing. Pure, so its rules are tested on synthetic traces.
 */

export interface PointerSample {
  x: number;
  y: number;
  /** When it was seen, ms (`performance.now()`). */
  t: number;
}

/** Slower than this (px/ms) over the last WINDOW_MS is a pointer settling on its target. */
export const REST_SPEED = 0.15;
/** No movement for this long (two frames) is a pointer at rest. */
export const REST_MS = 32;
/** The span of motion the speed is read over: a few frames, so one jittery event does not decide. */
const WINDOW_MS = 48;
/** Samples kept: enough for WINDOW_MS at any event rate. */
const KEEP = 8;

/** Adds a sample, keeping only the recent ones. */
export function record(trail: PointerSample[], sample: PointerSample): void {
  // Pointerover and pointermove report the same moment: keep one.
  if (trail[trail.length - 1]?.t === sample.t) trail.pop();
  trail.push(sample);
  if (trail.length > KEEP) trail.shift();
}

/**
 * Whether the pointer is at rest at `now`: still for REST_MS, or moving
 * slower than REST_SPEED over the last WINDOW_MS. One sample alone is not
 * yet a speed; the caller checks again REST_MS later (`restCheckIn`).
 */
export function atRest(trail: readonly PointerSample[], now: number): boolean {
  const last = trail[trail.length - 1];
  if (!last) return false;
  if (now - last.t >= REST_MS) return true;
  const from = trail.find((sample) => sample.t >= last.t - WINDOW_MS && sample !== last);
  if (!from || last.t - from.t <= 0) return false;
  return Math.hypot(last.x - from.x, last.y - from.y) / (last.t - from.t) < REST_SPEED;
}

/** When to look again if the pointer is still moving: the moment it will have been still for REST_MS. */
export function restCheckIn(trail: readonly PointerSample[], now: number): number {
  const last = trail[trail.length - 1];
  return Math.max(0, (last ? last.t : now) + REST_MS - now);
}
