import { orderBy, sumBy } from "es-toolkit";

import type { CategoryTotal } from "~/domain/series/types";
import { flipTipClassName, shouldFlipTip } from "~/components/charts/flip-tip";
import { ChartTip } from "~/components/charts/tooltip";
import { formatPercent, moneyOf } from "~/domain/format";

/** Past eight rows the tail stops being worth a line of its own. */
const TOP_ROWS = 8;

const fold = (
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
 * The form that is readable by construction: every bar carries its own label
 * and its own figure, so nothing depends on a legend or a hover. The tip only
 * rescues the names the row was too narrow to print in full, and flips side at
 * the halfway row so the list can never push one out of the pane.
 */
export function HBarList({
  rows,
  currency,
  expanded = false,
  empty = "Nothing in this cycle yet.",
}: {
  rows: readonly CategoryTotal[];
  /** This form has room for the exact figure, so it prints one. */
  currency: string;
  /** The fold is a space budget; given the room, every row keeps its line. */
  expanded?: boolean;
  empty?: string;
}) {
  const format = moneyOf(currency);
  const lines = fold(rows, expanded ? Number.POSITIVE_INFINITY : TOP_ROWS);
  const peak = lines[0]?.value ?? 0;
  const total = sumBy(lines, (line) => line.value);

  if (peak <= 0) {
    return <p className="text-muted-foreground text-xs">{empty}</p>;
  }

  return (
    <ul className="flex flex-col" data-chart="hbar">
      {lines.map((line, index) => {
        const share = total > 0 ? formatPercent(line.value / total) : "—";
        return (
          <li
            key={line.key}
            className="group hover:bg-secondary/60 relative flex h-6 cursor-crosshair items-center gap-2 px-1 text-[11px]"
          >
            <span className="w-[38%] shrink-0 truncate">{line.label}</span>
            <span className="bg-secondary h-[4px] min-w-0 flex-1 rounded-[1px]">
              <span
                className="bg-foreground block h-full rounded-[1px] opacity-75 transition-opacity duration-150 group-hover:opacity-100"
                style={{ width: `${(line.value / peak) * 100}%` }}
              />
            </span>
            <span className="text-muted-foreground w-10 shrink-0 text-right text-[10px] tabular-nums opacity-0 group-hover:opacity-100">
              {share}
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums">
              {format(line.value)}
            </span>
            {/* This list sits in a clipped box, not a scroller — the flip is
                earned here, where a floor-row tip would otherwise be cut. */}
            <ChartTip
              rows={[
                { key: line.key, label: line.label, value: format(line.value) },
              ]}
              className={flipTipClassName(shouldFlipTip(index, lines.length))}
            />
          </li>
        );
      })}
    </ul>
  );
}
