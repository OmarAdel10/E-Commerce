import { createFileRoute, redirect } from "@tanstack/react-router";
import { TwoFactorForm } from "~/components/auth/TwoFactorForm";
import { dashboardSignInDestination, readDashboardSession } from "~/lib/auth-guards";
import { pageHead } from "~/i18n/page-titles";

export const Route = createFileRoute("/auth/two-factor")({
  beforeLoad: async () => {
    // Without a session, Better Auth's pending-2FA cookie carries the sign-in.
    const { session } = await readDashboardSession();
    if (session) {
      const destination = dashboardSignInDestination(session);
      if (destination !== "/auth/two-factor") throw redirect({ to: destination });
    }
  },
  head: () => pageHead("twoFactor"),
  component: TwoFactorForm,
});
