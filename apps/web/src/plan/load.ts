import { cache } from "react";

import type { RouterOutputs } from "@openledger-cfo/api";
import { caller } from "@openledger-cfo/api";

import type { LedgerLoad, LedgerWindow } from "~/ledger/load";
import type { PrefixFacts, PrefixOption } from "~/plan/goals";
import type { UpcomingItem } from "~/plan/upcoming";
import { asLedgerLoad, ledgerWindow } from "~/ledger/load";
import { dayOf, daysInMonth, monthOf } from "~/ledger/period";
import { budgetPicker } from "~/plan/budgets";
import { goalPrefixFacts, goalPrefixOptions } from "~/plan/goals";
import { ledgerUpcoming } from "~/plan/upcoming";

interface PlanView {
  readonly today: string;
  readonly prefixOptions: readonly PrefixOption[];
  /** Goals re-derive from these without re-reading the ledger. */
  readonly prefixFacts: Readonly<Record<string, PrefixFacts>>;
  readonly goalRows: RouterOutputs["goals"]["list"];
  /** Top-level spending categories, for setting a budget against one. */
  readonly budgetOptions: readonly PrefixOption[];
  readonly budgetLimits: RouterOutputs["budgets"]["list"];
  /** Month-to-date spend per category, budgeted or not. */
  readonly categorySpend: Readonly<Record<string, number>>;
  /** The share of the current month already gone, which pacing divides by. */
  readonly monthElapsed: number;
  readonly upcomingLedger: readonly UpcomingItem[];
  readonly reminders: RouterOutputs["reminders"]["list"];
}

/** Plans live in the control plane; the ledger reads stop at the shared window. */
export const planFrom = async (window: LedgerWindow): Promise<PlanView> => {
  const { today, asOf, accounts, transactions, postings } = window;
  const [goalRows, budgets, reminders] = await Promise.all([
    caller.goals.list(),
    caller.budgets.list(),
    caller.reminders.list(),
  ]);

  const month = monthOf(asOf);
  const dayOfMonth = dayOf(asOf);
  const days = daysInMonth(month);
  const prefixOptions = goalPrefixOptions(accounts);
  const picker = budgetPicker({
    accounts,
    budgets,
    postings,
    month,
    dayOfMonth,
  });

  return {
    today,
    prefixOptions,
    prefixFacts: goalPrefixFacts({
      options: prefixOptions,
      goals: goalRows,
      accounts,
      movements: transactions,
      asOf,
    }),
    goalRows,
    budgetOptions: picker.options,
    budgetLimits: budgets,
    categorySpend: picker.spend,
    monthElapsed: days > 0 ? dayOfMonth / days : 0,
    upcomingLedger: ledgerUpcoming(window),
    reminders,
  };
};

export const loadPlan = cache((): Promise<LedgerLoad<PlanView>> =>
  asLedgerLoad(ledgerWindow().then(planFrom)),
);
