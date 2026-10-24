import { trimTrailingCharacter } from "@scalius/shared/text-scan";
import { useBlocker } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { dispatchAdminNavigationCancelled } from "./admin-navigation-events";
import { useMessages } from "~/i18n";
import { saveBarMessages } from "~/i18n/save-bar";

/** Where a navigation starts or ends, as the guard sees it. */
export interface GuardedLocation {
  pathname: string;
  search: unknown;
}

interface UnsavedChangesGuardProps {
  isDirty: boolean;
  isSubmitting: boolean;
  allowSamePathStateNavigation?: boolean;
  /**
   * A navigation the page knows keeps its draft on screen (a workspace's list
   * paging or search): it passes without asking. Every other one asks.
   */
  keepsDraft?: (current: GuardedLocation, next: GuardedLocation) => boolean;
}

/**
 * Renders an AlertDialog when the user tries to navigate away from a dirty form.
 * Also enables the browser's native "beforeunload" dialog for tab close / refresh.
 *
 * Usage:
 * ```tsx
 * <UnsavedChangesGuard
 *   isDirty={form.formState.isDirty}
 *   isSubmitting={isSubmitting}
 * />
 * ```
 */
export function UnsavedChangesGuard({
  isDirty,
  isSubmitting,
  allowSamePathStateNavigation = false,
  keepsDraft,
}: UnsavedChangesGuardProps) {
  const t = useMessages(saveBarMessages);
  const { proceed, reset, status } = useBlocker({
    shouldBlockFn: ({ current, next }) => {
      if (!isDirty || isSubmitting) return false;
      if (keepsDraft?.(current, next)) return false;

      // Some editors keep non-sensitive workspace state in the query string.
      // Moving between those states does not leave the form or discard it, so
      // the global leave-page guard must not intercept that navigation.
      if (
        allowSamePathStateNavigation &&
        trimTrailingCharacter(current.pathname, "/") ===
          trimTrailingCharacter(next.pathname, "/")
      ) {
        return false;
      }

      return true;
    },
    withResolver: true,
    enableBeforeUnload: isDirty && !isSubmitting,
  });

  useEffect(() => {
    if (status === "blocked" && !isDirty && !isSubmitting) {
      reset?.();
      dispatchAdminNavigationCancelled();
    }
  }, [isDirty, isSubmitting, reset, status]);

  function keepEditing() {
    reset?.();
    dispatchAdminNavigationCancelled();
  }

  return (
    <AlertDialog
      open={status === "blocked"}
      onOpenChange={(open) => {
        if (!open) reset?.();
      }}
    >
      {/* The save bar shakes and flashes while this shows (global.css). */}
      <AlertDialogContent data-leave-guard="">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("leaveTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("leaveDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={keepEditing}>{t("stay")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={proceed}
            variant="destructive"
          >
            {t("leavePage")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
