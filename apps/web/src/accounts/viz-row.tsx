import type { AccountSeries, AccountView } from "~/accounts/account";
import type { AccountKind } from "~/ledger/accounts";
import { payoffPoints } from "~/accounts/account";
import { VIZ_FULL, VIZ_NARROW, VIZ_WIDE } from "~/accounts/grid";
import { MonthlyBars, peakOf } from "~/accounts/monthly-bars";
import { Sankey } from "~/flows/sankey";
import { isPrimaryCurrency } from "~/ledger/accounts";
import { ChartPane } from "~/lib/charts/chart-pane";
import { hasMovement } from "~/lib/charts/data";
import { HBarList } from "~/lib/charts/hbar-list";
import { LineChart } from "~/lib/charts/line-chart";
import { StackedBars } from "~/lib/charts/stacked-bars";
import { moneyOf } from "~/lib/format";

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
      className={VIZ_WIDE}
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
  const bars = (expanded: boolean) => (
    <MonthlyBars
      months={account.monthly}
      currency={account.currency}
      expanded={expanded}
    />
  );
  return (
    <ChartPane
      title={title}
      meta={peak > 0 ? `peak ${moneyOf(account.currency)(peak)}` : "12 mo"}
      expandable={peak > 0}
      className={className}
      bodyClassName={CHART}
      expandedChildren={bars(true)}
    >
      {bars(false)}
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
  const balance = (expanded: boolean) => (
    <LineChart
      points={series.balance}
      currency={account.currency}
      step
      expanded={expanded}
      empty="No movement in this window."
    />
  );
  return (
    <>
      <FlowPane account={account} />
      <ChartPane
        title="Balance"
        meta="52 weeks"
        expandable={hasMovement(series.balance)}
        className={VIZ_NARROW}
        bodyClassName={CHART}
        expandedChildren={balance(true)}
      >
        {balance(false)}
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
  const spend = (expanded: boolean) => (
    <StackedBars
      months={series.months}
      series={series.categories}
      currency={account.currency}
      expanded={expanded}
    />
  );
  const cycle = (expanded: boolean) => (
    <HBarList
      rows={series.cycle}
      currency={account.currency}
      expanded={expanded}
    />
  );
  return (
    <>
      <ChartPane
        title="Spend"
        meta="by category"
        expandable={series.categories.length > 0}
        className={VIZ_WIDE}
        bodyClassName={CHART}
        expandedChildren={spend(true)}
      >
        {spend(false)}
      </ChartPane>
      <ChartPane
        title="Cycle"
        meta="this statement"
        expandable={series.cycle.length > 0}
        className={VIZ_NARROW}
        bodyClassName={CHART}
        expandedChildren={cycle(true)}
      >
        {cycle(false)}
      </ChartPane>
    </>
  );
}

function LoanViz({
  account,
  series,
}: {
  account: AccountView;
  series: SeriesOf<"loan">;
}) {
  // Only drawn where the observed pace can defend a date.
  const projection = payoffPoints(
    series.balance,
    series.principal,
    account.balance,
    account.asOf,
  );

  // The installment never changes; the interest share is what caps each column.
  const payments = (expanded: boolean) => (
    <StackedBars
      months={series.months}
      series={[
        { key: "principal", label: "Principal", values: series.principal },
        { key: "interest", label: "Interest", values: series.interest },
      ]}
      currency={account.currency}
      accentKey="principal"
      capShareKey="interest"
      expanded={expanded}
      empty="No payments in this window."
    />
  );
  const remaining = (expanded: boolean) => (
    <LineChart
      points={series.balance}
      currency={account.currency}
      projection={projection}
      step
      expanded={expanded}
      empty="Nothing left to repay."
    />
  );
  return (
    <>
      <ChartPane
        title="Payments"
        meta="interest share"
        expandable={series.months.length > 0}
        className={VIZ_WIDE}
        bodyClassName={CHART}
        expandedChildren={payments(true)}
      >
        {payments(false)}
      </ChartPane>
      <ChartPane
        title="Remaining"
        meta="12 mo"
        expandable={hasMovement(series.balance)}
        className={VIZ_NARROW}
        bodyClassName={CHART}
        expandedChildren={remaining(true)}
      >
        {remaining(false)}
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
  // The steps in the line are the buys; the dots say which month each one landed in.
  const basis = (expanded: boolean) => (
    <LineChart
      points={series.basis}
      currency={account.currency}
      step
      area
      marks={series.buyPoints}
      expanded={expanded}
      empty="No buys in this window."
    />
  );
  return (
    <>
      <ChartPane
        title="Cost basis"
        meta="cumulative"
        expandable={hasMovement(series.basis)}
        className={VIZ_WIDE}
        bodyClassName={CHART}
        expandedChildren={basis(true)}
      >
        {basis(false)}
      </ChartPane>
      <BarsPane account={account} className={VIZ_NARROW} title="Buys" />
    </>
  );
}

function BasicViz({ account }: { account: AccountView }) {
  return <BarsPane account={account} className={VIZ_FULL} title="In and out" />;
}

interface VizProps<K extends AccountKind> {
  readonly account: AccountView;
  readonly series: SeriesOf<K>;
}

const VIZ: {
  readonly [K in AccountKind]: (props: VizProps<K>) => React.ReactNode;
} = {
  cash: CashViz,
  card: CardViz,
  loan: LoanViz,
  position: PositionViz,
  basic: BasicViz,
};

// The generic key is what lets `VIZ[kind]` take a `SeriesOf<K>`. It cannot pair
// them for a caller, where K is the whole union: pass the series' own kind.
const vizOf = <K extends AccountKind>(
  kind: K,
  account: AccountView,
  series: SeriesOf<K>,
) => {
  const Viz: (props: VizProps<K>) => React.ReactNode = VIZ[kind];
  return <Viz account={account} series={series} />;
};

// The account's type picks the two charts; two scales are two panes, never two axes.
export function VizRow({ account }: { account: AccountView }) {
  return vizOf(account.series.kind, account, account.series);
}
