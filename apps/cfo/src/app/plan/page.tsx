import type { Metadata } from "next";

import { SetupCard } from "~/app/_components/setup-card";
import { GOALS_COL, PLAN_GRID, SPLIT_COL } from "~/app/plan/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { BudgetsPane } from "~/components/panes/budgets-pane";
import { GoalsPane } from "~/components/panes/goals-pane";
import { RemindersPane } from "~/components/panes/reminders-pane";
import { loadDashboard } from "~/server/dashboard";

export const metadata: Metadata = { title: "Plan · Corgi CFO" };

// Progress is read off the ledger per request; a snapshot would go stale.
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const loaded = await loadDashboard();
  if (!loaded.ok) {
    return <SetupCard reason={loaded.reason} message={loaded.message} />;
  }

  const dashboard = loaded.data;

  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Plan" }]} />
      <h1 className="sr-only">Plan</h1>
      <div className={PLAN_GRID}>
        <GoalsPane
          rows={dashboard.goalRows}
          prefixOptions={dashboard.prefixOptions}
          facts={dashboard.prefixFacts}
          today={dashboard.today}
          className={GOALS_COL}
        />
        <BudgetsPane
          limits={dashboard.budgetLimits}
          options={dashboard.budgetOptions}
          spend={dashboard.categorySpend}
          elapsed={dashboard.monthElapsed}
          className={SPLIT_COL}
        />
        <RemindersPane
          ledger={dashboard.upcomingLedger}
          rows={dashboard.reminders}
          today={dashboard.today}
          className={SPLIT_COL}
        />
      </div>
    </div>
  );
}
