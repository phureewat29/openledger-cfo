/**
 * One authority for the account-detail grid: the loading skeleton renders
 * first and the page streams in over it, so a spans mismatch reads as a jump.
 * Fractional rows only resolve against a definite height, which is what
 * `flex-1` hands them; the floors still scroll a short window.
 */
export const ACCOUNT_GRID =
  "grid min-h-0 flex-1 grid-cols-12 gap-3 p-3 @4xl/main:grid-rows-[auto_minmax(280px,1fr)_minmax(300px,1.1fr)]";

export const POSTINGS_COL = "col-span-12 @2xl/main:h-[360px] @4xl/main:h-auto";

/**
 * The two chart slots, shared with account/viz-row.tsx: no chart here has an
 * intrinsic height, so each slot holds one until the wide grid's fractional
 * rows take over.
 */
export const VIZ_WIDE =
  "col-span-12 h-[300px] @4xl/main:col-span-8 @4xl/main:h-auto";

export const VIZ_NARROW =
  "col-span-12 h-[300px] @4xl/main:col-span-4 @4xl/main:h-auto";

export const VIZ_FULL = "col-span-12 h-[300px] @4xl/main:h-auto";

/**
 * The head band's stat row, shared with account/account-head.tsx so the
 * skeleton's cells stand exactly where the loaded ones will.
 */
export const HEAD_GRID =
  "border-border grid h-[52px] grid-cols-2 border-t @2xl/main:grid-cols-4";

export const HEAD_CELL =
  "border-border flex min-w-0 flex-col justify-center gap-0.5 border-l px-3 py-1.5 first:border-l-0";
