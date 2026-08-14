"use client";

import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { partition } from "es-toolkit";
import { Bell, CreditCard, Landmark, Repeat } from "lucide-react";

import { cn } from "@openledger-fleet/ui";
import { Pane } from "@openledger-fleet/ui/pane";

import type { ActionQueue } from "~/domain/action";
import type { Insight, Severity } from "~/domain/insights/types";
import type { UpcomingItem, UpcomingSource } from "~/domain/upcoming";
import { RemoveButton } from "~/components/plan/remove-button";
import { accountLabel, formatDayMonth, formatThb } from "~/domain/format";
import { SOURCE_LABEL } from "~/domain/upcoming";
import { useTRPC } from "~/trpc/react";

/**
 * Severity is carried by one hairline and the title colour, nothing else.
 * Left side only: the rows sit in a divide-y list, and an all-side border
 * colour would repaint the divider beside a critical flag red.
 */
const TONE: Record<Severity, string> = {
  crit: "border-l-destructive",
  warn: "border-l-border",
  info: "border-l-transparent",
};

/**
 * Which list an item came from, as a glyph. The word costs a column the title
 * needs more, and the label is still what the mark is announced as.
 */
const SOURCE_ICON: Record<UpcomingSource, LucideIcon> = {
  card: CreditCard,
  loan: Landmark,
  subscription: Repeat,
  manual: Bell,
};

/** Six dated rows and five flags is what the pane's slot holds without scrolling. */
const MAX_DUE = 6;
const MAX_FLAGS = 5;

const ROW = "flex h-7 items-center gap-2 px-3 text-[11px]";

/** Subscription rows carry a second line naming the category they file under. */
const rowShell = (filedUnder: string | undefined) =>
  filedUnder === undefined ? ROW : "block h-10 px-3 py-0.5 text-[11px]";

function SourceMark({ source }: { source: UpcomingSource }) {
  const Icon = SOURCE_ICON[source];
  return (
    <Icon
      size={12}
      strokeWidth={1.75}
      role="img"
      aria-label={SOURCE_LABEL[source]}
      className="text-muted-foreground shrink-0"
    />
  );
}

function DueRow({ item }: { item: UpcomingItem }) {
  const overdue = item.overdue === true;
  const accountId = item.accountId;
  /**
   * A subscription row names its merchant, but the ledger files it under a
   * category, so the row says where following it actually lands. One line
   * cannot seat both at every pane width, so the category takes a second line.
   */
  const filedUnder =
    item.source === "subscription" && accountId !== undefined
      ? accountLabel(accountId)
      : undefined;
  const label =
    filedUnder === undefined ? item.title : `${item.title} — ${filedUnder}`;

  const body = (
    <>
      <span
        className={cn(
          "flex w-full min-w-0 items-center gap-2",
          filedUnder === undefined ? "h-7" : "h-5",
        )}
      >
        <span
          className={cn(
            "w-11 shrink-0 tabular-nums",
            overdue ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {formatDayMonth(item.date)}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            overdue && "text-destructive",
          )}
          title={label}
        >
          {item.title}
        </span>
        {/* Sized to its own digits: every row's figure still ends on the same
            gridline, because the title beside it is what absorbs the slack. */}
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          {item.amount === undefined ? "—" : formatThb(item.amount)}
        </span>
        <SourceMark source={item.source} />
      </span>
      {filedUnder === undefined ? null : (
        <span className="text-muted-foreground block h-4 truncate pl-[3.25rem] text-[10px] uppercase">
          {filedUnder}
        </span>
      )}
    </>
  );

  if (accountId === undefined) {
    return <li className={rowShell(filedUnder)}>{body}</li>;
  }
  return (
    <li>
      <Link
        href={`/accounts/${encodeURIComponent(accountId)}`}
        className={cn(rowShell(filedUnder), "hover:bg-secondary/60")}
        title={label}
      >
        {body}
      </Link>
    </li>
  );
}

function FlagRow({
  insight,
  pending,
  onDismiss,
}: {
  insight: Insight;
  pending: boolean;
  onDismiss: (insightId: string) => void;
}) {
  const figure = insight.figures[0];

  return (
    <li className={cn("group border-l-2 px-3 py-1.5", TONE[insight.severity])}>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            insight.severity === "crit" && "text-destructive",
          )}
          title={insight.title}
        >
          {insight.title}
        </span>
        {figure ? (
          <span className="shrink-0 text-[11px] tabular-nums">
            {figure.value}
          </span>
        ) : null}
        {/* In flow, costing the title its width: the absolute button it
            replaced painted over the figure on hover. */}
        <RemoveButton
          label={`Dismiss ${insight.title}`}
          disabled={pending}
          onClick={() => onDismiss(insight.id)}
        />
      </div>
      {/* What to do about the flag is the whole point of raising it, so it gets
          the lines it takes rather than an ellipsis on the first verb. */}
      <p
        className="text-muted-foreground line-clamp-3 text-[10px]"
        title={insight.action}
      >
        {insight.action}
      </p>
    </li>
  );
}

export function ActionPane({
  queue,
  className,
}: {
  queue: ActionQueue;
  className?: string;
}) {
  const trpc = useTRPC();
  /**
   * Dismissing a flag hides a row and moves no figure: the queue is the same
   * ledger read either way. So which flags are hidden lives here, and the
   * write only records the choice for the next visit.
   */
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(
    () => new Set(queue.dismissedIds),
  );
  const [restoring, setRestoring] = useState(false);

  const set = useMutation(trpc.insights.set.mutationOptions());
  const clear = useMutation(trpc.insights.clear.mutationOptions());
  const [flags, dismissed] = partition(
    queue.insights,
    (insight) => !hiddenIds.has(insight.id),
  );
  // Scoped to the flag actually being dismissed, so dismissing one insight
  // never dims its siblings.
  const dismissingId = set.isPending ? set.variables.insightId : undefined;
  const error = set.error ?? clear.error;

  const dismiss = (insightId: string) => {
    set.mutate(
      { insightId, status: "dismissed" },
      {
        onSuccess: () =>
          setHiddenIds((hidden) => new Set(hidden).add(insightId)),
      },
    );
  };

  const restoreAll = async () => {
    setRestoring(true);
    const cleared = await Promise.allSettled(
      dismissed.map((insight) => clear.mutateAsync({ insightId: insight.id })),
    );
    if (cleared.every((result) => result.status === "fulfilled")) {
      setHiddenIds(new Set());
    }
    setRestoring(false);
  };

  const due = queue.due.slice(0, MAX_DUE);
  const moreDue = queue.due.length - due.length;
  const meta =
    queue.overdue > 0
      ? `${queue.overdue} overdue`
      : `${queue.due.length} due · ${flags.length} flags`;

  return (
    <Pane
      title="Action"
      meta={
        <span className={queue.overdue > 0 ? "text-destructive" : undefined}>
          {meta}
        </span>
      }
      className={className}
      bodyClassName="flex min-h-0 flex-1 flex-col p-0"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {due.length === 0 ? (
          <p className="text-muted-foreground px-3 py-2 text-xs">
            Nothing due in six weeks.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {due.map((item) => (
              <DueRow key={item.key} item={item} />
            ))}
          </ul>
        )}
        {moreDue > 0 ? (
          <p className="text-muted-foreground px-3 py-1 text-[10px]">
            +{moreDue} more inside the window
          </p>
        ) : null}

        <div className="border-border flex h-6 items-center border-t px-3">
          <span className="label">Flags</span>
        </div>

        {flags.length === 0 ? (
          <p className="text-muted-foreground px-3 py-2 text-xs">No flags.</p>
        ) : (
          <ul className="divide-border divide-y">
            {flags.slice(0, MAX_FLAGS).map((insight) => (
              <FlagRow
                key={insight.id}
                insight={insight}
                pending={insight.id === dismissingId}
                onDismiss={dismiss}
              />
            ))}
          </ul>
        )}
        {flags.length > MAX_FLAGS ? (
          <p className="text-muted-foreground px-3 py-1 text-[10px]">
            +{flags.length - MAX_FLAGS} more raised
          </p>
        ) : null}

        {error ? (
          <p className="text-destructive px-3 py-1 text-[10px]">
            {error.message}
          </p>
        ) : null}
      </div>

      {dismissed.length > 0 ? (
        <div className="border-border flex h-6 shrink-0 items-center gap-2 border-t px-3 text-[10px]">
          <span className="text-muted-foreground">
            {dismissed.length} dismissed
          </span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground cursor-pointer"
            disabled={restoring}
            onClick={() => void restoreAll()}
          >
            restore
          </button>
        </div>
      ) : null}
    </Pane>
  );
}
