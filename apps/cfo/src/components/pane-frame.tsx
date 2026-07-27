import { cn } from "@openledger-fleet/ui";

import { LoadingLine } from "~/components/loading-line";

/** The pane's outline while the route's server read is still open. */
export function PaneFrame({
  title,
  className,
}: {
  /** Left off where the route knows the pane's shape but not its subject. */
  title?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border-border bg-card flex min-h-0 flex-col overflow-hidden rounded-lg border",
        className,
      )}
    >
      <header className="border-border flex h-8 shrink-0 items-center border-b px-3">
        <span className="label truncate">{title}</span>
      </header>
      <div className="min-h-0 p-3">
        <LoadingLine />
      </div>
    </section>
  );
}
