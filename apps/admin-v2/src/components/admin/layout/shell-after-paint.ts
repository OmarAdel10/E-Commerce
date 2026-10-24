// What the dashboard shell starts once its first page is up: loaded by the
// layout after the first render, so none of it is on the first download.
import { watchOverlaysForBack } from "@/components/ui/back-closes";

export function startAfterPaint(): void {
  // Back (the browser's, Android's gesture) closes an open dialog, sheet, search palette or the navigation drawer.
  watchOverlaysForBack();
}
