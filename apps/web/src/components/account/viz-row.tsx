import type { AccountKind, AccountSeries } from "~/domain/series/types";
import type { AccountView } from "~/server/account";
import { MonthlyBars, peakOf } from "~/components/account/monthly-bars";
import { ChartPane } from "~/components/charts/chart-pane";
import { HBarList } from "~/components/charts/hbar-list";
import { LineChart } from "~/components/charts/line-chart";
import { StackedBars } from "~/components/charts/stacked-bars";
import { Sankey } from "~/components/sankey";
import { isPrimaryCurrency } from "~/domain/accounts";
import { moneyOf } from "~/domain/format";
import { hasMovement, payoffPoints } from "~/domain/series/account";

/**
 * Every chart here — the sankey's absolutely-positioned svg included — has no
 * intrinsic height, so each slot holds one until the wide grid's fractional
 * rows take over.
 */
const WIDE = "col-span-12 h-[300px] @4xl/main:col-span-8 @4xl/main:h-auto";
const NARROW = "col-span-12 h-[300px] @4xl/main:col-span-4 @4xl/main:h-auto";
const FULL = "col-span-12 h-[300px] @4xl/main:h-auto";

const CHART = "flex min-h-0 flex-1 flex-col p-3";

/** The sankey speaks baht, so a foreign account is told why it has no diagram. */
const flowNote = (account: AccountView) =>
  isPrimaryCurrency(account.currency)
    ? "No flows in these twelve months."
    : `Flows are drawn in THB; this account is kept in ${account.currency}.`;

function FlowPane({ account }: { account: AccountView }) {
  const flow = account.flow;
  return (
    <ChartPane
      title="Flow"
      meta="avg / month"
      expandable={flow !== null}
      className={WIDE}
      bodyClassName="flex min-h-0 flex-1 flex-col p-1"
      expandedChildren={flow === null ? null : <Sankey graph={flow} expanded />}
    >
      {flow === null ? (
        <p className="text-muted-foreground p-2 text-xs">{flowNote(account)}</p>
      ) : (
        <Sankey graph={flow} />
      )}
    </ChartPane>
  );
}

function BarsPane({
  account,
  className,
  title,
}: {
  account: AccountView;
  className: string;
  title: string;
}) {
  const peak = peakOf(account.monthly);
  return (
    <ChartPane
      title={title}
      meta={peak > 0 ? `peak ${moneyOf(account.currency)(peak)}` : "12 mo"}
      expandable={peak > 0}
      className={className}
      bodyClassName={CHART}
      expandedChildren={
        <MonthlyBars
          months={account.monthly}
          currency={account.currency}
          expanded
        />
      }
    >
      <MonthlyBars months={account.monthly} currency={account.currency} />
    </ChartPane>
  );
}

type SeriesOf<K extends AccountKind> = Extract<AccountSeries, { kind: K }>;

function CashViz({
  account,
  series,
}: {
  account: AccountView;
  series: SeriesOf<"cash">;
}) {
  return (
    <>
      <FlowPane account={account} />
      <ChartPane
        title="Balance"
        meta="52 weeks"
        expandable={hasMovement(series.balance)}
        className={NARROW}
        bodyClassName={CHART}
        expandedChildren={
          <LineChart
            points={series.balance}
            currency={account.currency}
            step
            expanded
          />
        }
      >
        <LineChart
          points={series.balance}
          currency={account.currency}
          step
          empty="No movement in this window."
        />
      </ChartPane>
    </>
  );
}

function CardViz({
  account,
  series,
}: {
  account: AccountView;
  series: SeriesOf<"card">;
}) {
  return (
    <>
      <ChartPane
        title="Spend"
        meta="by category"
        expandable={series.categories.length > 0}
        className={WIDE}
        bodyClassName={CHART}
        expandedChildren={
          <StackedBars
            months={series.months}
            series={series.categories}
            currency={account.currency}
            expanded
          />
        }
      >
        <StackedBars
          months={series.months}
          series={series.categories}
          currency={account.currency}
        />
      </ChartPane>
      <ChartPane
        title="Cycle"
        meta="this statement"
        expandable={series.cycle.length > 0}
        className={NARROW}
        bodyClassName={CHART}
        expandedChildren={
          <HBarList rows={series.cycle} currency={account.currency} expanded />
        }
      >
        <HBarList rows={series.cycle} currency={account.currency} />
      </ChartPane>
    </>
  );
}

/** Both views draw the same two bands; the split is the whole story here. */
const paymentBands = (series: SeriesOf<"loan">) => [
  { key: "principal", label: "Principal", values: series.principal },
  { key: "interest", label: "Interest", values: series.interest },
];

function LoanViz({
  account,
  series,
}: {
  account: AccountView;
  series: SeriesOf<"loan">;
}) {
  // Drawn only where the pace the ledger has seen can defend a date; past that
  // horizon the pane says nothing rather than a shape nobody can read.
  const projection = payoffPoints(
    series.balance,
    series.principal,
    account.balance,
    account.asOf,
  );

  return (
    <>
      {/* The installment is the same every month; what moves is how much of it
          is still rent on the balance, so that is what caps each column. */}
      <ChartPane
        title="Payments"
        meta="interest share"
        expandable={series.months.length > 0}
        className={WIDE}
        bodyClassName={CHART}
        expandedChildren={
          <StackedBars
            months={series.months}
            series={paymentBands(series)}
            currency={account.currency}
            accentKey="principal"
            capShareKey="interest"
            expanded
          />
        }
      >
        <StackedBars
          months={series.months}
          series={paymentBands(series)}
          currency={account.currency}
          accentKey="principal"
          capShareKey="interest"
          empty="No payments in this window."
        />
      </ChartPane>
      <ChartPane
        title="Remaining"
        meta="12 mo"
        expandable={hasMovement(series.balance)}
        className={NARROW}
        bodyClassName={CHART}
        expandedChildren={
          <LineChart
            points={series.balance}
            currency={account.currency}
            projection={projection}
            step
            expanded
          />
        }
      >
        <LineChart
          points={series.balance}
          currency={account.currency}
          projection={projection}
          step
          empty="Nothing left to repay."
        />
      </ChartPane>
    </>
  );
}

function PositionViz({
  account,
  series,
}: {
  account: AccountView;
  series: SeriesOf<"position">;
}) {
  return (
    <>
      <ChartPane
        title="Cost basis"
        meta="cumulative"
        expandable={hasMovement(series.basis)}
        className={WIDE}
        bodyClassName={CHART}
        expandedChildren={
          <LineChart
            points={series.basis}
            currency={account.currency}
            step
            area
            marks={series.buyPoints}
            expanded
          />
        }
      >
        {/* The steps in the line are the buys; the dots say which month each one landed in. */}
        <LineChart
          points={series.basis}
          currency={account.currency}
          step
          area
          marks={series.buyPoints}
          empty="No buys in this window."
        />
      </ChartPane>
      <BarsPane account={account} className={NARROW} title="Buys" />
    </>
  );
}

function BasicViz({ account }: { account: AccountView }) {
  return <BarsPane account={account} className={FULL} title="In and out" />;
}

/**
 * The account's type only chooses which two charts sit here; every other part
 * of the page is the same recipe for every account. Two measures of different
 * scale are always two panes — never one pane with two axes.
 */
export function VizRow({ account }: { account: AccountView }) {
  const series = account.series;

  switch (series.kind) {
    case "cash":
      return <CashViz account={account} series={series} />;
    case "card":
      return <CardViz account={account} series={series} />;
    case "loan":
      return <LoanViz account={account} series={series} />;
    case "position":
      return <PositionViz account={account} series={series} />;
    case "basic":
      return <BasicViz account={account} />;
  }
}
