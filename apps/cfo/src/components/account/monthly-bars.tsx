import { cn } from "@openledger-fleet/ui";

import type { HoverBand, HoverColumn } from "~/components/charts/column-hover";
import type { TipRow } from "~/components/charts/tooltip";
import type { MonthFlow } from "~/server/account";
import { MonthAxis } from "~/components/charts/axis";
import { ColumnHover } from "~/components/charts/column-hover";
import { bandOpacity } from "~/components/charts/tone";
import {
  compactOf,
  formatMonth,
  formatMonthAbbr,
  moneyOf,
} from "~/domain/format";

/** Percent of the tallest bar; a real figure never renders as empty. */
const MIN_BAR_PERCENT = 2;

/** Money in and money out are two roles, not two ranks, so they keep two inks. */
const IN_TONE = "bg-foreground";
const OUT_TONE = "bg-muted-foreground";

/**
 * Fractions of the peak, given the room. Zero is the border the bars already
 * stand on, so it is labelled rather than drawn a second time.
 */
const TICKS = [1, 0.5, 0];

export const peakOf = (months: readonly MonthFlow[]): number =>
  Math.max(...months.flatMap((month) => [month.in, month.out]), 0);

const heightOf = (value: number, peak: number) => {
  if (value <= 0 || peak <= 0) return 0;
  return Math.max((value / peak) * 100, MIN_BAR_PERCENT);
};

const rowsOf = (
  month: MonthFlow,
  money: (amount: number) => string,
  paidOut: boolean,
): TipRow[] => {
  // A month the account did nothing in has no reading, and a readout of zeroes
  // reads as a figure rather than as an absence.
  if (month.in <= 0 && month.out <= 0) return [];
  if (!paidOut) return [{ key: "in", label: "In", value: money(month.in) }];
  return [
    { key: "in", label: "In", value: money(month.in), tone: IN_TONE },
    { key: "out", label: "Out", value: money(month.out), tone: OUT_TONE },
  ];
};

export function MonthlyBars({
  months,
  currency,
  expanded = false,
}: {
  months: readonly MonthFlow[];
  currency: string;
  expanded?: boolean;
}) {
  const money = moneyOf(currency);
  const compact = compactOf(currency);
  const peak = peakOf(months);
  // An account that only ever received money draws one series, and one series
  // needs no key telling the reader which of two it is.
  const paidOut = months.some((month) => month.out > 0);

  if (peak <= 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No activity in these twelve months.
      </p>
    );
  }

  const bands: HoverBand[] = [
    { key: "in", label: "In", tone: IN_TONE, rank: 0 },
    { key: "out", label: "Out", tone: OUT_TONE, rank: 1 },
  ];

  const columns: HoverColumn[] = months.map((month) => ({
    key: month.month,
    header: formatMonth(month.month),
    rows: rowsOf(month, money, paidOut),
  }));

  const bar = expanded ? "min-w-0 flex-1" : "w-2";

  return (
    <div
      // The gutter the tick figures hang in; the axis and the plot share it so
      // a month still sits over its own label.
      className={cn("flex min-h-0 flex-1 flex-col gap-3", expanded && "pl-12")}
      data-chart="bars"
    >
      <ColumnHover columns={columns} bands={paidOut ? bands : undefined}>
        <div className="border-border relative flex min-h-0 flex-1 items-end gap-1 border-b">
          {!expanded
            ? null
            : TICKS.map((tick) => (
                <span
                  key={tick}
                  className={cn(
                    "absolute inset-x-0",
                    tick > 0 && "bg-border h-px",
                  )}
                  style={{ top: `${(1 - tick) * 100}%` }}
                >
                  <span className="text-muted-foreground absolute right-full -translate-y-1/2 pr-1.5 text-[10px] tabular-nums">
                    {compact(peak * tick)}
                  </span>
                </span>
              ))}

          {months.map((month) => (
            <div
              key={month.month}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <div
                className={cn(
                  "mx-auto flex h-full items-end gap-[2px]",
                  expanded && "w-full max-w-10",
                )}
              >
                <div
                  className={cn(
                    "rounded-t-[2px] transition-opacity duration-150",
                    bar,
                    IN_TONE,
                  )}
                  style={{
                    height: `${heightOf(month.in, peak)}%`,
                    opacity: bandOpacity(0),
                  }}
                />
                {paidOut ? (
                  <div
                    className={cn(
                      "rounded-t-[2px] transition-opacity duration-150",
                      bar,
                      OUT_TONE,
                    )}
                    style={{
                      height: `${heightOf(month.out, peak)}%`,
                      opacity: bandOpacity(1),
                    }}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </ColumnHover>

      <MonthAxis labels={months.map((month) => formatMonthAbbr(month.month))} />
    </div>
  );
}
