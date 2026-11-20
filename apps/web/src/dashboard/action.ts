import type { Insight } from "~/insights/types";
import type { UpcomingItem } from "~/plan/upcoming";

export interface InsightState {
  readonly status: string;
  readonly note: string | null;
}

export interface ActionQueue {
  readonly due: readonly UpcomingItem[];
  readonly overdue: number;
  /** Worst first, dismissed ones included: hiding a flag is the reader's call. */
  readonly insights: readonly Insight[];
  readonly dismissedIds: readonly string[];
}

/**
 * Dates ascending and severity descending stay two sections of one queue: a
 * merged list would read as neither. `insights` arrive worst first from `runInsights`.
 */
export const buildActionQueue = (
  upcoming: readonly UpcomingItem[],
  insights: readonly Insight[],
  state: Readonly<Record<string, InsightState>>,
): ActionQueue => ({
  due: upcoming,
  overdue: upcoming.filter((item) => item.overdue === true).length,
  insights,
  dismissedIds: insights
    .filter((insight) => state[insight.id]?.status === "dismissed")
    .map((insight) => insight.id),
});
