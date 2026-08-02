/**
 * One authority for the plan grid: the loading skeleton renders first and the
 * page streams in over it, so a spans mismatch reads as the layout jumping.
 * Goals is the only three-line pane, so it takes the full mid-tier row; the
 * two-line panes share the row below it.
 */
export const PLAN_GRID =
  "grid min-h-0 flex-1 auto-rows-[minmax(420px,auto)] grid-cols-12 grid-rows-[minmax(420px,1fr)] gap-3 p-3";

export const GOALS_COL = "col-span-12 @4xl/main:col-span-4";

export const SPLIT_COL =
  "col-span-12 @2xl/main:col-span-6 @4xl/main:col-span-4";
