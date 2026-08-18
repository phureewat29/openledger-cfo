/**
 * One authority for the account-detail grid: the loading skeleton renders
 * first and the page streams in over it, so a spans mismatch reads as a jump.
 * Fractional rows only resolve against a definite height, which is what
 * `flex-1` hands them; the floors still scroll a short window.
 */
export const ACCOUNT_GRID =
  "grid min-h-0 flex-1 grid-cols-12 gap-3 p-3 @4xl/main:grid-rows-[auto_minmax(280px,1fr)_minmax(300px,1.1fr)]";

export const POSTINGS_COL = "col-span-12 @2xl/main:h-[360px] @4xl/main:h-auto";
