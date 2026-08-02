import { GOALS_COL, PLAN_GRID, SPLIT_COL } from "~/app/plan/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { PaneFrame } from "~/components/pane-frame";

export default function PlanLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Plan" }]} />
      <div className={PLAN_GRID}>
        <PaneFrame title="Goals" className={GOALS_COL} />
        <PaneFrame title="Budgets" className={SPLIT_COL} />
        <PaneFrame title="Reminders" className={SPLIT_COL} />
      </div>
    </div>
  );
}
