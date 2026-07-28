import { orderBy, sumBy } from "es-toolkit";

import type { Posting } from "./postings";
import { matchesPrefix } from "./accounts";
import { accountLabel } from "./format";

export interface BudgetRow {
  readonly category: string;
  readonly label: string;
  readonly limit: number;
  readonly spent: number;
  /** Spent over the limit, as a fraction. */
  readonly share: number;
  /** Share of the limit against share of the month; 1 is exactly on schedule. */
  readonly pacing: number;
}

interface BudgetLimit {
  readonly category: string;
  /** Postgres numeric arrives as a string; the boundary is the only place to fix that. */
  readonly monthlyLimit: string;
}

/**
 * Both figures are measured over the same slice of the month: a limit is a
 * whole-month allowance, so comparing a part-month spend against it only
 * reads as "over" or "under" once the elapsed share of the month is divided
 * back out. What each category has cost arrives already summed, because
 * setting or clearing a limit changes none of it.
 */
export const budgetRows = (
  budgets: readonly BudgetLimit[],
  spend: Readonly<Record<string, number>>,
  elapsed: number,
): BudgetRow[] => {
  const rows = budgets.map((budget): BudgetRow => {
    const limit = Number(budget.monthlyLimit);
    const spent = spend[budget.category] ?? 0;
    const share = limit > 0 ? spent / limit : 0;
    return {
      category: budget.category,
      label: accountLabel(budget.category),
      limit,
      spent,
      share,
      pacing: elapsed > 0 ? share / elapsed : 0,
    };
  });

  return orderBy(
    rows,
    [(row) => row.pacing, (row) => row.label],
    ["desc", "asc"],
  );
};

/**
 * What a category has already cost this month, regardless of whether it
 * carries a budget yet: it is both what a row is measured against and what
 * the form ranks its picker by, so the largest un-budgeted category surfaces
 * first and a category budgeted a moment ago already knows its own spend.
 */
export const monthToDateSpend = (
  postings: readonly Posting[],
  category: string,
  month: string,
  dayOfMonth: number,
): number =>
  sumBy(
    postings.filter(
      (posting) =>
        posting.kind === "expense" &&
        posting.signed > 0 &&
        posting.month === month &&
        posting.day <= dayOfMonth &&
        matchesPrefix(posting.account, category),
    ),
    (posting) => posting.signed,
  );
