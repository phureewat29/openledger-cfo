import { sumBy } from "es-toolkit";

import { cn } from "@openledger-cfo/ui";

import type { CategoryTotal } from "~/lib/charts/data";
import { foldTail } from "~/lib/charts/data";
import { ChartTip } from "~/lib/charts/tooltip";
import { formatPercent, moneyOf } from "~/lib/format";

/** Past eight rows the tail stops being worth a line of its own. */
const TOP_ROWS = 8;

// For a clipped, non-scrolling list only: rows past halfway open their tip upward.
const tipClassName = (index: number, length: number) =>
  cn(
    "left-0 opacity-0 group-hover:opacity-100",
    index >= length / 2 ? "bottom-full" : "top-full",
  );

// Every bar carries its own label and figure; the tip only rescues a truncated name.
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
  const lines = foldTail(rows, expanded ? Number.POSITIVE_INFINITY : TOP_ROWS);
  const peak = lines[0]?.value ?? 0;
  const total = sumBy(lines, (line) => line.value);

  if (peak <= 0) {
    return <p className="text-muted-foreground text-xs">{empty}</p>;
  }

  return (
    <ul className="flex flex-col" data-chart="hbar">
      {lines.map((line, index) => (
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
            {formatPercent(line.value / total)}
          </span>
          <span className="w-20 shrink-0 text-right tabular-nums">
            {format(line.value)}
          </span>
          <ChartTip
            rows={[
              { key: line.key, label: line.label, value: format(line.value) },
            ]}
            className={tipClassName(index, lines.length)}
          />
        </li>
      ))}
    </ul>
  );
}
