import { ACCOUNT_GRID, POSTINGS_COL } from "~/app/accounts/[id]/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { LoadingLine } from "~/components/loading-line";
import { PaneFrame } from "~/components/pane-frame";
import { Shimmer, ShimmerBox } from "~/components/skeleton";

/**
 * The head band and pane slots mirror account/account-head.tsx and viz-row.tsx.
 * The account's type chooses which charts sit in the middle row, so the frames
 * keep their titles as shimmer, and the postings body repeats the loading line
 * the table itself shows while its first page is in flight — the swap from
 * route skeleton to page is a continuation, not a change of scene.
 */
const CELLS = [
  { label: "w-[10ch]", figure: "w-[8ch]" },
  { label: "w-[8ch]", figure: "w-[10ch]" },
  { label: "w-[9ch]", figure: "w-[6ch]" },
  { label: "w-[11ch]", figure: "w-[9ch]" },
];

export default function AccountLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Accounts", href: "/accounts" }]} />
      <div className={ACCOUNT_GRID}>
        <section className="border-border bg-card col-span-12 overflow-hidden rounded-lg border">
          <div className="flex h-10 items-center justify-between gap-3 px-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <Shimmer className="w-[16ch] text-base" />
              <Shimmer className="w-[5ch] rounded-sm border border-transparent px-1.5 text-[10px]" />
              <Shimmer className="w-[22ch] text-[11px]" />
            </div>
            <Shimmer className="w-[10ch] shrink-0 text-[20px] leading-6" />
          </div>
          <div className="border-border grid h-[52px] grid-cols-2 border-t @2xl/main:grid-cols-4">
            {CELLS.map((cell, rank) => (
              <figure
                key={rank}
                className="border-border flex min-w-0 flex-col justify-center gap-0.5 border-l px-3 py-1.5 first:border-l-0"
              >
                <span className="flex">
                  <Shimmer className={`text-[10px] ${cell.label}`} />
                </span>
                <Shimmer className={`text-[20px] leading-6 ${cell.figure}`} />
              </figure>
            ))}
          </div>
        </section>

        <PaneFrame
          className="col-span-12 h-[300px] @4xl/main:col-span-8 @4xl/main:h-auto"
          bodyClassName="flex min-h-0 flex-1 flex-col p-3"
        >
          <ShimmerBox className="min-h-0 flex-1" />
        </PaneFrame>
        <PaneFrame
          className="col-span-12 h-[300px] @4xl/main:col-span-4 @4xl/main:h-auto"
          bodyClassName="flex min-h-0 flex-1 flex-col p-3"
        >
          <ShimmerBox className="min-h-0 flex-1" />
        </PaneFrame>

        <PaneFrame
          title="Postings"
          className={POSTINGS_COL}
          bodyClassName="flex min-h-0 flex-1 flex-col p-0"
        >
          <div className="p-3">
            <LoadingLine />
          </div>
        </PaneFrame>
      </div>
    </div>
  );
}
