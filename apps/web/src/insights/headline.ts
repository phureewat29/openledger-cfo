import { sumBy } from "es-toolkit";

import type { RuleInput } from "./types";
import type { BalanceSheet } from "~/ledger/accounts";

/** Derived once, so the stat row, the rules and the AI briefing can never quote two figures for one thing. */
export interface Headline extends BalanceSheet {
  readonly monthIncome: number;
  readonly monthExpenses: number;
  readonly monthNet: number;
  readonly savingsRate: number | undefined;
  readonly savingsWindow: number;
  /** Income across the savings window. */
  readonly savingsEarned: number;
  /** Net across the savings window: what of `savingsEarned` stayed. */
  readonly savingsKept: number;
  readonly cash: number;
  readonly runwayMonths: number | undefined;
  readonly averageMonthlySpend: number | undefined;
  readonly projectedSpend: number;
  readonly lastMonthSpend: number | undefined;
  /** Projected spend against last month's actual. */
  readonly pace: number | undefined;
}

const SAVINGS_WINDOW = 3;

export const headlineOf = (input: RuleInput): Headline => {
  const window = input.months.slice(-SAVINGS_WINDOW);
  const earned = sumBy(window, (month) => month.income);
  const kept = sumBy(window, (month) => month.net);
  const averageMonthlySpend =
    input.months.length === 0
      ? undefined
      : sumBy(input.months, (month) => month.expenses) / input.months.length;
  const lastMonth = input.months.at(-1);

  return {
    netWorthThb: input.netWorthThb,
    netWorthUsd: input.netWorthUsd,
    monthIncome: input.currentMonth.income,
    monthExpenses: input.currentMonth.expenses,
    monthNet: input.currentMonth.net,
    savingsRate: earned > 0 ? kept / earned : undefined,
    savingsWindow: window.length,
    savingsEarned: earned,
    savingsKept: kept,
    cash: input.cash,
    liabilities: input.liabilities,
    runwayMonths:
      averageMonthlySpend && averageMonthlySpend > 0
        ? input.cash / averageMonthlySpend
        : undefined,
    averageMonthlySpend,
    projectedSpend: input.projectedSpend,
    lastMonthSpend: lastMonth?.expenses,
    pace:
      lastMonth && lastMonth.expenses > 0
        ? input.projectedSpend / lastMonth.expenses
        : undefined,
  };
};
