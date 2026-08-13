"use client";

import { cn } from "@openledger-fleet/ui";

import type { CliEntry } from "~/domain/cli-log";
import type { Chrome } from "~/server/chrome";
import type { LedgerLoad } from "~/server/head";
import { useCliLog } from "~/components/cli-log-provider";
import { formatStamp } from "~/domain/format";

/**
 * Transport plumbing every invocation carries. It says nothing about the work
 * and at this width it crowds out what does, so the bar speaks the command and
 * the title keeps the full argv.
 */
const TRANSPORT_FLAGS = /\s--(?:json|no-color|no-redact)\b|\s--config\s+\S+/g;

/** The reads the pollers issue, which are this bar's own pulse rather than work. */
const POLL_ARGV = ["questions list", "ingest list"];

const isPoll = (entry: CliEntry) =>
  POLL_ARGV.some((argv) => entry.line.includes(argv));

/** The newest command that is somebody's work, else the newest of any kind. */
const newestUseful = (entries: readonly CliEntry[]) =>
  entries.findLast((entry) => !isPoll(entry)) ?? entries.at(-1);

const asOfText = (chrome: LedgerLoad<Chrome>) => {
  if (!chrome.ok) return "LEDGER UNAVAILABLE";
  if (chrome.value.stale)
    return `STALE · THROUGH ${formatStamp(chrome.value.asOf)}`;
  return `AS OF ${formatStamp(chrome.value.asOf)}`;
};

export function StatusBar({
  chrome,
  aiEnabled,
}: {
  chrome: LedgerLoad<Chrome>;
  aiEnabled: boolean;
}) {
  const entry = newestUseful(useCliLog().entries);
  const exitCode = entry?.exitCode ?? null;

  return (
    <footer className="border-border bg-card flex h-6 items-center gap-4 border-t px-3 text-[10px] tabular-nums">
      <span
        className={cn(
          "shrink-0",
          chrome.ok && !chrome.value.stale
            ? "text-muted-foreground"
            : "text-destructive",
        )}
        title={chrome.ok ? undefined : chrome.error.message}
      >
        {asOfText(chrome)}
      </span>

      {chrome.ok ? (
        <span className="text-muted-foreground hidden shrink-0 sm:block">
          {chrome.value.transactions.toLocaleString("en-US")} TX ·{" "}
          {chrome.value.accounts} ACCT
        </span>
      ) : null}

      <span
        className="text-muted-foreground min-w-0 flex-1 truncate"
        title={entry?.line}
      >
        {entry === undefined
          ? ""
          : `$ ${entry.line.replace(TRANSPORT_FLAGS, "").trim()}`}
      </span>

      {entry === undefined ? null : entry.exitCode === null ? (
        <span className="text-muted-foreground flex shrink-0 items-center gap-1.5">
          <span
            aria-hidden
            className="bg-accent size-1 animate-pulse rounded-full"
          />
          running
        </span>
      ) : (
        <span
          className={cn(
            "shrink-0",
            exitCode === 0 ? "text-muted-foreground" : "text-destructive",
          )}
        >
          exit {entry.exitCode}
          {entry.durationMs === null
            ? null
            : ` · ${(entry.durationMs / 1000).toFixed(1)}s`}
        </span>
      )}

      {aiEnabled ? null : (
        <span className="text-muted-foreground shrink-0">AI OFF</span>
      )}
    </footer>
  );
}
