/**
 * One authority for the ingest grid: the loading skeleton renders first and
 * the page streams in over it, so a spans mismatch reads as a jump. Both
 * rows' panes hold lists with no natural end, so the mid-tier height is a
 * base the widest tier releases rather than one it adds.
 */
export const INGEST_GRID =
  "grid min-h-0 flex-1 grid-cols-12 gap-3 p-3 @4xl/main:grid-rows-[minmax(320px,1fr)_minmax(220px,0.62fr)]";

export const INGEST_NARROW =
  "col-span-12 @2xl/main:h-[440px] @4xl/main:col-span-5 @4xl/main:h-auto";

export const INGEST_WIDE =
  "col-span-12 @2xl/main:h-[440px] @4xl/main:col-span-7 @4xl/main:h-auto";
