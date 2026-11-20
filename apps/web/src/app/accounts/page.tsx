import type { Metadata } from "next";

import { CompositionStrip } from "~/accounts/composition-strip";
import {
  ACCOUNTS_GRID,
  GROUP_COL,
  GROUP_HALF,
  INVESTMENTS_COL,
  STRIP_ROW,
  TOTALS_CELL,
  TOTALS_ROW,
} from "~/accounts/grid";
import {
  BanksPane,
  CardsPane,
  InvestmentsPane,
  LoansPane,
} from "~/accounts/group-panes";
import { loadPortfolio } from "~/accounts/load";
import { splitPortfolio } from "~/accounts/portfolio";
import { Breadcrumbs } from "~/app/_components/breadcrumbs";
import { SetupCard } from "~/app/_components/setup-card";
import { formatThb } from "~/lib/format";

export const metadata: Metadata = { title: "Accounts · OpenLedger CFO" };

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
  const loaded = await loadPortfolio();
  if (!loaded.ok) {
    return (
      <SetupCard reason={loaded.error.reason} message={loaded.error.message} />
    );
  }

  const view = loaded.value;
  const portfolio = splitPortfolio(view.accounts);
  const net = view.netWorthThb;
  const owed = view.liabilities;

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

        <CompositionStrip portfolio={portfolio} className={STRIP_ROW} />

        <BanksPane
          rows={portfolio.banks}
          activity={view.activity}
          sparks={view.sparks}
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
