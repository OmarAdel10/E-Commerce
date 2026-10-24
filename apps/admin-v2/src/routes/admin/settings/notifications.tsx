import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CustomerNotificationsCard,
  SendingCard,
  StaffNotificationsCard,
  WebPushAddressNotice,
} from "~/components/admin/settings/NotificationSettings";
import { AppKindCard } from "~/components/admin/settings/AppKindCard";
import { BrowserNotificationsCard } from "~/components/admin/settings/BrowserNotificationsCard";
import { notificationsSummary } from "~/components/admin/settings/notification-channel-policy";
import { SettingsPage, SettingsSubPages } from "~/components/admin/settings/SettingsPage";
import { settingsHead, settingsPartSearch } from "~/components/admin/settings/settings-nav";
import { settingsPartOf } from "~/components/admin/settings/settings-cards";
import { useHasPermission } from "~/contexts/PermissionContext";
import { translate, useMessages } from "~/i18n";
import { titleHead } from "~/i18n/page-titles";
import { notificationsMessages } from "~/i18n/settings-notifications";
import { settingsSubPageMessages, settingsSubPageSummaryMessages } from "~/i18n/settings-sub-pages";
import { ADMIN_PERMISSIONS } from "~/lib/admin-permissions";
import { appProvidersQuery, customerRulesQuery, emailQuery, smsQuery } from "~/lib/api-query-options/settings-screens";
import { RouteErrorComponent } from "~/lib/route-error";
import { webPushQuery } from "~/lib/web-push";

// Notifications: messages to customers, alerts to staff, and the senders both
// use, each its own page at `?part=` as in Shopify
// (audit/settings-ux/NAVIGATION-DECISION.md). Without a part, the page lists
// them with their state.
export const Route = createFileRoute("/admin/settings/notifications")({
  validateSearch: settingsPartSearch,
  loaderDeps: ({ search }) => ({ part: search.part }),
  loader: async ({ context: { queryClient }, deps }) => {
    const part = settingsPartOf("notifications", deps.part)?.key;
    await Promise.allSettled([
      queryClient.ensureQueryData(customerRulesQuery),
      ...(part === "customerMessages" ? [queryClient.ensureQueryData(appProvidersQuery("push"))] : []),
      // "Notifications on this device": this staff member's devices.
      ...(part === "staffAlerts" ? [queryClient.ensureQueryData(webPushQuery)] : []),
      ...(part === "sending"
        ? [queryClient.ensureQueryData(emailQuery), queryClient.ensureQueryData(smsQuery), queryClient.ensureQueryData(appProvidersQuery("messaging"))]
        : []),
    ]);
    return { title: part ? translate(settingsSubPageMessages, part) : null };
  },
  head: ({ loaderData }) => (loaderData?.title ? titleHead(loaderData.title) : settingsHead("notifications")),
  errorComponent: RouteErrorComponent,
  component: NotificationsPage,
});

function NotificationsPage() {
  const { part } = Route.useSearch();
  const canEdit = useHasPermission(ADMIN_PERMISSIONS.SETTINGS_NOTIFICATIONS_EDIT);
  const key = settingsPartOf("notifications", part)?.key;
  if (key === "customerMessages") {
    return (
      <SettingsPage page="notifications" subPage="customerMessages" readOnly={!canEdit}>
        <WebPushAddressNotice />
        <CustomerNotificationsCard />
        <BrowserNotificationsCard />
      </SettingsPage>
    );
  }
  if (key === "staffAlerts") {
    return (
      <SettingsPage page="notifications" subPage="staffAlerts" readOnly={!canEdit}>
        <WebPushAddressNotice />
        <StaffNotificationsCard />
      </SettingsPage>
    );
  }
  if (key === "sending") {
    return (
      <SettingsPage page="notifications" subPage="sending" readOnly={!canEdit}>
        <SendingCard />
        <AppKindCard kind="messaging" />
      </SettingsPage>
    );
  }
  return <NotificationsList />;
}

/** The three parts, each with its state in one line. */
function NotificationsList() {
  const t = useMessages(settingsSubPageSummaryMessages);
  const n = useMessages(notificationsMessages);
  const rules = useQuery(customerRulesQuery).data;
  const summary = rules ? notificationsSummary(rules) : null;
  const sender = (channel: "email" | "sms" | "whatsapp") =>
    t("channel", { channel: n(channel), state: n(summary!.senders[channel] ? "ready" : "notSetUp") });
  return (
    <SettingsPage page="notifications">
      <WebPushAddressNotice />
      <SettingsSubPages
        page="notifications"
        states={summary ? {
          customerMessages: t("customerMessages", { on: summary.customerOn, total: summary.customerTotal }),
          staffAlerts: `${t("staffAlerts", { on: summary.staffOn, total: summary.staffTotal })} · ${t("orderEmails", { count: summary.orderEmails })}`,
          sending: [sender("email"), sender("sms"), sender("whatsapp")].join(" · "),
        } : {}}
      />
    </SettingsPage>
  );
}
