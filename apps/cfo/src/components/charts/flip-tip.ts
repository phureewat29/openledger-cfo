import { cn } from "@openledger-fleet/ui";

/**
 * For lists inside a clipped, non-scrolling box only: rows past the halfway
 * mark open their tip upward, clear of the floor. Inside an overflow-y-auto
 * list this is the wrong tool — downward overflow extends the scrollable
 * region and stays reachable, upward overflow is clipped and nothing can
 * scroll to it — so those tips always open downward instead.
 */
export const shouldFlipTip = (index: number, length: number) =>
  index >= length / 2;

/** Pinned to the row's left edge; direction follows {@link shouldFlipTip}. */
export const flipTipClassName = (flip: boolean) =>
  cn(
    "left-0 opacity-0 group-hover:opacity-100",
    flip ? "bottom-full" : "top-full",
  );
