import { orderBy } from "es-toolkit";

import type { Insight } from "./insights/types";
import type { UpcomingItem } from "./upcoming";
import { severityRank } from "./insights/types";

interface InsightState {
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
 * Both halves answer "what needs me", but they sort by different keys — dates
 * ascending, severity descending — so they stay two sections of one queue
 * rather than one merged list that reads as neither. The dated half arrives in
 * its own order; only the flags are sorted here.
 */
export const buildActionQueue = (
  upcoming: readonly UpcomingItem[],
  insights: readonly Insight[],
  state: Readonly<Record<string, InsightState>>,
): ActionQueue => ({
  due: upcoming,
  overdue: upcoming.filter((item) => item.overdue === true).length,
  insights: orderBy(
    insights,
    [(insight) => severityRank(insight.severity)],
    ["asc"],
  ),
  dismissedIds: insights
    .filter((insight) => state[insight.id]?.status === "dismissed")
    .map((insight) => insight.id),
});

interface ReminderRow {
  readonly dueDate: string;
  readonly monthly: boolean;
  readonly doneAt: Date | null;
}

/**
 * A recurring chore is never late — it just rolls to its next cycle — so only
 * a one-shot past its date counts against the rail badge.
 */
export const overdueCount = (
  reminders: readonly ReminderRow[],
  today: string,
): number =>
  reminders.filter(
    (row) => !row.monthly && row.doneAt === null && row.dueDate < today,
  ).length;
