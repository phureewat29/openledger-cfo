import { cn } from "@openledger-fleet/ui";

/** Rows past the halfway mark open their tip upward, clear of the list's floor. */
export const shouldFlipTip = (index: number, length: number) =>
  index >= length / 2;

/** Pinned to the row's left edge; direction follows {@link shouldFlipTip}. */
export const flipTipClassName = (flip: boolean) =>
  cn(
    "left-0 opacity-0 group-hover:opacity-100",
    flip ? "bottom-full" : "top-full",
  );
