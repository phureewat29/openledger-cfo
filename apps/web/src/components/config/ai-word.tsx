"use client";

import { cn } from "@openledger-cfo/ui";

import { useConfigDialog } from "./config-dialog-provider";
import { useAiStatus, verdictOf } from "./use-ai-status";

/**
 * Nothing when the gateway is healthy; one clickable word when it is not.
 * Quiet by design — the chat chip carries the same fact with more room — and
 * silent entirely while the ledger is down: the main area owns that nag.
 */
export function AiWord({
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
      aria-label={`${word} — open the AI Gateway Configuration`}
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
