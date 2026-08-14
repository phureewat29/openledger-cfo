import { sumBy } from "es-toolkit";

import { cn } from "@openledger-fleet/ui";

import type { HoverBand, HoverColumn } from "~/components/charts/column-hover";
import type { BarSeries } from "~/domain/series/types";
import { MonthAxis } from "~/components/charts/axis";
import { ColumnHover } from "~/components/charts/column-hover";
import { bandOpacity, toneOf } from "~/components/charts/tone";
import { compactOf, formatPercent, moneyOf } from "~/domain/format";

/** CSS pixels; a real figure never renders as empty. */
const MIN_BAR_PX = 2;

export function StackedBars({
  months,
  series,
  currency,
  accentKey,
  capShareKey,
  expanded = false,
  empty = "No spending in this window.",
}: {
  months: readonly string[];
  series: readonly BarSeries[];
  /** A column cap has room for the shape of a figure, not its digits. */
  currency: string;
  /** The one band allowed the accent: money kept, never the biggest. */
  accentKey?: string;
  /**
   * Caps the columns with this band's share of the total rather than the total
   * itself — for a series whose total is the same every month, where the split
   * is the only thing that moves.
   */
  capShareKey?: string;
  expanded?: boolean;
  empty?: string;
}) {
  const compact = compactOf(currency);
  const money = moneyOf(currency);
  const totals = months.map((_, index) =>
    sumBy(series, (band) => band.values[index] ?? 0),
  );
  const peak = Math.max(...totals, 0);

  if (peak <= 0) {
    return <p className="text-muted-foreground text-xs">{empty}</p>;
  }

  const shareOf = (index: number, key: string | undefined) => {
    const total = totals[index] ?? 0;
    const band = series.find((entry) => entry.key === key);
    if (band === undefined || total <= 0) return undefined;
    return formatPercent((band.values[index] ?? 0) / total);
  };

  // Expanded, the column is wide enough for the digits the pane could only hint at.
  const capOf = (index: number) => {
    const total = totals[index] ?? 0;
    const share = shareOf(index, capShareKey);
    if (!expanded) return share ?? compact(total);
    return share === undefined ? money(total) : `${money(total)} · ${share}`;
  };

  const bands: HoverBand[] = series.map((band, rank) => ({
    key: band.key,
    label: band.label,
    tone: toneOf(rank, band.key === accentKey),
    rank,
  }));

  const columns: HoverColumn[] = months.map((month, index) => {
    const total = totals[index] ?? 0;
    return {
      key: `${index}-${month}`,
      header: month,
      rows: bands.map((band, rank): HoverColumn["rows"][number] => {
        const value = series[rank]?.values[index] ?? 0;
        return {
          key: band.key,
          label: band.label,
          value: money(value),
          tone: band.tone,
          note: total > 0 ? formatPercent(value / total) : undefined,
        };
      }),
    };
  });

  return (
    <div
      className="@container/bars flex min-h-0 flex-1 flex-col gap-2"
      data-chart="stacked"
    >
      <ColumnHover
        columns={columns}
        bands={series.length > 1 ? bands : undefined}
      >
        {/* The top padding is where the tallest column puts its total. */}
        <div className="flex min-h-0 flex-1 items-end gap-1 pt-4">
          {months.map((month, index) => {
            const total = totals[index] ?? 0;
            const share = (total / peak) * 100;
            return (
              <div
                key={`${index}-${month}`}
                className="relative flex h-full min-w-0 flex-1 flex-col justify-end"
              >
                <div
                  className={cn(
                    "mx-auto flex w-full flex-col gap-[2px]",
                    expanded ? "max-w-10" : "max-w-6",
                  )}
                  style={{ height: `${share}%` }}
                >
                  {series
                    .map((band, rank) => ({ band, rank }))
                    .reverse()
                    .filter(({ band }) => (band.values[index] ?? 0) > 0)
                    .map(({ band, rank }) => (
                      <div
                        key={band.key}
                        className={cn(
                          "w-full transition-opacity duration-150 first:rounded-t-[4px]",
                          toneOf(rank, band.key === accentKey),
                        )}
                        style={{
                          height: `calc(${((band.values[index] ?? 0) / total) * 100}% - 2px)`,
                          minHeight: MIN_BAR_PX,
                          opacity: bandOpacity(rank),
                        }}
                      />
                    ))}
                </div>
                {total > 0 ? (
                  // Hidden where a column is narrower than its own compact
                  // figure — overhanging caps collide with their neighbours.
                  // Gated on the plot's own box, so the expanded dialog keeps
                  // its caps however narrow the page behind it is.
                  <span
                    className="text-muted-foreground absolute inset-x-0 hidden text-center text-[10px] tabular-nums @[480px]/bars:block"
                    style={{ bottom: `calc(${share}% + 2px)` }}
                  >
                    {capOf(index)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </ColumnHover>

      <MonthAxis labels={months} />
    </div>
  );
}
