import { sumBy } from "es-toolkit";

import { cn } from "@openledger-cfo/ui";

import type { Portfolio } from "~/accounts/portfolio";
import type { CategoryTotal } from "~/lib/charts/data";
import { thbTotal } from "~/accounts/portfolio";
import { foldTail } from "~/lib/charts/data";
import { toneOf } from "~/lib/charts/tone";
import { ChartTip } from "~/lib/charts/tooltip";
import { formatPercent, formatThb } from "~/lib/format";

/** Past six the segments stop being wide enough to tell apart. */
const TOP_SEGMENTS = 6;
// Below this share a segment is narrower than its name, so the name goes to the tooltip.
const LABEL_SHARE = 0.1;

// What the money is made of, as one bar; baht only, since a mixed bar would add currencies.
export function CompositionStrip({
  portfolio,
  className,
}: {
  portfolio: Portfolio;
  className?: string;
}) {
  const slices = foldTail(
    [
      { key: "banks", label: "Banks & cash", value: thbTotal(portfolio.banks) },
      ...portfolio.holdings.map((holding) => ({
        key: holding.key,
        label: holding.label,
        value: thbTotal(holding.rows),
      })),
    ],
    TOP_SEGMENTS,
  );
  const total = sumBy(slices, (slice) => slice.value);

  if (total <= 0) return null;

  const width = (slice: CategoryTotal) => `${(slice.value / total) * 100}%`;
  // Where each segment's middle falls, which decides the side its tip opens toward.
  const middles = slices.map(
    (slice, rank) =>
      (sumBy(slices.slice(0, rank), (before) => before.value) +
        slice.value / 2) /
      total,
  );

  return (
    <section
      // A tip wider than its segment must never add a horizontal scrollbar.
      className={cn("flex flex-col gap-1 overflow-x-clip", className)}
      aria-label={`Baht assets by class, ${formatThb(total)}`}
    >
      {/* No total of its own: the assets figure above is the same sum. */}
      <div className="flex h-3 gap-[2px]">
        {slices.map((slice, rank) => (
          <div
            key={slice.key}
            className="group relative min-w-0 cursor-crosshair"
            style={{ width: width(slice) }}
          >
            <div
              className={cn(
                "h-full rounded-[2px] opacity-90 transition-opacity duration-150 group-hover:opacity-100",
                toneOf(rank),
              )}
            />
            <ChartTip
              className={cn(
                "top-full z-20 opacity-0 group-hover:opacity-100",
                (middles[rank] ?? 0) > 0.5 ? "right-0" : "left-0",
              )}
              rows={[
                {
                  key: slice.key,
                  label: slice.label,
                  value: formatThb(slice.value),
                  note: formatPercent(slice.value / total),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* Names sit under their segment: the dimmer tones cannot carry type on a 12px bar. */}
      <div className="flex gap-[2px]">
        {slices.map((slice) => (
          <span
            key={slice.key}
            style={{ width: width(slice) }}
            className="text-muted-foreground min-w-0 truncate text-[10px]"
          >
            {slice.value / total >= LABEL_SHARE ? slice.label : ""}
          </span>
        ))}
      </div>
    </section>
  );
}
