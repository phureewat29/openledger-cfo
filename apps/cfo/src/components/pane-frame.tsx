import { Pane } from "@openledger-fleet/ui/pane";

import { LoadingLine } from "~/components/loading-line";
import { Shimmer } from "~/components/skeleton";

/**
 * The pane's outline while the route's server read is still open. One Pane
 * underneath, so the frame and the loaded pane can never drift apart; the
 * corgi line sits where the pane's meta will land, and the body defaults to
 * it too for callers that pass no skeleton of their own.
 */
export function PaneFrame({
  title,
  meta,
  className,
  bodyClassName,
  children,
}: {
  /** Left off where the route knows the pane's shape but not its subject. */
  title?: string;
  meta?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <Pane
      title={title ?? <Shimmer className="w-[8ch] text-[10px]" />}
      meta={meta ?? <LoadingLine className="text-[10px]" />}
      className={className}
      bodyClassName={bodyClassName}
    >
      {children ?? <LoadingLine />}
    </Pane>
  );
}
