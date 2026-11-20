import type { CSSProperties } from "react";

// One ink, stepped by the series' rank over the whole window, never by its size in a column.
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

// Inherited custom properties let a client legend lift one rank of server-drawn bands.
export const bandDim = (lit: number | null): CSSProperties =>
  lit === null
    ? {}
    : ({ "--dim": RECEDED, [`--band-${lit}`]: "1" } as CSSProperties);

export const bandOpacity = (rank: number): string =>
  `var(--band-${rank}, var(--dim, 1))`;
