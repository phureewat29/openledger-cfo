import { orderBy, sumBy } from "es-toolkit";

import { cn } from "@openledger-cfo/ui";

import type { Portfolio } from "~/domain/portfolio";
import { toneOf } from "~/components/charts/tone";
import { ChartTip } from "~/components/charts/tooltip";
import { formatPercent, formatThb } from "~/domain/format";
import { thbTotal } from "~/domain/portfolio";

/** Past six the segments stop being wide enough to tell apart. */
const TOP_SEGMENTS = 6;
/**
 * Below this a segment is narrower than its own name at every tier this page
 * renders at, so the name goes to the tooltip rather than into a truncation.
 */
const LABEL_SHARE = 0.1;

interface Slice {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

const fold = (slices: readonly Slice[]): Slice[] => {
  const ranked = orderBy(
    slices.filter((slice) => slice.value > 0),
    [(slice) => slice.value],
    ["desc"],
  );
  const rest = ranked.slice(TOP_SEGMENTS);
  if (rest.length === 0) return ranked;
  return [
    ...ranked.slice(0, TOP_SEGMENTS),
    { key: "other", label: "Other", value: sumBy(rest, (row) => row.value) },
  ];
};

/**
 * What the money is made of, as one bar. The totals above say how much there
 * is; proportion is the one thing a row of separate pane headings cannot show.
 * Baht only — the group panes keep each currency's total apart, and a mixed
 * bar would be adding them.
 */
export function CompositionStrip({
  portfolio,
  className,
}: {
  portfolio: Portfolio;
  className?: string;
}) {
  const slices = fold([
    { key: "banks", label: "Banks & cash", value: thbTotal(portfolio.banks) },
    ...portfolio.holdings.map((holding) => ({
      key: holding.key,
      label: holding.label,
      value: thbTotal(holding.rows),
    })),
  ]);
  const total = sumBy(slices, (slice) => slice.value);

  if (total <= 0) return null;

  const width = (slice: Slice) => `${(slice.value / total) * 100}%`;
  // Where each segment's middle falls along the bar, which is the side its tip
  // has room to open toward.
  const middles = slices.map(
    (slice, rank) =>
      (sumBy(slices.slice(0, rank), (before) => before.value) +
        slice.value / 2) /
      total,
  );

  return (
    <section
      // The tips are the only thing here wider than their own segment, and a
      // tip is never worth a horizontal scrollbar on the page behind it.
      className={cn("flex flex-col gap-1 overflow-x-clip", className)}
      aria-label={`Baht assets by class, ${formatThb(total)}`}
    >
      {/* No total of its own: the assets figure directly above is the same
          baht-only sum, and this bar is what it is made of. */}
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

      {/* Names sit under their own segment rather than inside it: the ladder's
          dimmer steps cannot carry legible type on a 12px bar. */}
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
