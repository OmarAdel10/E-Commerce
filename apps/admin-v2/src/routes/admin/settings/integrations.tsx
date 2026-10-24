import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AiAccessCard } from "~/components/admin/agent-access/AiAccessCard";
import { AiDraftingCard } from "~/components/admin/agent-access/AiDraftingCard";
import { AppKindCard } from "~/components/admin/settings/AppKindCard";
import { FraudCheckCard, ScannerCard, TrackingCard } from "~/components/admin/settings/AppsSettings";
import { SettingsCardLoading, SettingsPage, SettingsSubPages } from "~/components/admin/settings/SettingsPage";
import { trackingHealthQuery, trackingSettingsQuery } from "~/components/admin/settings/tracking-settings";
import { useTrackingStatus } from "~/components/admin/settings/tracking-status";
import { settingsHead, settingsPartSearch } from "~/components/admin/settings/settings-nav";
import { settingsPartOf } from "~/components/admin/settings/settings-cards";
import { usePermissions } from "~/contexts/PermissionContext";
import { translate, useMessages } from "~/i18n";
import { titleHead } from "~/i18n/page-titles";
import { settingsPrivacyMessages } from "~/i18n/settings-privacy";
import { settingsSubPageMessages, settingsSubPageSummaryMessages } from "~/i18n/settings-sub-pages";
import { ADMIN_PERMISSIONS } from "~/lib/admin-permissions";
import { fraudCheckerProvidersQueryOptions } from "~/lib/api-query-options/fraud-checker";
import { aiAccessQuery, appProvidersQuery, metaQuery, trackingQuery } from "~/lib/api-query-options/settings-screens";
import { RouteErrorComponent } from "~/lib/route-error";

// Integrations: three parts that serve different jobs (tracking and ads,
// order tools, AI and apps), each its own page at `?part=`
// (audit/settings-ux/NAVIGATION-DECISION.md). Without a part, the page lists
// them with their state. One route for all four, so the always-loaded route
// tree and its preload map stay as they were.
export const Route = createFileRoute("/admin/settings/integrations")({
  validateSearch: settingsPartSearch,
  loaderDeps: ({ search }) => ({ part: search.part }),
  // Cards hide themselves for roles that can't view them; a refused read is fine here.
  loader: async ({ context: { queryClient }, deps }) => {
    const part = settingsPartOf("integrations", deps.part)?.key;
    const reads = {
      tracking: () => [queryClient.ensureQueryData(trackingHealthQuery)],
      orderTools: () => [queryClient.ensureQueryData(appProvidersQuery("courier_history"))],
      aiApps: () => [queryClient.ensureQueryData(appProvidersQuery("ai"))],
    };
    await Promise.allSettled([
      // What the list summarises, and what the parts read first.
      queryClient.ensureQueryData(trackingQuery),
      queryClient.ensureQueryData(metaQuery),
      queryClient.ensureQueryData(trackingSettingsQuery),
      queryClient.ensureQueryData(fraudCheckerProvidersQueryOptions()),
      queryClient.ensureQueryData(aiAccessQuery),
      queryClient.ensureQueryData(appProvidersQuery("search")),
      ...(part ? reads[part as keyof typeof reads]() : []),
    ]);
    return { title: part ? translate(settingsSubPageMessages, part) : null };
  },
  head: ({ loaderData }) => (loaderData?.title ? titleHead(loaderData.title) : settingsHead("integrations")),
  errorComponent: RouteErrorComponent,
  component: IntegrationsPage,
});

// The destination cards load after the page's own code.
const TrackingDestinationCards = lazy(() => import("~/components/admin/settings/TrackingDestinations"));

function IntegrationsPage() {
  const { part } = Route.useSearch();
  const { hasPermission } = usePermissions();
  const can = (...permissions: string[]) => permissions.some(hasPermission);
  const key = settingsPartOf("integrations", part)?.key;
  if (key === "tracking") {
    return (
      <SettingsPage page="integrations" subPage="tracking" readOnly={!can(ADMIN_PERMISSIONS.ANALYTICS_CREATE, ADMIN_PERMISSIONS.ANALYTICS_EDIT, ADMIN_PERMISSIONS.ANALYTICS_TOGGLE)}>
        <Suspense fallback={<SettingsCardLoading />}>
          <TrackingDestinationCards />
        </Suspense>
        <TrackingCard />
      </SettingsPage>
    );
  }
  if (key === "orderTools") {
    return (
      <SettingsPage page="integrations" subPage="orderTools" readOnly={!can(ADMIN_PERMISSIONS.SETTINGS_FRAUD_CHECKER_EDIT, ADMIN_PERMISSIONS.PRODUCTS_EDIT)}>
        <FraudCheckCard />
        <ScannerCard />
      </SettingsPage>
    );
  }
  if (key === "aiApps") {
    return (
      <SettingsPage page="integrations" subPage="aiApps" readOnly={!can(ADMIN_PERMISSIONS.AGENT_ACCESS_MANAGE, ADMIN_PERMISSIONS.PRODUCTS_EDIT)}>
        <AiAccessCard />
        <AiDraftingCard />
        <AppKindCard kind="search" />
      </SettingsPage>
    );
  }
  return <IntegrationsList />;
}

const DESTINATIONS = ["ga4", "meta", "tiktok"] as const;

/** The three parts, each with its state in one line. */
function IntegrationsList() {
  const t = useMessages(settingsSubPageSummaryMessages);
  const privacy = useMessages(settingsPrivacyMessages);
  const { hasPermission } = usePermissions();
  const { destinations } = useTrackingStatus();
  const fraud = useQuery({ ...fraudCheckerProvidersQueryOptions(), enabled: hasPermission(ADMIN_PERMISSIONS.SETTINGS_FRAUD_CHECKER_VIEW) });
  const ai = useQuery({ ...aiAccessQuery, enabled: hasPermission(ADMIN_PERMISSIONS.AGENT_ACCESS_MANAGE) });
  const search = useQuery(appProvidersQuery("search"));
  const tracking = hasPermission(ADMIN_PERMISSIONS.ANALYTICS_VIEW) && DESTINATIONS.every((destination) => destinations[destination].status)
    ? DESTINATIONS.map((destination) =>
        t("destination", { name: privacy(`short.${destination}`), status: privacy(`overall.${destinations[destination].status!}`) }),
      ).join(" · ")
    : null;
  const fraudLine = fraud.data ? t(fraud.data.some((provider) => provider.isActive) ? "fraudOn" : "fraudOff") : null;
  const searchApp = search.data?.find((provider) => provider.readiness.usable);
  const aiLine = [
    ai.data ? t("aiConnections", { count: ai.data.total }) : null,
    search.data ? (searchApp ? t("searchApp", { name: searchApp.appName }) : t("searchBuiltIn")) : null,
  ].filter(Boolean).join(" · ");
  return (
    <SettingsPage page="integrations">
      <SettingsSubPages
        page="integrations"
        states={{
          tracking,
          orderTools: [fraudLine, t("scanner")].filter(Boolean).join(" · "),
          aiApps: aiLine || null,
        }}
      />
    </SettingsPage>
  );
}
