import type { Metadata } from "next";

import { SetupCard } from "~/app/_components/setup-card";
import {
  ACCOUNTS_GRID,
  GROUP_COL,
  GROUP_HALF,
  INVESTMENTS_COL,
  TOTALS_CELL,
  TOTALS_ROW,
} from "~/app/accounts/grid";
import { CompositionStrip } from "~/components/accounts/composition-strip";
import {
  BanksPane,
  CardsPane,
  InvestmentsPane,
  LoansPane,
} from "~/components/accounts/group-panes";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { formatThb } from "~/domain/format";
import { headlineOf } from "~/domain/insights/headline";
import { splitPortfolio } from "~/domain/portfolio";
import { loadDashboard } from "~/server/dashboard";

export const metadata: Metadata = { title: "Accounts · Corgi CFO" };

// The ledger is read per request; a build-time snapshot would go stale.
export const dynamic = "force-dynamic";

function Total({ label, value }: { label: string; value: string }) {
  return (
    <figure className={TOTALS_CELL}>
      <figcaption className="label">{label}</figcaption>
      <div className="text-[20px] leading-6 font-medium tabular-nums">
        {value}
      </div>
    </figure>
  );
}

export default async function AccountsPage() {
  const loaded = await loadDashboard();
  if (!loaded.ok) {
    return (
      <SetupCard reason={loaded.error.reason} message={loaded.error.message} />
    );
  }

  const dashboard = loaded.value;
  const portfolio = splitPortfolio(dashboard.accounts);
  const headline = headlineOf(dashboard.input);
  const net = headline.netWorthThb;
  const owed = headline.liabilities;

  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Accounts" }]} />
      <h1 className="sr-only">Accounts</h1>
      <div className={ACCOUNTS_GRID}>
        <section className={TOTALS_ROW}>
          <Total label="Assets" value={formatThb(net + owed)} />
          <Total label="Liabilities" value={formatThb(owed)} />
          <Total label="Net" value={formatThb(net)} />
        </section>

        <CompositionStrip portfolio={portfolio} className="col-span-12" />

        <BanksPane
          rows={portfolio.banks}
          activity={dashboard.activity}
          sparks={dashboard.sparks}
          className={GROUP_HALF}
        />
        <CardsPane rows={portfolio.cards} className={GROUP_HALF} />
        <LoansPane
          rows={portfolio.openLoans}
          closed={portfolio.closedLoans}
          className={GROUP_COL}
        />
        <InvestmentsPane
          holdings={portfolio.holdings}
          positions={portfolio.positions}
          className={INVESTMENTS_COL}
        />
      </div>
    </div>
  );
}
