"use client";

import { cn } from "@openledger-cfo/ui";
import { Pane } from "@openledger-cfo/ui/pane";

import { useCliLog } from "~/components/cli-log-provider";
import { useHydrated } from "~/components/use-hydrated";
import { useTailFollow } from "~/components/use-tail-follow";
import { NO_ENTRIES } from "~/domain/cli-log";
import { countNoun } from "~/domain/format";

const timeOf = (startedAt: number) =>
  new Date(startedAt).toLocaleTimeString("en-GB", { hour12: false });

export function CliLog({ className }: { className?: string }) {
  const hydrated = useHydrated();
  const log = useCliLog();

  /**
   * Both gated on hydrated, not just on what the poll holds: the provider polls
   * from the layout, outside this page's suspense boundary, so it can already
   * hold commands before this subtree finishes hydrating — rendering them then
   * would diverge from the empty server HTML.
   */
  const entries = hydrated ? log.entries : NO_ENTRIES;
  const error = hydrated ? log.error : null;
  const { ref: scrollRef, onScroll } = useTailFollow(entries);

  return (
    <Pane
      title="oled"
      meta={countNoun(entries.length, "command")}
      bodyClassName="min-h-0 flex-1 p-0"
      className={className}
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-3 py-2"
      >
        {error !== null ? (
          <p className="text-destructive text-xs">{error}</p>
        ) : null}

        {entries.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Every oled call this server makes lands here.
          </p>
        ) : (
          <ul className="text-[11px] leading-5">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className={cn(
                  "flex items-baseline justify-between gap-3",
                  entry.exitCode !== null &&
                    entry.exitCode !== 0 &&
                    "text-destructive",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">
                    {timeOf(entry.startedAt)}
                  </span>{" "}
                  $ {entry.line}
                </span>
                {entry.exitCode === null ? (
                  <span
                    aria-label="Running"
                    className="bg-accent size-1.5 shrink-0 animate-pulse rounded-full"
                  />
                ) : (
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      entry.exitCode === 0 && "text-muted-foreground",
                    )}
                  >
                    exit {entry.exitCode}
                    {entry.durationMs === null
                      ? null
                      : ` · ${(entry.durationMs / 1000).toFixed(1)}s`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Pane>
  );
}
