import { cache } from "react";

import type { RouterOutputs } from "@openledger-cfo/api";
import { caller } from "@openledger-cfo/api";

import type { InsightState } from "~/dashboard/action";
import type { Baseline } from "~/flows/flow";
import type { Insight, RuleInput } from "~/insights/types";
import type { AccountRow } from "~/ledger/accounts";
import type { LedgerLoad, LedgerWindow } from "~/ledger/load";
import type { TransactionRow } from "~/ledger/postings";
import type { Point } from "~/lib/charts/data";
import type { UpcomingItem } from "~/plan/upcoming";
import { toBaseline } from "~/flows/flow";
import { insightsFrom } from "~/insights/load";
import { isMoneyRow } from "~/ledger/accounts";
import { netWorthSeries, TRAJECTORY_MONTHS } from "~/ledger/history";
import { asLedgerLoad, ledgerWindow } from "~/ledger/load";
import {
  firstDayOf,
  isStale,
  monthOf,
  shiftDays,
  shiftMonth,
  windowOf,
} from "~/ledger/period";
import { ledgerUpcoming } from "~/plan/upcoming";

const LATEST_ROWS = 15;

export interface Dashboard {
  readonly today: string;
  /** True when the ledger's newest activity is not in the current month. */
  readonly stale: boolean;
  readonly input: RuleInput;
  readonly insights: readonly Insight[];
  readonly insightState: Readonly<Record<string, InsightState>>;
  readonly baseline: Baseline;
  /** Net worth at each month end, oldest first. */
  readonly trajectory: readonly Point[];
  /** Everything the ledger schedules; reminders merge in beside it. */
  readonly upcomingLedger: readonly UpcomingItem[];
  readonly reminders: RouterOutputs["reminders"]["list"];
  /** Newest rows in the window, newest first. */
  readonly latest: readonly TransactionRow[];
  /** Leaves, unit ledgers included: a position's quantity lives only there, so money sums drop them first. */
  readonly accounts: readonly AccountRow[];
}

/** The Everything page's reads beyond the shared window. */
const dashboardFrom = async (window: LedgerWindow): Promise<Dashboard> => {
  const { today, asOf, units, leaves, transactions } = window;
  const windowStart = windowOf(asOf).from;

  const [allEarlier, { input, insights }, stateRows, reminders] =
    await Promise.all([
      // The trajectory reaches back further than anything else on the page, so it
      // reads only the months the shared window does not already cover.
      caller.ledger.transactions.listAll({
        from: firstDayOf(shiftMonth(monthOf(asOf), -TRAJECTORY_MONTHS)),
        to: shiftDays(windowStart, -1),
      }),
      insightsFrom(window),
      caller.insights.list(),
      caller.reminders.list(),
    ]);
  const earlier = allEarlier.filter((row) => isMoneyRow(row, units));

  return {
    today,
    stale: isStale(asOf, today),
    input,
    insights,
    insightState: Object.fromEntries(
      stateRows.map((row) => [
        row.insightId,
        { status: row.status, note: row.note },
      ]),
    ),
    baseline: toBaseline(transactions, asOf),
    trajectory: netWorthSeries(
      [...earlier, ...transactions],
      monthOf(asOf),
      input.netWorthThb,
    ),
    upcomingLedger: ledgerUpcoming(window),
    reminders,
    // `transactions list` answers newest first; the sort keeps that true of a merged page set.
    latest: transactions
      .toSorted((left, right) => right.date.localeCompare(left.date))
      .slice(0, LATEST_ROWS),
    accounts: leaves,
  };
};

export const loadDashboard = cache((): Promise<LedgerLoad<Dashboard>> =>
  asLedgerLoad(ledgerWindow().then(dashboardFrom)),
);
