import { Pane } from "@openledger-cfo/ui/pane";

import { GhostLine } from "~/app/_components/skeleton";
import { LoadingLine } from "~/lib/ui/loading-line";

// A loading pane built on the same Pane, so it can never drift from the loaded one.
export function PaneFrame({
  title,
  className,
  bodyClassName,
  children,
}: {
  /** Left off where the route knows the pane's shape but not its subject. */
  title?: string;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <Pane
      title={title ?? <GhostLine className="text-[10px]" />}
      className={className}
      bodyClassName={bodyClassName}
    >
      {children ?? <LoadingLine />}
    </Pane>
  );
}
