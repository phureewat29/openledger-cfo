import { cn } from "@openledger-cfo/ui";

import { GOALS_COL, PLAN_GRID, SPLIT_COL } from "~/app/plan/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { PaneFrame } from "~/components/pane-frame";
import { Shimmer, ShimmerBox } from "~/components/skeleton";

/**
 * Row shells and column widths mirror panes/goals-pane.tsx, budgets-pane.tsx
 * and reminders-pane.tsx; row counts mirror the demo plans (five goals, eight
 * budgets, a merged reminder list around nine deep). The invisible size-5
 * spacers stand where each row's hover-revealed buttons sit, which is what
 * gives those lines their height. Edit the panes and this file together.
 */
const BODY = "flex min-h-0 flex-1 flex-col p-0";
const SCROLL = "min-h-0 flex-1 overflow-y-auto px-3";

const GOALS = [
  { name: "w-[14ch]", chip: "w-[6ch]", pace: "w-[30ch]" },
  { name: "w-[10ch]", chip: "w-[8ch]", pace: "w-[26ch]" },
  { name: "w-[16ch]", chip: "w-[5ch]", pace: "w-[32ch]" },
  { name: "w-[9ch]", chip: "w-[7ch]", pace: "w-[24ch]" },
  { name: "w-[13ch]", chip: "w-[6ch]", pace: "w-[28ch]" },
];

const BUDGETS = [
  "w-[9ch]",
  "w-[12ch]",
  "w-[8ch]",
  "w-[11ch]",
  "w-[7ch]",
  "w-[13ch]",
  "w-[10ch]",
  "w-[9ch]",
];

const REMINDERS = [
  { title: "w-[18ch]", manual: true },
  { title: "w-[14ch]", manual: false },
  { title: "w-[21ch]", manual: false },
  { title: "w-[12ch]", manual: true },
  { title: "w-[17ch]", manual: false },
  { title: "w-[15ch]", manual: false },
  { title: "w-[19ch]", manual: true },
  { title: "w-[13ch]", manual: false },
  { title: "w-[16ch]", manual: false },
];

/** The closed add-row: the disclosure's ghost button, drawn without its hover. */
function AddRow({ label }: { label: string }) {
  return (
    <div className="border-border shrink-0 border-t px-1 py-1.5">
      <div className="text-muted-foreground flex h-7 items-center px-2 text-xs font-medium">
        + {label}
      </div>
    </div>
  );
}

export default function PlanLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Plan" }]} />
      <h1 className="sr-only">Plan</h1>
      <div className={PLAN_GRID}>
        <PaneFrame title="Goals" className={GOALS_COL} bodyClassName={BODY}>
          <div className={SCROLL}>
            <ul className="divide-border divide-y">
              {GOALS.map((row, rank) => (
                <li key={rank} className="flex flex-col gap-1 py-1.5">
                  <div className="flex items-center gap-2">
                    <Shimmer className={cn("text-[11px]", row.name)} />
                    <Shimmer
                      className={cn(
                        "ml-auto rounded-sm border border-transparent px-1.5 py-0.5 text-[10px]",
                        row.chip,
                      )}
                    />
                    <span className="size-5 shrink-0" />
                  </div>
                  <div className="flex items-center gap-2">
                    <ShimmerBox className="h-[3px] min-w-0 flex-1" />
                    <span className="flex w-10 shrink-0 justify-end">
                      <Shimmer className="w-[4ch] text-[10px]" />
                    </span>
                    <span className="flex w-32 shrink-0 justify-end">
                      <Shimmer className="w-[17ch] text-[10px]" />
                    </span>
                  </div>
                  <div className="flex">
                    <Shimmer className={cn("text-xs", row.pace)} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <AddRow label="Add goal" />
        </PaneFrame>

        <PaneFrame title="Budgets" className={SPLIT_COL} bodyClassName={BODY}>
          <div className={SCROLL}>
            <ul className="divide-border divide-y">
              {BUDGETS.map((name, rank) => (
                <li key={rank} className="flex flex-col gap-1 py-1.5">
                  <div className="flex items-baseline gap-2 text-[11px]">
                    <Shimmer className={name} />
                    <Shimmer className="ml-auto w-[16ch]" />
                  </div>
                  <div className="flex items-center gap-2">
                    <ShimmerBox className="h-[3px] min-w-0 flex-1" />
                    <span className="flex w-10 shrink-0 justify-end">
                      <Shimmer className="w-[4ch] text-[10px]" />
                    </span>
                    <span className="size-5 shrink-0" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <AddRow label="Set budget" />
        </PaneFrame>

        <PaneFrame title="Reminders" className={SPLIT_COL} bodyClassName={BODY}>
          <div className={SCROLL}>
            <ul className="divide-border divide-y">
              {REMINDERS.map((row, rank) => (
                <li key={rank} className="flex flex-col gap-0.5 py-1.5">
                  <div className="flex items-center gap-2 text-[11px]">
                    <Shimmer className="w-11 shrink-0" />
                    <Shimmer className={row.title} />
                    {row.manual ? (
                      <span className="ml-auto h-5 w-10 shrink-0" />
                    ) : null}
                  </div>
                  <div className="flex pl-[3.25rem]">
                    <Shimmer className="w-[16ch] text-[10px]" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <AddRow label="Add reminder" />
        </PaneFrame>
      </div>
    </div>
  );
}
