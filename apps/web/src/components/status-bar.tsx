"use client";

import { cn } from "@openledger-cfo/ui";

import type { CliEntry } from "~/domain/cli-log";
import type { Chrome } from "~/server/chrome";
import type { LedgerLoad } from "~/server/head";
import { useCliLog } from "~/components/cli-log-provider";
import { useConfigDialog } from "~/components/config/config-dialog-provider";
import { useAiStatus, verdictOf } from "~/components/config/use-ai-status";
import { formatStamp } from "~/domain/format";

/** Transport flags say nothing about the work; the title keeps the full argv. */
const TRANSPORT_FLAGS = /\s--(?:json|no-color|no-redact)\b|\s--config\s+\S+/g;

/** The pollers' own reads — this bar's pulse, not work. */
const POLL_ARGV = ["questions list", "ingest list"];

const isPoll = (entry: CliEntry) =>
  POLL_ARGV.some((argv) => entry.line.includes(argv));

/** The newest command that is somebody's work, else the newest of any kind. */
const newestUseful = (entries: readonly CliEntry[]) =>
  entries.findLast((entry) => !isPoll(entry)) ?? entries.at(-1);

/** One clickable word when the gateway is off or down; silent while the ledger is down. */
function AiWord({
  configured,
  ledgerOk,
}: {
  configured: boolean;
  ledgerOk: boolean;
}) {
  const config = useConfigDialog();
  const status = useAiStatus(configured && ledgerOk);

  if (!ledgerOk) return null;
  // A vanished row is "off", not "down" — only a probed failure earns the red.
  const down =
    configured &&
    verdictOf(status) === "down" &&
    status.data?.configured === true;
  if (configured && !down) return null;

  const word = down ? "AI DOWN" : "AI OFF";
  return (
    <button
      type="button"
      aria-label={`${word} — open the AI Gateway Config`}
      onClick={config.open}
      className={cn(
        "shrink-0 cursor-pointer",
        down
          ? "text-destructive"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {word}
    </button>
  );
}

const asOfText = (chrome: LedgerLoad<Chrome>) => {
  if (!chrome.ok) return "LEDGER UNAVAILABLE";
  if (chrome.value.stale)
    return `STALE · THROUGH ${formatStamp(chrome.value.asOf)}`;
  return `AS OF ${formatStamp(chrome.value.asOf)}`;
};

export function StatusBar({
  chrome,
  aiConfigured,
}: {
  chrome: LedgerLoad<Chrome>;
  aiConfigured: boolean;
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

      <AiWord configured={aiConfigured} ledgerOk={chrome.ok} />
    </footer>
  );
}
