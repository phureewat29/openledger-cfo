"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Blocks,
  Inbox,
  MessageSquare,
  Repeat,
  Target,
  Wallet,
} from "lucide-react";

import type { RailBadges } from "~/server/chrome";
import { useChatDock } from "~/components/chat/dock";
import { useIngestRun } from "~/components/ingest-run-provider";
import { OlLogo } from "~/components/logo";
import { isRunLive } from "~/domain/ingest-run";

interface Entry {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly exact?: boolean;
  /** Dimmed on the rail: the page only teases what the section will be. */
  readonly soon?: boolean;
}

/** The whole picture first, then holdings, then intentions, then the machine-facing screen. */
const ENTRIES: readonly Entry[] = [
  {
    href: "/",
    label: "Everything — your money vital",
    icon: Activity,
    exact: true,
  },
  {
    href: "/accounts",
    label: "Accounts — every transactions and balances",
    icon: Wallet,
  },
  { href: "/plan", label: "Plan — budgets, goals, reminders", icon: Target },
  { href: "/ingest", label: "Ingest — turn statements to ledger", icon: Inbox },
  {
    href: "/loop",
    label: "Loop — money optimizer, soon",
    icon: Repeat,
    soon: true,
  },
  {
    href: "/marketplace",
    label: "Marketplace — plugins for your money, soon",
    icon: Blocks,
    soon: true,
  },
];

const BADGE: Record<string, keyof RailBadges> = {
  "/": "monitor",
  "/ingest": "ingest",
};

function RailTip({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`group relative flex ${className ?? ""}`}>
      {children}
      <span
        role="tooltip"
        className="border-border bg-card pointer-events-none absolute top-1/2 left-full z-50 ml-2 -translate-y-1/2 rounded-md border px-2 py-1 text-[11px] whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

const TARGET =
  "text-muted-foreground hover:bg-secondary hover:text-foreground relative grid size-10 cursor-pointer place-items-center rounded-md transition-colors data-[active=true]:bg-secondary data-[active=true]:text-accent";

export function Rail({
  badges,
  ledgerBad,
}: {
  badges: RailBadges;
  ledgerBad: boolean;
}) {
  const pathname = usePathname();
  const dock = useChatDock();
  const { run } = useIngestRun();
  // Somewhere to come back to: the queue keeps moving while the operator reads
  // another page, and this is the only thing that says so from over there.
  const ingesting = run !== null && isRunLive(run.status);

  // Tooltips are absolutely positioned past the right edge; any overflow rule
  // here clips them, and CSS cannot scroll one axis while leaving the other visible.
  return (
    <nav
      aria-label="Sections"
      className="border-border bg-card flex w-14 shrink-0 flex-col items-center gap-1 border-r pt-3 pb-4"
    >
      <RailTip label="OpenLedger CFO">
        <span
          aria-label="OpenLedger CFO"
          className="border-border text-accent mb-2 grid size-8 place-items-center rounded-md border"
        >
          <OlLogo size={16} />
        </span>
      </RailTip>

      {ENTRIES.map((entry) => {
        const active = entry.exact
          ? pathname === entry.href
          : pathname.startsWith(entry.href);
        const slot = BADGE[entry.href];
        const badge = slot === undefined ? 0 : badges[slot];
        const Icon = entry.icon;

        return (
          <RailTip key={entry.href} label={entry.label}>
            <Link
              href={entry.href}
              data-active={active}
              aria-label={entry.label}
              aria-current={active ? "page" : undefined}
              className={
                entry.soon
                  ? `${TARGET} opacity-45 hover:opacity-100 data-[active=true]:opacity-100`
                  : TARGET
              }
            >
              {active ? (
                <span
                  aria-hidden
                  className="bg-accent absolute -left-2 h-5 w-0.5 rounded-full"
                />
              ) : null}
              <Icon size={17} strokeWidth={1.75} />
              {ingesting && entry.href === "/ingest" ? (
                <span
                  role="status"
                  aria-label="Ingest running"
                  className="bg-accent absolute -right-0.5 -bottom-0.5 size-1.5 animate-pulse rounded-full"
                />
              ) : null}
              {badge > 0 ? (
                <span className="bg-accent text-accent-foreground absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-[10px] leading-4 tabular-nums">
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </Link>
          </RailTip>
        );
      })}

      <div className="flex-1" />

      <RailTip label="Chat" className="lg:hidden">
        <button
          type="button"
          aria-label="Chat"
          aria-expanded={dock.open}
          onClick={() => dock.setOpen(!dock.open)}
          className={TARGET}
        >
          <MessageSquare size={17} strokeWidth={1.75} />
        </button>
      </RailTip>

      {ledgerBad ? (
        <span
          role="status"
          aria-label="Ledger stale"
          className="bg-destructive mt-2 size-1.5 rounded-full"
        />
      ) : null}
    </nav>
  );
}
