import type { Baseline } from "~/flows/types";
import { Sankey } from "~/flows/sankey";
import { ChartPane } from "~/lib/charts/chart-pane";
import { formatThbCompact } from "~/lib/format";

export function FlowPane({
  baseline,
  className,
}: {
  baseline: Baseline;
  className?: string;
}) {
  // The graph always carries a hub and a "Saved" link, so its own size proves
  // nothing. A window with no complete month is what leaves it undrawable.
  const empty = baseline.months === 0;
  const note = `${baseline.months} mo avg`;

  return (
    <ChartPane
      title="Flow"
      meta={
        empty
          ? "no window"
          : `In ${formatThbCompact(baseline.monthlyIncome)} · Out ${formatThbCompact(baseline.monthlySpend)} · Kept ${formatThbCompact(baseline.monthlySaved)}`
      }
      expandable={!empty}
      className={className}
      bodyClassName="flex min-h-0 flex-1 flex-col p-1"
      expandedChildren={<Sankey graph={baseline.graph} note={note} expanded />}
    >
      {empty ? (
        <p className="text-muted-foreground p-2 text-xs">
          No complete month carries both income and spending.
        </p>
      ) : (
        <Sankey graph={baseline.graph} note={note} />
      )}
    </ChartPane>
  );
}
