import { createFileRoute } from "@tanstack/react-router";
import { ThemeEditorPage } from "~/components/admin/online-store/theme-editor/ThemeEditor";
import { themeWorkspaceQueryOptions } from "~/lib/api-query-options/online-store";
import { RouteErrorComponent } from "~/lib/route-error";
import { pageHead } from "~/i18n/page-titles";
import { loadEditorRecord } from "~/lib/route-query-warming";

// The theme editor takes the whole window (the admin frame steps aside for
// it); its code loads only when a merchant opens it.
export const Route = createFileRoute("/admin/online-store/theme_/editor")({
  // Fresh on open: a cached draft another tab saved over would make the first save a conflict.
  loader: ({ context: { queryClient } }) => loadEditorRecord(queryClient, themeWorkspaceQueryOptions()),
  head: () => pageHead("themeEditor"),
  component: ThemeEditorPage,
  errorComponent: RouteErrorComponent,
});
