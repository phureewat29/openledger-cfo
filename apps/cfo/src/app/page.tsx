import type { Metadata } from "next";

import {
  ACTION_COL,
  EVERYTHING_GRID,
  FLOW_COL,
  TAPE_COL,
  TRAJECTORY_COL,
} from "~/app/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { Vitals } from "~/components/monitor/vitals";
import { ActionPane } from "~/components/panes/action-pane";
import { FlowPane } from "~/components/panes/flow-pane";
import { TapePane } from "~/components/panes/tape-pane";
import { TrajectoryPane } from "~/components/panes/trajectory-pane";
import { buildActionQueue } from "~/domain/action";
import { mergeUpcoming } from "~/domain/upcoming";
import { loadDashboard } from "~/server/dashboard";
import { SetupCard } from "./_components/setup-card";

export const metadata: Metadata = { title: "Everything · Corgi CFO" };

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
