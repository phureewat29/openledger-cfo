import type { LedgerFailureReason } from "~/server/head";

const HEADLINE: Record<LedgerFailureReason, string> = {
  "not-initialized": "No ledger to have an opinion about yet.",
  unavailable: "The ledger did not answer.",
};

const BODY: Record<LedgerFailureReason, string> = {
  "not-initialized":
    "Every figure here is computed from real postings. Initialize the demo ledger and the panes fill in.",
  unavailable:
    "Every figure here is read from the OpenLedger CLI at request time, so the page shows nothing rather than guessing.",
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
        <span className="label">
          {reason === "not-initialized" ? "No data" : "Unavailable"}
        </span>
        <h1 className="text-base leading-tight font-medium">
          {HEADLINE[reason]}
        </h1>
        <p className="text-muted-foreground text-xs">{BODY[reason]}</p>
        <pre className="bg-secondary overflow-x-auto rounded-md p-3 text-xs">
          pnpm bootstrap
        </pre>
        <p className="text-muted-foreground text-[10px] break-words">
          {message}
        </p>
      </section>
    </div>
  );
}
