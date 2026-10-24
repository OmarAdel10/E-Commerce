import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { useMessages } from "~/i18n";
import { helpMessages } from "~/i18n/help";
import { HELP_LINKS } from "~/lib/help-links";

/** The marker on a link that leaves the dashboard, read out as "opens in a new tab". */
function Outside({ children }: { children: ReactNode }) {
  const t = useMessages(helpMessages);
  return (
    <>
      <span className="flex-1">{children}</span>
      <ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{t("opensInNewTab")}</span>
    </>
  );
}

/**
 * Where to ask and report, then the keyboard shortcuts (only on a device with
 * a mouse or trackpad: `data-keyboard-only`). Both links leave the dashboard,
 * so they say where they go and carry the external-link icon (there is no help
 * site of our own to link yet). The help menu shows them, and so does the
 * store menu on phones, where the top bar has no room for Help.
 */
export function HelpItems({ onShortcuts }: { onShortcuts: () => void }) {
  const t = useMessages(helpMessages);
  return (
    <>
      <DropdownMenuItem asChild>
        <a href={HELP_LINKS.questions} target="_blank" rel="noopener noreferrer"><Outside>{t("questions")}</Outside></a>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <a href={HELP_LINKS.problem} target="_blank" rel="noopener noreferrer"><Outside>{t("problem")}</Outside></a>
      </DropdownMenuItem>
      <DropdownMenuItem data-keyboard-only="" onSelect={onShortcuts} aria-keyshortcuts="?">{t("shortcuts")}</DropdownMenuItem>
    </>
  );
}

/** Shopify's help menu. Loads when the help button is first used, off the shell's first download. */
export default function HelpMenu({ open, onOpenChange, trigger, onShortcuts }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  onShortcuts: () => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <HelpItems onShortcuts={onShortcuts} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
