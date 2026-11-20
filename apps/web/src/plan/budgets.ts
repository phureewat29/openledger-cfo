import { orderBy, sumBy, union } from "es-toolkit";

import type { Posting } from "~/ledger/postings";
import type { PrefixOption } from "~/plan/goals";
import { accountLabel, matchesPrefix, PRIMARY } from "~/ledger/accounts";

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
  /** The control plane stores money as text on purpose (db schema); the boundary is the only place to widen it. */
  readonly monthlyLimit: string;
}

/**
 * A limit is a whole-month allowance, so part-month spend reads over or under only once
 * the elapsed share is divided out. Spend arrives summed: a limit changes none of it.
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

const monthToDateSpend = (
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

/** Every top-level spending category hangs directly off this account. */
const EXPENSE_ROOT = `${PRIMARY}:expense`;

interface BudgetPicker {
  readonly options: readonly PrefixOption[];
  /** Month-to-date spend per category, budgeted or not, so a new limit already knows its spend. */
  readonly spend: Readonly<Record<string, number>>;
}

/**
 * Un-budgeted categories first, then by spend, so the picker defaults to the
 * largest one still worth a limit. A limit set outside the picker is measured too.
 */
export const budgetPicker = ({
  accounts,
  budgets,
  postings,
  month,
  dayOfMonth,
}: {
  readonly accounts: readonly {
    readonly id: string;
    readonly type: string;
    readonly parent_id: string | null;
  }[];
  readonly budgets: readonly { readonly category: string }[];
  readonly postings: readonly Posting[];
  readonly month: string;
  readonly dayOfMonth: number;
}): BudgetPicker => {
  const budgetable = accounts.filter(
    (row) => row.type === "expense" && row.parent_id === EXPENSE_ROOT,
  );
  const spend: Record<string, number> = Object.fromEntries(
    union(
      budgetable.map((row) => row.id),
      budgets.map((budget) => budget.category),
    ).map((category) => [
      category,
      monthToDateSpend(postings, category, month, dayOfMonth),
    ]),
  );
  const budgeted = new Set(budgets.map((budget) => budget.category));
  return {
    options: orderBy(
      budgetable.map((row) => ({ value: row.id, label: accountLabel(row.id) })),
      [
        (option) => budgeted.has(option.value),
        (option) => spend[option.value] ?? 0,
      ],
      ["asc", "desc"],
    ),
    spend,
  };
};
