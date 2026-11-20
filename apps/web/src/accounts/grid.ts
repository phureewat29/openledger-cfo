// One authority per page grid: each loading skeleton paints first and its page
// streams in over it, so a spans mismatch reads as a jump.

/** Four explicit wide-tier rows, so skeleton and page resolve the same geometry whatever the data holds. */
export const ACCOUNTS_GRID =
  "grid min-h-0 flex-1 grid-cols-12 gap-3 p-3 @4xl/main:grid-rows-[auto_auto_280px_minmax(0,1fr)]";

export const TOTALS_ROW =
  "border-border bg-card col-span-12 grid h-[52px] grid-cols-3 overflow-hidden rounded-lg border";

export const TOTALS_CELL =
  "border-border flex min-w-0 flex-col justify-center gap-0.5 border-l px-3 first:border-l-0";

/** Bar, gap and label line of the composition strip: 12 + 4 + 15. */
export const STRIP_ROW = "col-span-12 h-[31px]";

/** Seven whole two-line rows of the tallest group, banks; the wide tier's 280px track decides instead. */
export const GROUP_COL =
  "col-span-12 @2xl/main:h-[360px] @4xl/main:col-span-4 @4xl/main:h-auto";

export const GROUP_HALF = `${GROUP_COL} @2xl/main:col-span-6`;

export const INVESTMENTS_COL =
  "col-span-12 @2xl/main:h-[320px] @4xl/main:h-auto";

/** Fractional rows resolve only against the definite height `flex-1` hands them. */
export const ACCOUNT_GRID =
  "grid min-h-0 flex-1 grid-cols-12 gap-3 p-3 @4xl/main:grid-rows-[auto_minmax(280px,1fr)_minmax(300px,1.1fr)]";

export const POSTINGS_COL = "col-span-12 @2xl/main:h-[360px] @4xl/main:h-auto";

/** No chart here has an intrinsic height, so each slot holds one until the wide grid takes over. */
export const VIZ_WIDE =
  "col-span-12 h-[300px] @4xl/main:col-span-8 @4xl/main:h-auto";

export const VIZ_NARROW =
  "col-span-12 h-[300px] @4xl/main:col-span-4 @4xl/main:h-auto";

export const VIZ_FULL = "col-span-12 h-[300px] @4xl/main:h-auto";

export const HEAD_GRID =
  "border-border grid h-[52px] grid-cols-2 border-t @2xl/main:grid-cols-4";

export const HEAD_CELL =
  "border-border flex min-w-0 flex-col justify-center gap-0.5 border-l px-3 py-1.5 first:border-l-0";
