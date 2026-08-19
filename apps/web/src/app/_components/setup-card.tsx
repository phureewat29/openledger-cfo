import type { LedgerFailureReason } from "~/server/head";

const LABEL: Record<LedgerFailureReason, string> = {
  "not-installed": "No CLI",
  "not-initialized": "No data",
  unavailable: "Unavailable",
};

const HEADLINE: Record<LedgerFailureReason, string> = {
  "not-installed": "The data plane is not installed.",
  "not-initialized": "No ledger to have an opinion about yet.",
  unavailable: "The ledger did not answer.",
};

const BODY: Record<LedgerFailureReason, string> = {
  "not-installed":
    "Every figure here is read from the OpenLedger CLI. Install it once, globally, then come back here.",
  "not-initialized":
    "Every figure here is computed from real postings. Initialize the demo ledger and the panes fill in.",
  unavailable:
    "Every figure here is read from the OpenLedger CLI at request time, so the page shows nothing rather than guessing. Reload; if it persists, check that `oled` runs.",
};

// No command for `unavailable`: it is the catch-all, and prescribing
// `pnpm bootstrap` there would wipe a ledger that only failed to answer.
const COMMAND: Partial<Record<LedgerFailureReason, string>> = {
  "not-installed": "npm install -g @aquartier/openledger",
  "not-initialized": "pnpm bootstrap",
};

export function SetupCard({
  reason,
  message,
}: {
  reason: LedgerFailureReason;
  message: string;
}) {
  return (
    <div className="flex min-h-full items-center justify-center p-3">
      <section className="border-border bg-card flex w-full max-w-2xl flex-col gap-3 rounded-lg border p-4">
        <span className="label">{LABEL[reason]}</span>
        <h1 className="text-base leading-tight font-medium">
          {HEADLINE[reason]}
        </h1>
        <p className="text-muted-foreground text-xs">{BODY[reason]}</p>
        {COMMAND[reason] === undefined ? null : (
          <pre className="bg-secondary overflow-x-auto rounded-md p-3 text-xs">
            {COMMAND[reason]}
          </pre>
        )}
        <p className="text-muted-foreground text-[10px] break-words">
          {message}
        </p>
      </section>
    </div>
  );
}
