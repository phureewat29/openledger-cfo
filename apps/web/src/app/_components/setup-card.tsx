import type { LedgerFailureReason } from "~/server/head";

interface Remedy {
  readonly caption: string;
  readonly command: string;
}

interface Copy {
  readonly label: string;
  readonly headline: string;
  readonly body: string;
  readonly remedies: readonly Remedy[];
}

const COPY: Record<LedgerFailureReason, Copy> = {
  "not-installed": {
    label: "No CLI",
    headline: "OpenLedger isn't installed.",
    body: "This app reads everything from the OpenLedger CLI.",
    remedies: [
      {
        caption: "Install it globally, then reload.",
        command: "npm install -g @aquartier/openledger",
      },
    ],
  },
  "not-initialized": {
    label: "No data",
    headline: "There's no ledger yet.",
    body: "Every number on screen comes from the ledger. Create one first.",
    remedies: [
      {
        caption: "Load the demo dataset.",
        command: "pnpm bootstrap",
      },
      {
        caption: "Start empty instead.",
        command: "pnpm bootstrap:empty",
      },
    ],
  },
  // A read-only probe, not `pnpm bootstrap`: the ledger may be intact and
  // merely unreachable, and bootstrap would replace it.
  unavailable: {
    label: "No answer",
    headline: "The ledger didn't respond.",
    body: "Reload the page; the error is below.",
    remedies: [
      {
        caption: "Check the CLI still runs.",
        command: "oled --version",
      },
    ],
  },
};

export function SetupCard({
  reason,
  message,
}: {
  reason: LedgerFailureReason;
  message: string;
}) {
  const copy = COPY[reason];
  // Suppress only the message that restates the card; a corrupt database
  // also lands under not-initialized and its diagnosis must stay visible.
  const noise =
    reason === "not-initialized" && message.startsWith("No oled config at ");
  return (
    <div className="flex min-h-full items-center justify-center p-3">
      <section className="border-border bg-card flex w-full max-w-2xl flex-col gap-3 rounded-lg border p-4">
        <span className="label">{copy.label}</span>
        <h1 className="text-base leading-tight font-medium">{copy.headline}</h1>
        <p className="text-muted-foreground text-xs">{copy.body}</p>
        {copy.remedies.map((remedy) => (
          <div key={remedy.command} className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs">{remedy.caption}</p>
            <pre className="bg-secondary overflow-x-auto rounded-md p-3 text-xs select-all">
              {remedy.command}
            </pre>
          </div>
        ))}
        {noise ? null : (
          <div className="border-border flex flex-col gap-1 border-t pt-3">
            <span className="label">Details</span>
            <p className="text-muted-foreground text-[10px] break-words">
              {message}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
