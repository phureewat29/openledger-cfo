import type { Metadata } from "next";

import { Breadcrumbs } from "~/app/_components/breadcrumbs";
import { SetupCard } from "~/app/_components/setup-card";
import { GOALS_COL, PLAN_GRID, SPLIT_COL } from "~/app/plan/grid";
import { BudgetsPane } from "~/plan/budgets-pane";
import { GoalsPane } from "~/plan/goals-pane";
import { loadPlan } from "~/plan/load";
import { RemindersPane } from "~/plan/reminders-pane";

export const metadata: Metadata = { title: "Plan · OpenLedger CFO" };

// Progress is read off the ledger per request; a snapshot would go stale.
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const loaded = await loadPlan();
  if (!loaded.ok) {
    return (
      <SetupCard reason={loaded.error.reason} message={loaded.error.message} />
    );
  }

  const plan = loaded.value;

  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Plan" }]} />
      <h1 className="sr-only">Plan</h1>
      <div className={PLAN_GRID}>
        <GoalsPane
          rows={plan.goalRows}
          prefixOptions={plan.prefixOptions}
          facts={plan.prefixFacts}
          today={plan.today}
          className={GOALS_COL}
        />
        <BudgetsPane
          limits={plan.budgetLimits}
          options={plan.budgetOptions}
          spend={plan.categorySpend}
          elapsed={plan.monthElapsed}
          className={SPLIT_COL}
        />
        <RemindersPane
          ledger={plan.upcomingLedger}
          rows={plan.reminders}
          today={plan.today}
          className={SPLIT_COL}
        />
      </div>
    </div>
  );
}
