import markSvg from "@/assets/mark.svg?no-inline";
import wordmark1x from "@/assets/wordmark-dark-1x.png?no-inline";
import wordmark2x from "@/assets/wordmark-dark-2x.png?no-inline";
import wordmark3x from "@/assets/wordmark-dark-3x.png?no-inline";
// Bundled asset URLs are host-root; the dashboard's path prefix is a runtime setting.
import { withDashboardBasePath } from "~/lib/dashboard-base-path";

/**
 * The Scalius arrow at 20px: a 0.5 KB vector traced from the 512px app icon
 * (the PNG it replaces was 38 KB), crisp at any pixel density. A file, not
 * inline markup, so it costs every page's script nothing.
 */
export function Mark() {
  return <img src={withDashboardBasePath(markSvg)} alt="" width={20} height={20} draggable={false} />;
}

/**
 * The full wordmark (white letters, green arrow) for the expanded panel. The
 * navigation frame is near-black in both themes, so this one file serves both.
 * One file per pixel density, each drawn at its exact size (trimmed of the
 * source's padding), so the letters stay sharp at 1x, 2x and 3x. Sign-in
 * draws its own (`routes/auth.tsx`), so neither page ships the other's.
 */
export function Wordmark() {
  return (
    <img
      src={withDashboardBasePath(wordmark1x)}
      srcSet={`${withDashboardBasePath(wordmark2x)} 2x, ${withDashboardBasePath(wordmark3x)} 3x`}
      alt=""
      width={94}
      height={24}
      draggable={false}
    />
  );
}
