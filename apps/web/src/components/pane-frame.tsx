import { Pane } from "@openledger-cfo/ui/pane";

import { LoadingLine } from "~/components/loading-line";
import { GhostLine } from "~/components/skeleton";

/**
 * The pane's outline while the route's server read is still open. One Pane
 * underneath, so the frame and the loaded pane can never drift apart; the
 * loading line speaks once, from the body.
 */
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
