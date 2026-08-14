/**
 * One authority for the Everything grid: the loading skeleton renders first
 * and the page streams in over it, so a spans mismatch reads as a jump.
 */
export const EVERYTHING_GRID =
  "grid min-h-0 flex-1 grid-cols-12 grid-rows-[auto_auto_auto] gap-3 p-3 @4xl/main:grid-rows-[auto_minmax(300px,1.45fr)_minmax(220px,1fr)]";

/** The sankey svg is absolutely positioned, so the slot must own a height. */
export const FLOW_COL =
  "col-span-12 h-[360px] @4xl/main:col-span-8 @4xl/main:h-auto";

export const ACTION_COL =
  "col-span-12 @2xl/main:h-[300px] @4xl/main:col-span-4 @4xl/main:h-auto";

/** The line has no intrinsic height, so it holds one until the grid gives it one. */
export const TRAJECTORY_COL =
  "col-span-12 h-[300px] @2xl/main:col-span-6 @4xl/main:col-span-8 @4xl/main:h-auto";

export const TAPE_COL =
  "col-span-12 @2xl/main:col-span-6 @2xl/main:h-[300px] @4xl/main:col-span-4 @4xl/main:h-auto";

/**
 * The vitals' account-class strip. Wraps rather than clips: at phone widths
 * the fourth segment's baht figure was the first thing cut, and the wide
 * tier's fixed heights never see a second line.
 */
export const SEGMENT_STRIP =
  "border-border flex min-h-7 flex-wrap items-center gap-x-4 border-t px-3 py-1 text-[11px]";
