import { GOALS_COL, PLAN_GRID, SPLIT_COL } from "~/app/plan/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { PaneFrame } from "~/components/pane-frame";

/**
 * Soft on purpose: the plan grid's row floors hold every pane's height, so
 * the frames alone are the placeholder — no body guesses at plan rows.
 */
export default function PlanLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Plan" }]} />
      <h1 className="sr-only">Plan</h1>
      <div className={PLAN_GRID}>
        <PaneFrame title="Goals" className={GOALS_COL} />
        <PaneFrame title="Budgets" className={SPLIT_COL} />
        <PaneFrame title="Reminders" className={SPLIT_COL} />
      </div>
    </div>
  );
}
