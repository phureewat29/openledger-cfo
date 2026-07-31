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
import { LoadingLine } from "~/components/loading-line";
import { PaneFrame } from "~/components/pane-frame";

export default function AccountsLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Accounts" }]} />
      <div className={ACCOUNTS_GRID}>
        <section className={TOTALS_ROW}>
          {["Assets", "Liabilities", "Net"].map((label) => (
            <figure key={label} className={TOTALS_CELL}>
              <figcaption className="label">{label}</figcaption>
              <LoadingLine />
            </figure>
          ))}
        </section>
        <div className={STRIP_ROW} />
        <PaneFrame title="Banks & cash" className={GROUP_HALF} />
        <PaneFrame title="Cards" className={GROUP_HALF} />
        <PaneFrame title="Loans" className={GROUP_COL} />
        <PaneFrame title="Investments" className={INVESTMENTS_COL} />
      </div>
    </div>
  );
}
