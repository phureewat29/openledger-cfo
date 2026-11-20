import { orderBy, sumBy } from "es-toolkit";

import type { CategoryTotal } from "~/lib/charts/data";

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
