import {
  ACTION_COL,
  EVERYTHING_GRID,
  FLOW_COL,
  TAPE_COL,
  TRAJECTORY_COL,
} from "~/app/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { PaneFrame } from "~/components/pane-frame";

export default function EverythingLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Everything" }]} />
      <div className={EVERYTHING_GRID}>
        <PaneFrame title="Vitals" className="col-span-12 h-[116px]" />
        <PaneFrame title="Flow" className={FLOW_COL} />
        <PaneFrame title="Action" className={ACTION_COL} />
        <PaneFrame title="Trajectory" className={TRAJECTORY_COL} />
        <PaneFrame title="Tape" className={TAPE_COL} />
      </div>
    </div>
  );
}
