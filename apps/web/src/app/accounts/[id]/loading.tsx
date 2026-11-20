import {
  ACCOUNT_GRID,
  HEAD_CELL,
  HEAD_GRID,
  POSTINGS_COL,
  VIZ_NARROW,
  VIZ_WIDE,
} from "~/accounts/grid";
import { Breadcrumbs } from "~/app/_components/breadcrumbs";
import { PaneFrame } from "~/app/_components/pane-frame";
import { GhostLine } from "~/app/_components/skeleton";

// Every account has the head band's title line and four stat cells; its type picks the charts, so those frames stay untitled.
export default function AccountLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Accounts", href: "/accounts" }]} />
      <div className={ACCOUNT_GRID}>
        <section className="border-border bg-card col-span-12 overflow-hidden rounded-lg border">
          <div className="flex h-10 items-center justify-between gap-3 px-3">
            <GhostLine className="text-base" />
            <GhostLine className="shrink-0 text-[20px] leading-6" />
          </div>
          <div className={HEAD_GRID}>
            {Array.from({ length: 4 }, (_, rank) => (
              <figure key={rank} className={HEAD_CELL}>
                <GhostLine className="text-[10px]" />
                <GhostLine className="text-[20px] leading-6" />
              </figure>
            ))}
          </div>
        </section>

        <PaneFrame className={VIZ_WIDE} />
        <PaneFrame className={VIZ_NARROW} />

        <PaneFrame title="Postings" className={POSTINGS_COL} />
      </div>
    </div>
  );
}
