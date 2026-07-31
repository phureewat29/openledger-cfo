import { Breadcrumbs } from "~/components/breadcrumbs";
import { PaneFrame } from "~/components/pane-frame";

/** The head band's own height: a 40px title row over a 52px row of cells. */
const HEAD = "border-border bg-card col-span-12 h-[94px] rounded-lg border";

/**
 * The account's type chooses which charts sit in the middle row, so the frame
 * draws the shape four of the five kinds share and leaves the titles to the
 * page that knows them. The name is the page's to fill in too, which is why
 * the trail stops at the group.
 */
export default function AccountLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Accounts", href: "/accounts" }]} />
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 p-3 @4xl/main:grid-rows-[auto_minmax(280px,1fr)_minmax(300px,1.1fr)]">
        <div className={HEAD} />
        <PaneFrame className="col-span-12 h-[300px] @4xl/main:col-span-8 @4xl/main:h-auto" />
        <PaneFrame className="col-span-12 h-[300px] @4xl/main:col-span-4 @4xl/main:h-auto" />
        <PaneFrame
          title="Postings"
          className="col-span-12 @2xl/main:h-[360px] @4xl/main:h-auto"
        />
      </div>
    </div>
  );
}
