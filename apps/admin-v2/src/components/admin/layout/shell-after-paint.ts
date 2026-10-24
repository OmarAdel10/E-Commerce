// What the dashboard shell starts once its first page is up: loaded by the
// layout after the first render, so none of it is on the first download.
import { watchOverlaysForBack } from "@/components/ui/back-closes";
import { followAccountLocale } from "~/lib/account-language";
import type { RouterHistory } from "@tanstack/react-router";

export function startAfterPaint(history: RouterHistory): void {
  // Back (the browser's, Android's gesture) closes an open dialog, sheet, search palette or the navigation drawer.
  watchOverlaysForBack(history);
  // The language this staff member chose follows them to this browser.
  void followAccountLocale();
}
