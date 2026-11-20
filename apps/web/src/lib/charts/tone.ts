import type { CSSProperties } from "react";

/**
 * One ink, stepped. The palette holds a single data colour, so a band is told
 * apart by its tone — fixed by the series' place in a ranking taken over the
 * whole window, never by its size in the column under the cursor.
 */
const TONE = [
  "bg-foreground",
  "bg-foreground/80",
  "bg-foreground/65",
  "bg-foreground/50",
  "bg-foreground/40",
  "bg-foreground/30",
];

export const toneOf = (rank: number, accented = false): string => {
  if (accented) return "bg-accent";
  return TONE[rank] ?? TONE.at(-1) ?? "bg-foreground";
};

/** Where a band sits while a legend chip is holding another one up. */
const RECEDED = "0.25";

/**
 * The lift has to cross from a client legend to bands the server drew, and no
 * ancestor selector can compare one element's attribute against another's.
 * Custom properties inherit, so the wrapper can say "everything recedes except
 * this rank" in two declarations.
 */
export const bandDim = (lit: number | null): CSSProperties =>
  lit === null
    ? {}
    : ({ "--dim": RECEDED, [`--band-${lit}`]: "1" } as CSSProperties);

export const bandOpacity = (rank: number): string =>
  `var(--band-${rank}, var(--dim, 1))`;
