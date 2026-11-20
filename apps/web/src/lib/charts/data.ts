import { orderBy, sumBy } from "es-toolkit";

/** One sample of a series. `x` is already the label its axis prints. */
export interface Point {
  readonly x: string;
  readonly y: number;
}

/** One band of a stacked column, aligned to the chart's month labels. */
export interface BarSeries {
  readonly key: string;
  readonly label: string;
  readonly values: readonly number[];
}

export interface CategoryTotal {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/** Largest first; past `limit` the tail folds into one "Other" row. */
export const foldTail = (
  rows: readonly CategoryTotal[],
  limit: number,
): CategoryTotal[] => {
  const ranked = orderBy(
    rows.filter((row) => row.value > 0),
    [(row) => row.value],
    ["desc"],
  );
  const rest = ranked.slice(limit);
  if (rest.length === 0) return ranked;
  return [
    ...ranked.slice(0, limit),
    { key: "other", label: "Other", value: sumBy(rest, (row) => row.value) },
  ];
};

/**
 * A series sampled on a fixed grid still yields every point for a dormant
 * account, all at one level: nothing to plot, which a caller must know first.
 */
export const hasMovement = (points: readonly Point[]): boolean =>
  points.some((point) => point.y !== points[0]?.y);

/** The span a flat series is lent, having none of its own to be drawn against. */
const MIN_SPAN = 1;

/** A series too flat to fill MIN_SPAN is lent the shortfall evenly at both ends. */
export const paddedDomain = (bottom: number, top: number) => {
  const raw = top - bottom;
  const span = Math.max(raw, MIN_SPAN);
  const pad = (span - raw) / 2;
  return { low: bottom - pad, high: top + pad };
};
