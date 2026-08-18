/**
 * One authority for the accounts grid: the loading skeleton renders first and
 * the page streams in over it, so a spans mismatch reads as a jump.
 */
export const ACCOUNTS_GRID =
  "grid min-h-0 flex-1 grid-cols-12 gap-3 p-3 @4xl/main:grid-rows-[auto_auto_minmax(280px,1fr)]";

export const TOTALS_ROW =
  "border-border bg-card col-span-12 grid h-[52px] grid-cols-3 overflow-hidden rounded-lg border";

export const TOTALS_CELL =
  "border-border flex min-w-0 flex-col justify-center gap-0.5 border-l px-3 first:border-l-0";

/** Bar, gap and label line of the composition strip: 12 + 4 + 15. */
export const STRIP_ROW = "col-span-12 h-[31px]";

/**
 * Seven whole rows of the tallest group — banks — at the 46.5px a two-line row
 * takes. At the wide tier the row these share decides instead, since holdings
 * below them are content-sized and a fixed height here would run underneath.
 */
export const GROUP_COL =
  "col-span-12 @2xl/main:h-[360px] @4xl/main:col-span-4 @4xl/main:h-auto";

export const GROUP_HALF = `${GROUP_COL} @2xl/main:col-span-6`;

export const INVESTMENTS_COL =
  "col-span-12 @2xl/main:h-[320px] @4xl/main:h-auto";
