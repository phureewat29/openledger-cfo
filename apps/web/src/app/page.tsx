import type { Metadata } from "next";

import { Breadcrumbs } from "~/app/_components/breadcrumbs";
import { SetupCard } from "~/app/_components/setup-card";
import { buildActionQueue } from "~/dashboard/action";
import { ActionPane } from "~/dashboard/action-pane";
import { FlowPane } from "~/dashboard/flow-pane";
import {
  ACTION_COL,
  EVERYTHING_GRID,
  FLOW_COL,
  TAPE_COL,
  TRAJECTORY_COL,
} from "~/dashboard/grid";
import { loadDashboard } from "~/dashboard/load";
import { TapePane } from "~/dashboard/tape-pane";
import { TrajectoryPane } from "~/dashboard/trajectory-pane";
import { Vitals } from "~/dashboard/vitals";
import { mergeUpcoming } from "~/plan/upcoming";

export const metadata: Metadata = { title: "Everything · OpenLedger CFO" };

// Ledger reads happen per request; a build-time snapshot would go stale.
export const dynamic = "force-dynamic";

export default async function EverythingPage() {
  const loaded = await loadDashboard();
  if (!loaded.ok) {
    return (
      <SetupCard reason={loaded.error.reason} message={loaded.error.message} />
    );
  }

  const dashboard = loaded.value;
  const queue = buildActionQueue(
    mergeUpcoming(
      dashboard.upcomingLedger,
      dashboard.reminders,
      dashboard.today,
    ),
    dashboard.insights,
    dashboard.insightState,
  );

  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Everything" }]} />
      <h1 className="sr-only">Everything</h1>
      {/* Fractional rows only resolve against a definite height, which is what
          `flex-1` hands them; left content-sized, one tall pane would scale
          every other row with it. The floors still overflow — and scroll —
          when the window is too short for them. */}
      <div className={EVERYTHING_GRID}>
        <Vitals dashboard={dashboard} className="col-span-12" />
        <FlowPane baseline={dashboard.baseline} className={FLOW_COL} />
        <ActionPane queue={queue} className={ACTION_COL} />
        <TrajectoryPane
          points={dashboard.trajectory}
          className={TRAJECTORY_COL}
        />
        <TapePane rows={dashboard.latest} className={TAPE_COL} />
      </div>
    </div>
  );
}
