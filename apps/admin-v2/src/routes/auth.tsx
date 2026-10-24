/**
 * Sign-in layout: one card centred on the page background, the Scalius logo
 * inside it, the language switch below. Every /auth/* screen renders in the
 * card through <Outlet />.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ThemeProvider, useTheme } from "~/components/admin/layout/ThemeProvider";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { LOCALES, setLocale, useLocale, useMessages } from "~/i18n";
import { authMessages } from "~/i18n/auth";
// The logo URLs are host-root; the dashboard's path prefix is a runtime setting.
import { withDashboardBasePath } from "~/lib/dashboard-base-path";

// The wordmark trimmed of its padding, drawn at 3x (282x72 and 291x72) and shown
// 24px tall: black letters on the light card, white on the dark one. They live in
// public/ (the README shows logo-dark.png), so no script module carries them.
const LOGO = { light: { src: "/logo-light.png", width: 97 }, dark: { src: "/logo-dark.png", width: 94 } };

export const Route = createFileRoute("/auth")({
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <ThemeProvider>
      <AuthFrame />
    </ThemeProvider>
  );
}

function AuthFrame() {
  const t = useMessages(authMessages);
  const locale = useLocale();
  const { theme } = useTheme();
  const logo = LOGO[theme];
  return (
    // Top-anchored rather than centred, so a message appearing in the card never moves its heading.
    <main className="flex min-h-dvh flex-col items-center bg-background px-4 py-10">
      <div className="w-full max-w-md sm:mt-[12vh]">
        <Card className="flex flex-col gap-6 p-6 sm:p-8">
          {/* Trimmed, so its first letter sits on the card's text edge, level with the heading. */}
          <img src={withDashboardBasePath(logo.src)} alt="Scalius" width={logo.width} height={24} className="self-start" />
          <Outlet />
        </Card>
        <nav aria-label={t("language")} className="mt-4 flex justify-center gap-1">
          {LOCALES.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              size="sm"
              lang={option.value}
              aria-pressed={locale === option.value}
              onClick={() => setLocale(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </nav>
      </div>
    </main>
  );
}
