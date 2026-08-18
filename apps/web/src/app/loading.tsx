import {
  ACTION_COL,
  EVERYTHING_GRID,
  FLOW_COL,
  SEGMENT_STRIP,
  TAPE_COL,
  TRAJECTORY_COL,
  VITALS_BAND,
  VITALS_CELL,
  VITALS_GRID,
} from "~/app/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { PaneFrame } from "~/components/pane-frame";
import { GhostLine } from "~/components/skeleton";

/**
 * Soft on purpose: the grid constants and pane frames hold the layout, every
 * pane says its loading line, and no body pretends to know the data. The
 * vitals band keeps its six cells because the band always has six — their
 * labels are product copy, not a guess — and below the wide tier the cells'
 * ghost lines are what give the band its height.
 */
const VITALS = [
  "Net worth",
  "Month net",
  "Savings rate",
  "Cash",
  "Projected spend",
  "Owed",
];

const STRIP = ["Banks", "Cards", "Loans", "Invest"];

export default function EverythingLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Everything" }]} />
      <h1 className="sr-only">Everything</h1>
      <div className={EVERYTHING_GRID}>
        <section className={`${VITALS_BAND} col-span-12`}>
          <div className={VITALS_GRID}>
            {VITALS.map((label, rank) => (
              <figure key={label} className={VITALS_CELL}>
                <figcaption className="label">{label}</figcaption>
                <GhostLine
                  className={
                    rank === 0
                      ? "text-[28px] leading-8"
                      : "text-[20px] leading-6"
                  }
                />
                <GhostLine className="text-[10px]" />
                {rank === 0 ? <span className="h-4 w-[90px] shrink-0" /> : null}
              </figure>
            ))}
          </div>
          <div className={SEGMENT_STRIP}>
            {STRIP.map((label) => (
              <span key={label} className="label shrink-0">
                {label}
              </span>
            ))}
          </div>
        </section>

        <PaneFrame title="Flow" className={FLOW_COL} />
        <PaneFrame title="Action" className={ACTION_COL} />
        <PaneFrame title="Trajectory" className={TRAJECTORY_COL} />
        <PaneFrame title="Tape" className={TAPE_COL} />
      </div>
    </div>
  );
}
