// One authority for the plan grid: the skeleton paints first, so a spans mismatch reads as a jump.
// Goals, the only three-line pane, takes the full mid-tier row; the two-line panes share the next.
export const PLAN_GRID =
  "grid min-h-0 flex-1 auto-rows-[minmax(420px,auto)] grid-cols-12 grid-rows-[minmax(420px,1fr)] gap-3 p-3";

export const GOALS_COL = "col-span-12 @4xl/main:col-span-4";

export const SPLIT_COL =
  "col-span-12 @2xl/main:col-span-6 @4xl/main:col-span-4";
