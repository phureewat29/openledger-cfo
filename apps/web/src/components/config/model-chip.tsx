"use client";

import type { ProbeReason } from "@openledger-cfo/api";
import { cn } from "@openledger-cfo/ui";

import type { GatewayVerdict } from "./use-ai-status";
import { useConfigDialog } from "./config-dialog-provider";
import { useAiStatus, verdictOf } from "./use-ai-status";

interface ChipView {
  readonly dot: string;
  readonly text: string;
  /** Uppercase is for the call to action; a model id renders verbatim. */
  readonly caps: boolean;
  readonly state: string;
  readonly title?: string;
}

const FAILURE_STATE: Record<ProbeReason, string> = {
  unauthorized: "AI gateway authentication failed",
  unreachable: "AI gateway unreachable",
};

const chipView = (input: {
  ledgerOk: boolean;
  configured: boolean;
  model: string;
  verdict: GatewayVerdict;
  down?: { reason: ProbeReason; message: string } | undefined;
}): ChipView => {
  const { ledgerOk, configured, model, verdict, down } = input;
  // The main area owns the nag while the ledger is broken; stay quiet here.
  if (!ledgerOk) {
    return {
      dot: "bg-muted-foreground",
      text: configured ? model : "AI",
      caps: !configured,
      state: "waiting for the ledger",
      title: configured ? model : undefined,
    };
  }
  if (!configured) {
    return {
      dot: "bg-destructive",
      text: "Set up AI",
      caps: true,
      state: "AI gateway not configured",
    };
  }
  if (verdict === "pending") {
    return {
      dot: "bg-muted-foreground animate-pulse",
      text: model,
      caps: false,
      state: "checking the AI gateway",
      title: model,
    };
  }
  if (verdict === "unknown") {
    return {
      dot: "bg-muted-foreground",
      text: model,
      caps: false,
      state: "AI gateway status unknown",
      title: `${model} — the status check failed`,
    };
  }
  if (verdict === "up") {
    return {
      dot: "bg-accent",
      text: model,
      caps: false,
      state: "AI gateway connected",
      title: model,
    };
  }
  return {
    dot: "bg-destructive",
    text: model,
    caps: false,
    state:
      down === undefined
        ? "AI gateway not configured"
        : FAILURE_STATE[down.reason],
    title: down === undefined ? model : `${model} — ${down.message}`,
  };
};

/**
 * The header's one word on the gateway: which model answers, and whether the
 * saved config actually does. Every state opens the same settings dialog.
 */
export function ModelChip({
  configured,
  model,
  ledgerOk,
}: {
  configured: boolean;
  model: string;
  ledgerOk: boolean;
}) {
  const dialog = useConfigDialog();
  const status = useAiStatus(configured && ledgerOk);
  const live = status.data;
  const view = chipView({
    ledgerOk,
    configured,
    model,
    verdict: verdictOf(status),
    down: live?.configured && !live.ok ? live : undefined,
  });

  return (
    <button
      type="button"
      aria-label={`${view.text} — ${view.state}`}
      title={view.title}
      onClick={dialog.open}
      className="text-muted-foreground hover:text-foreground focus-visible:outline-ring flex min-w-0 shrink cursor-pointer items-center gap-1.5 bg-transparent text-[10px] outline-none focus-visible:outline-2"
    >
      <span
        className={cn(
          "min-w-0 truncate",
          view.caps && "tracking-[0.12em] uppercase",
        )}
      >
        {view.text}
      </span>
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", view.dot)}
      />
    </button>
  );
}
