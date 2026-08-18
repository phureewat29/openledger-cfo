import {
  ACCOUNTS_GRID,
  GROUP_COL,
  GROUP_HALF,
  INVESTMENTS_COL,
  STRIP_ROW,
  TOTALS_CELL,
  TOTALS_ROW,
} from "~/app/accounts/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { PaneFrame } from "~/components/pane-frame";
import { GhostLine, ShimmerBox } from "~/components/skeleton";

/**
 * Soft on purpose: the grid constants and pane frames hold the layout, every
 * pane says its loading line, and no body pretends to know how many accounts
 * the ledger holds. The totals row keeps its three cells because the row
 * always has three, and the composition strip alone wears the sweep.
 */
const TOTALS = ["Assets", "Liabilities", "Net"];

export default function AccountsLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Accounts" }]} />
      <h1 className="sr-only">Accounts</h1>
      <div className={ACCOUNTS_GRID}>
        <section className={TOTALS_ROW}>
          {TOTALS.map((label) => (
            <figure key={label} className={TOTALS_CELL}>
              <figcaption className="label">{label}</figcaption>
              <GhostLine className="text-[20px] leading-6" />
            </figure>
          ))}
        </section>

        <section className={`${STRIP_ROW} flex flex-col gap-1`}>
          <ShimmerBox className="h-3 w-full" />
          <GhostLine className="text-[10px]" />
        </section>

        <PaneFrame title="Banks & cash" className={GROUP_HALF} />
        <PaneFrame title="Cards" className={GROUP_HALF} />
        <PaneFrame title="Loans" className={GROUP_COL} />
        <PaneFrame title="Investments" className={INVESTMENTS_COL} />
      </div>
    </div>
  );
}
