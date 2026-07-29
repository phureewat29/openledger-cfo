/**
 * One authority for the Everything grid: the loading skeleton renders first
 * and the page streams in over it, so a spans mismatch reads as a jump.
 */
export const EVERYTHING_GRID =
  "grid min-h-0 flex-1 grid-cols-12 grid-rows-[auto_auto_auto] gap-3 p-3 @4xl/main:grid-rows-[auto_minmax(300px,1.45fr)_minmax(220px,1fr)]";

export const FLOW_COL =
  "col-span-12 @2xl/main:h-[360px] @4xl/main:col-span-8 @4xl/main:h-auto";

export const ACTION_COL =
  "col-span-12 @2xl/main:h-[300px] @4xl/main:col-span-4 @4xl/main:h-auto";

/** The line has no intrinsic height, so it holds one until the grid gives it one. */
export const TRAJECTORY_COL =
  "col-span-12 h-[300px] @2xl/main:col-span-6 @4xl/main:col-span-8 @4xl/main:h-auto";

export const TAPE_COL =
  "col-span-12 @2xl/main:col-span-6 @2xl/main:h-[300px] @4xl/main:col-span-4 @4xl/main:h-auto";
