import type { Point } from "~/domain/series/types";
import { ChartPane } from "~/components/charts/chart-pane";
import { LineChart } from "~/components/charts/line-chart";
import { formatThbCompactSigned } from "~/domain/format";
import { hasMovement } from "~/domain/series/account";

const deltaOf = (points: readonly Point[]) => {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return undefined;
  return last.y - first.y;
};

export function TrajectoryPane({
  points,
  className,
}: {
  points: readonly Point[];
  className?: string;
}) {
  const delta = deltaOf(points);

  return (
    <ChartPane
      title="Trajectory"
      meta={
        delta === undefined
          ? "24 mo net worth"
          : `24 mo · ${formatThbCompactSigned(delta)}`
      }
      expandable={hasMovement(points)}
      className={className}
      bodyClassName="flex min-h-0 flex-1 flex-col p-3"
      expandedChildren={
        <LineChart points={points} currency="THB" area accent expanded />
      }
    >
      <LineChart
        points={points}
        currency="THB"
        area
        accent
        empty="Not enough history to plot."
      />
    </ChartPane>
  );
}
