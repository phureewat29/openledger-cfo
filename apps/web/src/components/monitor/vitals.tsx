import Link from "next/link";

import { cn } from "@openledger-cfo/ui";

import type { Dashboard } from "~/server/dashboard";
import {
  SEGMENT_STRIP,
  VITALS_BAND,
  VITALS_CELL,
  VITALS_GRID,
} from "~/app/grid";
import { Sparkline } from "~/components/charts/sparkline";
import {
  formatMonths,
  formatPercent,
  formatThb,
  formatThbCompact,
  formatThbSigned,
  formatUsd,
} from "~/domain/format";
import { headlineOf } from "~/domain/insights/headline";
import { splitPortfolio, thbTotal } from "~/domain/portfolio";

const FIGURE = "text-[20px] leading-6 font-medium tabular-nums";
const HERO = "text-[28px] leading-8 font-medium";

/**
 * A month-to-date net that looks alarming is usually just a month whose salary
 * has not posted yet, so the hint says which of the two it is.
 */
const paydayHint = (dashboard: Dashboard) => {
  const { payday, dayOfMonth } = dashboard.input;
  if (payday.landed) return `${formatThb(payday.incomeToDate)} in so far`;
  if (payday.typicalDay === undefined) return "no income posted yet";
  if (payday.typicalDay <= dayOfMonth) return "no income posted yet";
  return `payday lands day ${payday.typicalDay}`;
};

const paceHint = (projected: number, lastMonth: number | undefined) => {
  if (lastMonth === undefined || lastMonth <= 0) return "no month to compare";
  const change = projected / lastMonth - 1;
  return `${formatPercent(Math.abs(change))} ${change >= 0 ? "above" : "below"} last month`;
};

function Cell({
  label,
  value,
  hint,
  href,
  title,
  valueClassName,
  spark,
}: {
  label: string;
  value: string;
  hint: string;
  href?: string;
  title?: string;
  valueClassName?: string;
  /** The hero cell alone carries a shape; a stat tile needs no plot to be read. */
  spark?: React.ReactNode;
}) {
  const body = (
    <>
      <figcaption className="label">{label}</figcaption>
      <div className={cn(FIGURE, valueClassName)} title={title}>
        {value}
      </div>
      <p className="text-muted-foreground truncate text-[10px]" title={hint}>
        {hint}
      </p>
      {spark}
    </>
  );

  if (href === undefined)
    return <figure className={VITALS_CELL}>{body}</figure>;
  return (
    <Link
      href={href}
      className={cn(VITALS_CELL, "hover:text-accent transition-colors")}
    >
      {body}
    </Link>
  );
}

function Segment({
  label,
  count,
  amount,
}: {
  label: string;
  count: number;
  amount: number;
}) {
  return (
    <Link
      href="/accounts"
      className="hover:text-accent flex shrink-0 items-baseline gap-1.5"
    >
      <span className="label">{label}</span>
      <span className="tabular-nums">{count}</span>
      <span className="text-muted-foreground tabular-nums">
        {formatThbCompact(amount)}
      </span>
    </Link>
  );
}

export function Vitals({
  dashboard,
  className,
}: {
  dashboard: Dashboard;
  className?: string;
}) {
  const headline = headlineOf(dashboard.input);
  const portfolio = splitPortfolio(dashboard.accounts);
  const segments = [
    { key: "banks", label: "Banks", rows: portfolio.banks },
    { key: "cards", label: "Cards", rows: portfolio.cards },
    { key: "loans", label: "Loans", rows: portfolio.openLoans },
  ];
  const investTotal = thbTotal(
    portfolio.holdings.flatMap((holding) => holding.rows),
  );

  return (
    <section
      className={cn(
        `border-border bg-card overflow-hidden rounded-lg border ${VITALS_BAND}`,
        className,
      )}
    >
      <div className={VITALS_GRID}>
        <Cell
          label="Net worth"
          value={formatThbCompact(headline.netWorthThb)}
          title={formatThb(headline.netWorthThb)}
          hint={`+ ${formatUsd(headline.netWorthUsd)} USD`}
          href="/accounts"
          valueClassName={HERO}
          spark={
            <Sparkline
              points={dashboard.trajectory}
              width={90}
              height={16}
              label={`Net worth over the last ${dashboard.trajectory.length} months`}
            />
          }
        />
        <Cell
          label="Month net"
          value={formatThbSigned(headline.monthNet)}
          hint={paydayHint(dashboard)}
          valueClassName={
            headline.monthNet < 0 ? "text-destructive" : undefined
          }
        />
        <Cell
          label="Savings rate"
          value={
            headline.savingsRate === undefined
              ? "—"
              : formatPercent(headline.savingsRate)
          }
          hint={`trailing ${headline.savingsWindow} months`}
        />
        <Cell
          label="Cash"
          value={formatThb(headline.cash)}
          hint={
            headline.runwayMonths === undefined
              ? "no spending history yet"
              : `${formatMonths(headline.runwayMonths)} of runway`
          }
          href="/accounts"
        />
        <Cell
          label="Projected spend"
          value={formatThb(headline.projectedSpend)}
          hint={paceHint(headline.projectedSpend, headline.lastMonthSpend)}
        />
        <Cell
          label="Owed"
          value={formatThb(headline.liabilities)}
          hint={`${portfolio.cards.length} cards · ${portfolio.openLoans.length} loans`}
          href="/accounts"
        />
      </div>

      <div className={SEGMENT_STRIP}>
        {portfolio.positions === 0 && portfolio.banks.length === 0 ? (
          <span className="text-muted-foreground">
            No accounts with balances.
          </span>
        ) : (
          <>
            {segments.map((segment) => (
              <Segment
                key={segment.key}
                label={segment.label}
                count={segment.rows.length}
                amount={thbTotal(segment.rows)}
              />
            ))}
            <Segment
              label="Invest"
              count={portfolio.positions}
              amount={investTotal}
            />
          </>
        )}
      </div>
    </section>
  );
}
