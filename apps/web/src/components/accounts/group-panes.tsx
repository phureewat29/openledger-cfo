import Link from "next/link";

import { cn } from "@openledger-cfo/ui";
import { Pane } from "@openledger-cfo/ui/pane";

import type { Holding, PortfolioAccount } from "~/domain/portfolio";
import type { Point } from "~/domain/series/types";
import { Sparkline } from "~/components/charts/sparkline";
import { ChartTip } from "~/components/charts/tooltip";
import {
  formatDayMonth,
  formatHeld,
  formatPercent,
  formatThb,
  formatThbCompact,
  moneyOf,
} from "~/domain/format";
import { repaidShare, thbTotal, tickerOf } from "~/domain/portfolio";

const ROW =
  "flex h-7 items-center gap-2 px-3 text-[11px] hover:bg-secondary/60";
/**
 * A card or loan name is the whole reason to click the row, and sharing one
 * line with a cycle and a figure left it about seven characters. These panes
 * hold four rows and two, so the second line was already paid for.
 */
const STACKED = "flex flex-col gap-0.5 px-3 py-1.5 hover:bg-secondary/60";
const NAME = "min-w-0 flex-1 truncate";
const SUB = "text-muted-foreground text-[10px] tabular-nums";
const BODY = "flex min-h-0 flex-1 flex-col p-0";

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-3 py-2 text-xs">{children}</p>;
}

function Meter({ share, tone }: { share: number; tone?: string }) {
  return (
    <span className="bg-secondary h-[3px] w-16 shrink-0 overflow-hidden">
      <span
        className={cn("block h-full", tone ?? "bg-accent")}
        style={{ width: `${Math.min(share, 1) * 100}%` }}
      />
    </span>
  );
}

const href = (id: string) => `/accounts/${encodeURIComponent(id)}`;

export function BanksPane({
  rows,
  activity,
  sparks,
  className,
}: {
  rows: readonly PortfolioAccount[];
  activity: Readonly<Record<string, string>>;
  /** Recent weekly balances per row, for the shape beside the date. */
  sparks: Readonly<Record<string, readonly Point[]>>;
  className?: string;
}) {
  return (
    <Pane
      title="Banks & cash"
      meta={`${rows.length} · ${formatThbCompact(thbTotal(rows))}`}
      className={className}
      bodyClassName={BODY}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => {
              const moved = activity[row.id];
              return (
                <li key={row.id}>
                  <Link href={href(row.id)} className={STACKED}>
                    <span className="flex items-baseline gap-2 text-[11px]">
                      <span className={NAME} title={row.name}>
                        {row.name}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {moneyOf(row.currency)(row.balance)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={cn(SUB, "min-w-0 flex-1 truncate")}>
                        {moved === undefined
                          ? "no movement in the window"
                          : `moved ${formatDayMonth(moved)}`}
                      </span>
                      <Sparkline
                        points={sparks[row.id] ?? []}
                        width={60}
                        height={16}
                        label={`${row.name} balance, recent weeks`}
                      />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Pane>
  );
}

export function CardsPane({
  rows,
  className,
}: {
  rows: readonly PortfolioAccount[];
  className?: string;
}) {
  return (
    <Pane
      title="Cards"
      meta={`${rows.length} · ${formatThbCompact(thbTotal(rows))} owed`}
      className={className}
      bodyClassName={BODY}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={href(row.id)} className={STACKED}>
                  <span className="flex items-baseline gap-2 text-[11px]">
                    <span className={NAME} title={row.name}>
                      {row.name}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatThb(row.balance)}
                    </span>
                  </span>
                  <span className={SUB}>
                    {row.statement_day === null || row.due_day === null
                      ? "no cycle"
                      : `STMT ${row.statement_day} · DUE ${row.due_day}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Pane>
  );
}

export function LoansPane({
  rows,
  closed,
  className,
}: {
  rows: readonly PortfolioAccount[];
  closed: number;
  className?: string;
}) {
  return (
    <Pane
      title="Loans"
      meta={`${rows.length} · ${formatThbCompact(thbTotal(rows))} left`}
      className={className}
      bodyClassName={BODY}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => {
              const repaid = repaidShare(row);
              return (
                <li key={row.id}>
                  <Link
                    href={href(row.id)}
                    className={cn(STACKED, "group/loan relative")}
                  >
                    <span className="flex items-baseline gap-2 text-[11px]">
                      <span className={NAME} title={row.name}>
                        {row.name}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatThb(row.balance)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Meter share={repaid} />
                      <span className={SUB}>
                        {formatPercent(repaid)} repaid
                      </span>
                    </span>
                    {/* The share is the only figure the bar states; the two it
                        was divided from belong to the same glance. The tip
                        covers the row's own balance, so it restates it first. */}
                    <ChartTip
                      className="top-1/2 right-3 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/loan:opacity-100"
                      rows={[
                        {
                          key: "left",
                          label: "Left",
                          value: formatThb(row.balance),
                        },
                        {
                          key: "repaid",
                          label: "Repaid",
                          value: formatThb(row.debits_posted),
                        },
                        {
                          key: "borrowed",
                          label: "Borrowed",
                          value: formatThb(row.credits_posted),
                        },
                      ]}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {closed > 0 ? (
        <p className="border-border text-muted-foreground shrink-0 border-t px-3 py-1 text-[10px]">
          {closed} closed
        </p>
      ) : null}
    </Pane>
  );
}

export function InvestmentsPane({
  holdings,
  positions,
  className,
}: {
  holdings: readonly Holding[];
  positions: number;
  className?: string;
}) {
  return (
    <Pane
      title="Investments"
      meta={`${positions} positions`}
      className={className}
      bodyClassName={BODY}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {holdings.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          holdings.map((holding) => (
            <div key={holding.key}>
              <div className="border-border flex h-6 items-center justify-between gap-2 border-t px-3 first:border-t-0">
                <span className="label">{holding.label}</span>
                <span className="text-muted-foreground text-[10px] tabular-nums">
                  {moneyOf(holding.currency)(holding.total)}
                </span>
              </div>
              <ul className="divide-border divide-y border-t">
                {holding.rows.map((row) => (
                  <li key={row.id}>
                    <Link href={href(row.id)} className={ROW}>
                      <span
                        className="text-muted-foreground w-16 shrink-0 truncate"
                        title={tickerOf(row)}
                      >
                        {tickerOf(row)}
                      </span>
                      <span className={NAME} title={row.name}>
                        {row.name}
                      </span>
                      <span
                        className={cn(SUB, "w-24 shrink-0 text-right")}
                        title="Quantity held"
                      >
                        {formatHeld(holding.units[row.id], holding.unitWord)}
                      </span>
                      <span className="w-32 shrink-0 text-right tabular-nums">
                        {moneyOf(row.currency)(row.balance)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </Pane>
  );
}
