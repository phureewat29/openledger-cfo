import { sumBy } from "es-toolkit";

import type { RuleInput } from "./types";
import { isPrimaryCurrency } from "../accounts";

/**
 * The numbers that must agree everywhere they appear — the stat row, the AI
 * briefing, and any copy that quotes them. Derived once so the page and the
 * model can never quote two different figures for the same thing.
 */
interface Headline {
  readonly netWorthThb: number;
  readonly netWorthUsd: number;
  readonly monthIncome: number;
  readonly monthExpenses: number;
  readonly monthNet: number;
  readonly savingsRate: number | undefined;
  readonly savingsWindow: number;
  readonly cash: number;
  /**
   * What is owed across baht cards and loans, as a positive magnitude. Baht
   * only, because the figure is printed beside `netWorthThb` and added to it:
   * a dollar debt in that sum would be counted at a rate nobody quoted.
   */
  readonly liabilities: number;
  readonly runwayMonths: number | undefined;
  readonly averageMonthlySpend: number | undefined;
  readonly spendToDate: number;
  readonly projectedSpend: number;
  readonly lastMonthSpend: number | undefined;
  /** Projected spend against last month's actual; above 1.2 is the alert line. */
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
    cash: input.cash,
    liabilities: sumBy(
      input.accounts.filter(
        (account) =>
          account.kind === "liability" && isPrimaryCurrency(account.currency),
      ),
      (account) => account.balance,
    ),
    runwayMonths:
      averageMonthlySpend && averageMonthlySpend > 0
        ? input.cash / averageMonthlySpend
        : undefined,
    averageMonthlySpend,
    spendToDate: input.spendToDate,
    projectedSpend: input.projectedSpend,
    lastMonthSpend: lastMonth?.expenses,
    pace:
      lastMonth && lastMonth.expenses > 0
        ? input.projectedSpend / lastMonth.expenses
        : undefined,
  };
};
